from __future__ import annotations

from io import BytesIO

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from vigil_forensics.signatures import compare_signatures


def _signature_png(text: str, *, jitter: int = 0, italic: bool = False) -> bytes:
    img = Image.new("L", (256, 96), color=255)
    draw = ImageDraw.Draw(img)
    try:
        font = ImageFont.load_default()
    except OSError:  # pragma: no cover
        font = ImageFont.load_default()
    draw.text((10 + jitter, 30), text, fill=0, font=font)
    if italic:
        # Skew via affine transform to simulate a different signature
        img = img.transform((256, 96), Image.AFFINE, (1, 0.3, -10, 0, 1, 0))
    out = BytesIO()
    img.save(out, format="PNG")
    return out.getvalue()


def test_identical_signatures_score_high() -> None:
    a = _signature_png("J. Mbarga")
    r = compare_signatures(reference_bytes=a, candidate_bytes=a)
    assert r.score >= 0.95
    assert r.phash_distance == 0


def test_different_signatures_score_low() -> None:
    ref = _signature_png("J. Mbarga")
    cand = _signature_png("D. Atangana", italic=True)
    r = compare_signatures(reference_bytes=ref, candidate_bytes=cand)
    assert r.score < 0.85


def test_minor_jitter_still_high() -> None:
    a = _signature_png("J. Mbarga")
    b = _signature_png("J. Mbarga", jitter=2)
    r = compare_signatures(reference_bytes=a, candidate_bytes=b)
    assert r.score >= 0.85


def test_bad_image_raises() -> None:
    from vigil_common.errors import VigilError

    import pytest

    with pytest.raises(VigilError):
        compare_signatures(reference_bytes=b"not-an-image", candidate_bytes=b"\x00\x01\x02")
