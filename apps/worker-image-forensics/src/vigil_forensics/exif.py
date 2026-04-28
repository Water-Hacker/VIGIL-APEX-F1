"""EXIF / metadata strip.

Per SRD §28.4: every uploaded image has its EXIF + author / created-by
metadata stripped before storage. This module produces a clean copy +
a report of what was present so audit can verify removal.
"""

from __future__ import annotations

from io import BytesIO

import exifread
from PIL import Image

from .schemas import ExifReport

_INTERESTING_KEYS = (
    "GPS",
    "Artist",
    "Copyright",
    "Author",
    "Software",
    "Make",
    "Model",
    "DateTime",
    "Image OriginalName",
)


def strip_exif(input_bytes: bytes) -> tuple[bytes, ExifReport]:
    """Return (sanitised_bytes, report)."""
    tags = exifread.process_file(BytesIO(input_bytes), details=False)
    had_gps = any(k.startswith("GPS ") for k in tags)
    had_author = any(k in tags for k in ("Image Artist", "EXIF Artist", "Image Author"))
    had_software = any(k in tags for k in ("Image Software", "EXIF Software"))

    found_keys: list[str] = []
    for k in tags:
        if any(k.startswith(prefix) for prefix in _INTERESTING_KEYS):
            found_keys.append(k)

    img = Image.open(BytesIO(input_bytes))
    out = BytesIO()
    fmt = (img.format or "PNG").upper()
    save_kwargs: dict[str, object] = {"format": fmt, "optimize": True}
    if fmt in {"JPEG", "JPG"}:
        save_kwargs["quality"] = 92
    # Re-save without exif/info dict
    img.info.pop("exif", None)
    img.info.pop("xmp", None)
    img.save(out, **save_kwargs)
    return out.getvalue(), ExifReport(
        had_gps=had_gps,
        had_author=had_author,
        had_software=had_software,
        stripped_keys=sorted(set(found_keys)),
    )
