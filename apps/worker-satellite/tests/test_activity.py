from __future__ import annotations

import numpy as np
import pytest

from vigil_common.errors import VigilError
from vigil_satellite.activity import compute_activity
from vigil_satellite.schemas import GeoBBox, GeoPoint


def _flat(value: float, shape: tuple[int, int] = (32, 32)) -> np.ndarray:
    return np.full(shape, value, dtype=np.float32)


def test_no_change_yields_low_activity() -> None:
    """Identical before/after surface reflectance ⇒ activity ≈ 0.5 (neutral)."""
    red = _flat(0.10)
    nir = _flat(0.30)
    swir = _flat(0.20)
    r = compute_activity(
        before_red=red,
        before_nir=nir,
        before_swir=swir,
        after_red=red,
        after_nir=nir,
        after_swir=swir,
    )
    assert 0.45 <= r.activity_score <= 0.55
    assert abs(r.activity_trend) < 0.05
    assert r.spatial_extent_change == 0.0


def test_clear_construction_signal() -> None:
    """Bare-soil → built-up: NDBI rises, NDVI falls ⇒ activity ≫ 0.5."""
    before_red = _flat(0.10)
    before_nir = _flat(0.40)  # vegetation-rich
    before_swir = _flat(0.20)
    after_red = _flat(0.20)
    after_nir = _flat(0.20)  # vegetation gone
    after_swir = _flat(0.40)  # built-up rises

    r = compute_activity(
        before_red=before_red,
        before_nir=before_nir,
        before_swir=before_swir,
        after_red=after_red,
        after_nir=after_nir,
        after_swir=after_swir,
    )
    assert r.activity_score > 0.7
    assert r.activity_trend > 0.4
    assert r.ndvi_mean_after < r.ndvi_mean_before
    assert r.ndbi_mean_after > r.ndbi_mean_before


def test_partial_construction_localised_centroid() -> None:
    """Only the south-east quadrant changes; centroid should land there."""
    h, w = 40, 40
    before_red = _flat(0.10, (h, w))
    before_nir = _flat(0.40, (h, w))
    before_swir = _flat(0.20, (h, w))
    after_red = before_red.copy()
    after_nir = before_nir.copy()
    after_swir = before_swir.copy()
    # Build a 10x10 patch in the SE corner
    after_nir[h - 10 :, w - 10 :] = 0.18
    after_swir[h - 10 :, w - 10 :] = 0.45

    r = compute_activity(
        before_red=before_red,
        before_nir=before_nir,
        before_swir=before_swir,
        after_red=after_red,
        after_nir=after_nir,
        after_swir=after_swir,
    )
    assert r.centroid_pixel is not None
    cy, cx = r.centroid_pixel
    assert cy >= h * 0.6
    assert cx >= w * 0.6


def test_shape_mismatch_raises() -> None:
    a = _flat(0.1, (10, 10))
    b = _flat(0.1, (20, 20))
    with pytest.raises(VigilError) as exc:
        compute_activity(
            before_red=a,
            before_nir=a,
            before_swir=a,
            after_red=b,
            after_nir=b,
            after_swir=b,
        )
    assert exc.value.code == "SATELLITE_SHAPE_MISMATCH"


def test_all_nan_raises() -> None:
    nan = np.full((4, 4), np.nan, dtype=np.float32)
    with pytest.raises(VigilError) as exc:
        compute_activity(
            before_red=nan,
            before_nir=nan,
            before_swir=nan,
            after_red=nan,
            after_nir=nan,
            after_swir=nan,
        )
    assert exc.value.code == "SATELLITE_NO_VALID_PIXELS"


def test_geo_validators() -> None:
    GeoPoint(lat=4.05, lon=9.70)  # Douala
    with pytest.raises(ValueError, match="less than or equal to 90"):
        GeoPoint(lat=91.0, lon=0.0)
    with pytest.raises(ValueError, match="max_lon must be >= min_lon"):
        GeoBBox(min_lon=10, min_lat=0, max_lon=5, max_lat=1)
