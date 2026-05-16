"""Tests for vigil_forensics.fonts — glyph metrics + anomaly detection."""

from __future__ import annotations

import warnings

import cv2
import numpy as np
import pytest
from PIL import Image, ImageDraw

from vigil_common.errors import VigilError
from vigil_forensics.fonts import _binarise, _glyph_metrics, detect_font_anomaly


def _mk_page_with_text(
    width: int = 256,
    height: int = 128,
    text: str = "AMOUNT 1000",
    text_xy: tuple[int, int] = (10, 50),
) -> np.ndarray:
    """Return a BGR ndarray of a synthetic page with rendered text."""
    img = Image.new("RGB", (width, height), color=(255, 255, 255))
    draw = ImageDraw.Draw(img)
    draw.text(text_xy, text, fill=(0, 0, 0))
    arr = np.array(img)
    # Convert RGB → BGR for OpenCV-style input
    return cv2.cvtColor(arr, cv2.COLOR_RGB2BGR)


def test_binarise_2d_input() -> None:
    """A 2-D grayscale input should bypass the cvtColor branch."""
    gray = np.full((20, 20), 200, dtype=np.uint8)
    gray[5:15, 5:15] = 50
    bw = _binarise(gray)
    assert bw.shape == (20, 20)
    assert bw.dtype == np.uint8


def test_binarise_3d_input() -> None:
    """A 3-D BGR input goes through cvtColor."""
    img = np.full((20, 20, 3), 200, dtype=np.uint8)
    img[5:15, 5:15] = 50
    bw = _binarise(img)
    assert bw.shape == (20, 20)


def test_glyph_metrics_on_empty_bw() -> None:
    """All-zeros input yields all-zero metrics."""
    bw = np.zeros((30, 30), dtype=np.uint8)
    out = _glyph_metrics(bw)
    assert out == (0.0, 0.0, 0.0, 0.0)


def test_glyph_metrics_on_simple_glyph() -> None:
    """A single filled rectangle exercises the contour + bbox path."""
    bw = np.zeros((40, 40), dtype=np.uint8)
    bw[10:25, 10:25] = 255  # one "glyph"
    mean_stroke, _std_stroke, _mean_height, std_spacing = _glyph_metrics(bw)
    assert mean_stroke > 0
    # Single glyph ⇒ heights array of length 1 ⇒ std_spacing == 0
    assert std_spacing == 0.0


def test_glyph_metrics_multiple_glyphs() -> None:
    """Multiple separate glyphs ⇒ spacing distribution is computed."""
    bw = np.zeros((40, 100), dtype=np.uint8)
    # Three glyphs, 10x15, at x=10, 30, 50
    for x in (10, 30, 50):
        bw[10:25, x : x + 10] = 255
    out = _glyph_metrics(bw)
    assert out[0] > 0  # mean_stroke
    assert out[2] > 0  # mean_height


def test_detect_font_anomaly_rejects_1d_input() -> None:
    bad = np.zeros((10,), dtype=np.uint8)
    with pytest.raises(VigilError) as exc:
        detect_font_anomaly(bad, (0, 0, 5, 5))  # type: ignore[arg-type]
    assert exc.value.code == "FORENSICS_BAD_PAGE"


def test_detect_font_anomaly_rejects_too_small_bbox() -> None:
    page = _mk_page_with_text()
    with pytest.raises(VigilError) as exc:
        detect_font_anomaly(page, (0, 0, 3, 3))  # w/h <= 4
    assert exc.value.code == "FORENSICS_BAD_BBOX"


def test_detect_font_anomaly_rejects_out_of_bounds_bbox() -> None:
    page = _mk_page_with_text(width=100, height=100)
    with pytest.raises(VigilError) as exc:
        detect_font_anomaly(page, (50, 50, 80, 80))  # 50+80 > 100
    assert exc.value.code == "FORENSICS_BAD_BBOX"


def test_detect_font_anomaly_returns_score_in_range() -> None:
    """End-to-end smoke: a uniform-text page ⇒ score is a valid [0,1] number."""
    page = _mk_page_with_text(text="amount 1000 supplier_a 2024")
    # Pick a small inner crop that is part of the rendered text region
    result = detect_font_anomaly(page, (10, 40, 80, 25), field_label="amount")
    assert 0.0 <= result.score <= 1.0
    assert result.field == "amount"
    assert "stroke" in result.details


def test_detect_font_anomaly_collapses_unknown_label_to_other() -> None:
    page = _mk_page_with_text()
    result = detect_font_anomaly(page, (10, 40, 80, 25), field_label="weird_label")
    assert result.field == "other"


def test_detect_font_anomaly_accepts_grayscale_page() -> None:
    """A 2-D grayscale page also works."""
    gray = np.full((128, 256), 255, dtype=np.uint8)
    # Splat a black rectangle as "text"
    gray[40:70, 20:200] = 0
    with warnings.catch_warnings():
        # cv2 distance-transform on near-uniform input can emit a numpy
        # overflow warning; the math result is bounded by the [0,1] tanh,
        # so this is informational only.
        warnings.simplefilter("ignore", RuntimeWarning)
        result = detect_font_anomaly(gray, (50, 45, 60, 20), field_label="other")
    assert 0.0 <= result.score <= 1.0
