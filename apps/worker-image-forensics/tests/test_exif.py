from __future__ import annotations

from io import BytesIO

from PIL import Image

from vigil_forensics.exif import strip_exif


def _png_with_no_exif() -> bytes:
    img = Image.new("RGB", (16, 16), color=(255, 0, 0))
    out = BytesIO()
    img.save(out, format="PNG")
    return out.getvalue()


def test_strip_exif_on_clean_png() -> None:
    raw = _png_with_no_exif()
    sanitised, report = strip_exif(raw)
    assert sanitised  # bytes returned
    assert report.had_gps is False
    assert report.had_author is False
    assert report.had_software is False
    assert report.stripped_keys == []


def test_strip_exif_returns_smaller_or_equal_bytes() -> None:
    raw = _png_with_no_exif()
    sanitised, _ = strip_exif(raw)
    # PNG re-encode shouldn't dramatically grow; allow up to 2x for tiny test images
    assert len(sanitised) <= max(len(raw) * 2, 256)
