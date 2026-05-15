"""Signature similarity assessment.

Two complementary signals combined into one score:

  1. SSIM (structural similarity index, scikit-image) on a centred + normalised
     gray crop of both signatures. Captures overall stroke morphology.
  2. pHash (perceptual hash, imagehash) Hamming distance. Captures coarse
     visual identity even when the SSIM crop is shifted by a few pixels.

The output ``score`` lives in [0, 1] where 1 means "indistinguishable"
and 0 means "no resemblance". Below 0.85 fires the P-G-002 pattern.
"""

from __future__ import annotations

import cv2
import imagehash
import numpy as np
from PIL import Image
from skimage.metrics import structural_similarity as ssim

from vigil_common.errors import VigilError

from .schemas import SignatureSimilarity


def _load_grayscale(buf: bytes) -> np.ndarray:
    arr = np.frombuffer(buf, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_GRAYSCALE)
    if img is None:
        raise VigilError(
            code="FORENSICS_BAD_IMAGE",
            message="cannot decode signature image",
            severity="warn",
        )
    return img


def _normalise(img: np.ndarray, target_size: tuple[int, int] = (256, 96)) -> np.ndarray:
    """Threshold + crop-to-bounding-box + resize to a canonical shape."""
    _, bw = cv2.threshold(img, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    coords = cv2.findNonZero(bw)
    if coords is None:
        return cv2.resize(img, target_size, interpolation=cv2.INTER_AREA)
    x, y, w, h = cv2.boundingRect(coords)
    cropped = img[y : y + h, x : x + w] if w > 0 and h > 0 else img
    return cv2.resize(cropped, target_size, interpolation=cv2.INTER_AREA)


def compare_signatures(reference_bytes: bytes, candidate_bytes: bytes) -> SignatureSimilarity:
    """Compare two signature images. Higher score == more similar."""
    ref = _normalise(_load_grayscale(reference_bytes))
    cand = _normalise(_load_grayscale(candidate_bytes))
    s = float(ssim(ref, cand, data_range=255))
    p_ref = imagehash.phash(Image.fromarray(ref))
    p_cand = imagehash.phash(Image.fromarray(cand))
    d = int(p_ref - p_cand)
    # phash distance: 0 (identical) to 64 (max). Map to [0, 1] inversely.
    phash_score = 1.0 - min(d / 32.0, 1.0)
    score = max(0.0, min(1.0, 0.6 * ((s + 1.0) / 2.0) + 0.4 * phash_score))
    rationale = f"ssim={s:.3f}; phash_dist={d}; combined={score:.3f}"
    return SignatureSimilarity(
        score=score,
        ssim=float(s),
        phash_distance=d,
        rationale=rationale,
    )
