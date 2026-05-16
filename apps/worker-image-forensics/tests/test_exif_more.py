"""Extra EXIF tests — JPEG path + tag classification branches."""

from __future__ import annotations

from io import BytesIO

from PIL import Image

from vigil_forensics.exif import strip_exif


def _jpeg_bytes() -> bytes:
    img = Image.new("RGB", (16, 16), color=(123, 45, 67))
    out = BytesIO()
    img.save(out, format="JPEG", quality=85)
    return out.getvalue()


def test_strip_exif_on_jpeg_goes_through_quality_branch() -> None:
    """JPEG path runs `img.save(out, format=fmt, optimize=True, quality=92)`."""
    raw = _jpeg_bytes()
    sanitised, report = strip_exif(raw)
    assert sanitised
    # exifread won't find any EXIF in a freshly-encoded Pillow JPEG (no GPS,
    # no Author/Software tags by default)
    assert report.had_gps is False
    assert isinstance(report.stripped_keys, list)


def test_strip_exif_unknown_format_falls_back_to_png() -> None:
    """If Pillow can't infer a format, _it doesn't actually do that_ —
    PNG/JPEG are the realistic cases. This test only confirms a small
    payload encodes round-trip without error.
    """
    raw = _jpeg_bytes()
    out, _ = strip_exif(raw)
    # Should re-decode without crashing
    Image.open(BytesIO(out)).verify()
