"""Font / typography anomaly detection.

We extract per-character glyph features from a candidate field crop (the
amount, supplier name, etc.) and compare them against the surrounding text:

  - stroke-width statistics (mean / stdev) via distance transform
  - glyph height distribution
  - inter-character spacing distribution

If the candidate field's distributions diverge from the surrounding text by
more than `K * sigma`, we surface a font anomaly. The score is in [0, 1]
where 1 means a strong anomaly.

The detection is intentionally conservative — false positives cost more than
false negatives at this layer because P-G-004 is a probabilistic pattern.
"""

from __future__ import annotations

import cv2
import numpy as np

from vigil_common.errors import VigilError

from .schemas import FontAnomaly


def _binarise(img_bgr: np.ndarray) -> np.ndarray:
    gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY) if img_bgr.ndim == 3 else img_bgr
    _, bw = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    return bw


def _glyph_metrics(bw: np.ndarray) -> tuple[float, float, float, float]:
    """Return (mean_stroke, std_stroke, mean_height, std_spacing)."""
    if not bw.any():
        return (0.0, 0.0, 0.0, 0.0)
    dist = cv2.distanceTransform(bw, cv2.DIST_L2, 5)
    contours, _ = cv2.findContours(bw, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return (float(dist[bw > 0].mean() * 2), 0.0, 0.0, 0.0)
    bboxes = sorted(
        (
            cv2.boundingRect(c)
            for c in contours
            if cv2.boundingRect(c)[2] >= 2 and cv2.boundingRect(c)[3] >= 4
        ),
        key=lambda b: b[0],
    )
    heights = np.array([b[3] for b in bboxes], dtype=np.float32)
    spacings = np.array(
        [bboxes[i + 1][0] - (bboxes[i][0] + bboxes[i][2]) for i in range(len(bboxes) - 1)],
        dtype=np.float32,
    )
    stroke_pixels = dist[bw > 0]
    return (
        float(stroke_pixels.mean() * 2) if stroke_pixels.size else 0.0,
        float(stroke_pixels.std() * 2) if stroke_pixels.size else 0.0,
        float(heights.mean()) if heights.size else 0.0,
        float(spacings.std()) if spacings.size > 1 else 0.0,
    )


def detect_font_anomaly(
    page_bgr: np.ndarray,
    field_bbox: tuple[int, int, int, int],
    field_label: str = "other",
    *,
    z_threshold: float = 2.5,
) -> FontAnomaly:
    """Compare a labelled field crop's typography against the rest of the page.

    Args:
        page_bgr: full page BGR (H, W, 3) numpy array
        field_bbox: (x, y, w, h) in pixels of the field of interest
        field_label: which field (drives reporting only)
        z_threshold: number of stdevs above which a metric counts as anomalous
    """
    if page_bgr.ndim not in (2, 3):
        raise VigilError(
            code="FORENSICS_BAD_PAGE",
            message="page must be 2-D or 3-D ndarray",
            severity="error",
        )
    h_total, w_total = page_bgr.shape[:2]
    x, y, w, h = field_bbox
    if w <= 4 or h <= 4 or x + w > w_total or y + h > h_total:
        raise VigilError(
            code="FORENSICS_BAD_BBOX",
            message=f"invalid field bbox {field_bbox} on page {(h_total, w_total)}",
            severity="error",
        )

    bw_page = _binarise(page_bgr)
    bw_field = bw_page[y : y + h, x : x + w]
    # "Surrounding": page minus the field rectangle
    bw_surround = bw_page.copy()
    bw_surround[y : y + h, x : x + w] = 0

    stroke_f, _stroke_f_std, height_f, spacing_f_std = _glyph_metrics(bw_field)
    stroke_s, stroke_s_std, height_s, spacing_s_std = _glyph_metrics(bw_surround)

    def z(value: float, mean: float, std: float) -> float:
        return abs((value - mean) / max(std, 0.5))

    z_stroke = z(stroke_f, stroke_s, stroke_s_std or 0.5)
    z_height = z(height_f, height_s, max(height_s * 0.15, 1.0))
    z_spacing = z(spacing_f_std, spacing_s_std, max(spacing_s_std, 0.5))

    z_combined = float(np.tanh(max(z_stroke, z_height, z_spacing) / z_threshold))
    score = max(0.0, min(1.0, z_combined))
    details = (
        f"stroke field/surround={stroke_f:.2f}/{stroke_s:.2f} (z={z_stroke:.2f}); "
        f"height={height_f:.1f}/{height_s:.1f} (z={z_height:.2f}); "
        f"spacing-std={spacing_f_std:.2f}/{spacing_s_std:.2f} (z={z_spacing:.2f})"
    )
    _allowed_labels = {"amount", "supplier_name", "officer_name", "date"}
    return FontAnomaly(
        score=score,
        field=field_label if field_label in _allowed_labels else "other",
        details=details,
    )
