"""Activity-score computation.

Strategy (deliberately simple, well-bounded):

  1. Pull two scene cohorts: `before` (around contract_start) and `after`
     (≥ 90 % through the contract window).
  2. For each scene compute NDVI (Sentinel-2 bands 8/4) and NDBI (11/8).
  3. The "activity score" of a project is:

         activity = clamp(0, 1,
                       w_b * normalised_change(NDBI) +
                       w_v * normalised_change(NDVI) +
                       w_t * spatial_extent_change )

     where increasing NDBI suggests more built-up surface and decreasing
     NDVI suggests cleared vegetation — both characteristic of construction.
  4. The activity centroid is the centre-of-mass of pixels whose NDBI delta
     exceeds a threshold.

The function is pure-numpy and unit-testable without a network connection.
The STAC-fetch + COG-read I/O is in `stac.py`.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray

from vigil_common.errors import VigilError

EPS = 1e-9


@dataclass(frozen=True)
class BandStack:
    """A 3-D ndarray (T, H, W) for one band, plus pixel size in metres."""

    array: NDArray[np.float32]
    pixel_size_m: float


@dataclass(frozen=True)
class ActivityResult:
    activity_score: float           # 0..1
    activity_trend: float           # -1..1 (positive = construction-like)
    centroid_pixel: tuple[int, int] | None
    ndvi_mean_before: float
    ndvi_mean_after: float
    ndbi_mean_before: float
    ndbi_mean_after: float
    spatial_extent_change: float


def _ndvi(red: NDArray[np.float32], nir: NDArray[np.float32]) -> NDArray[np.float32]:
    return (nir - red) / (nir + red + EPS)


def _ndbi(swir: NDArray[np.float32], nir: NDArray[np.float32]) -> NDArray[np.float32]:
    return (swir - nir) / (swir + nir + EPS)


def compute_activity(
    *,
    before_red: NDArray[np.float32],
    before_nir: NDArray[np.float32],
    before_swir: NDArray[np.float32],
    after_red: NDArray[np.float32],
    after_nir: NDArray[np.float32],
    after_swir: NDArray[np.float32],
    weights: tuple[float, float, float] = (0.55, 0.25, 0.20),
    ndbi_threshold: float = 0.10,
) -> ActivityResult:
    """Compute an activity score from before/after band arrays.

    Inputs MUST be the same shape (H, W). Values are surface-reflectance
    floats; valid pixels are between 0 and 1, NaN for cloud / no-data.
    """
    if not (
        before_red.shape == before_nir.shape == before_swir.shape
        == after_red.shape == after_nir.shape == after_swir.shape
    ):
        raise VigilError(
            code="SATELLITE_SHAPE_MISMATCH",
            message="all input bands must share the same shape",
            severity="error",
        )

    ndvi_b = _ndvi(before_red, before_nir)
    ndvi_a = _ndvi(after_red, after_nir)
    ndbi_b = _ndbi(before_swir, before_nir)
    ndbi_a = _ndbi(after_swir, after_nir)

    # Mask invalid pixels (cloud, snow, no-data → NaN somewhere)
    valid = (
        np.isfinite(ndvi_b) & np.isfinite(ndvi_a) & np.isfinite(ndbi_b) & np.isfinite(ndbi_a)
    )
    if not np.any(valid):
        raise VigilError(
            code="SATELLITE_NO_VALID_PIXELS",
            message="no valid pixel pairs after cloud masking",
            severity="warn",
            retryable=True,
        )

    ndbi_delta = ndbi_a - ndbi_b
    ndvi_delta = ndvi_a - ndvi_b

    ndbi_change_norm = float(np.clip(np.nanmean(ndbi_delta[valid]) * 5.0, -1.0, 1.0))
    ndvi_change_norm = float(np.clip(-np.nanmean(ndvi_delta[valid]) * 4.0, -1.0, 1.0))

    construction_pixels = (ndbi_delta > ndbi_threshold) & valid
    spatial_extent = (
        float(np.count_nonzero(construction_pixels) / max(np.count_nonzero(valid), 1))
        if np.any(valid)
        else 0.0
    )

    w_b, w_v, w_t = weights
    raw_trend = w_b * ndbi_change_norm + w_v * ndvi_change_norm + w_t * (spatial_extent * 2 - 1)
    activity = max(0.0, min(1.0, (raw_trend + 1.0) / 2.0))

    centroid_pixel: tuple[int, int] | None = None
    if np.any(construction_pixels):
        idx = np.argwhere(construction_pixels)
        cy, cx = (float(np.mean(idx[:, 0])), float(np.mean(idx[:, 1])))
        centroid_pixel = (int(round(cy)), int(round(cx)))

    return ActivityResult(
        activity_score=activity,
        activity_trend=float(raw_trend),
        centroid_pixel=centroid_pixel,
        ndvi_mean_before=float(np.nanmean(ndvi_b[valid])),
        ndvi_mean_after=float(np.nanmean(ndvi_a[valid])),
        ndbi_mean_before=float(np.nanmean(ndbi_b[valid])),
        ndbi_mean_after=float(np.nanmean(ndbi_a[valid])),
        spatial_extent_change=spatial_extent,
    )
