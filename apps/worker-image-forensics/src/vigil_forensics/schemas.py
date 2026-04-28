"""Pydantic schemas for worker-image-forensics."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class ForensicsRequest(BaseModel):
    """One image (typically a scan of a contract page) to analyse."""

    document_cid: str = Field(min_length=10, max_length=120)
    finding_id: str | None = None
    document_kind: Literal[
        "tender",
        "award",
        "amendment",
        "completion_certificate",
        "audit_report",
        "court_judgement",
        "other",
    ] = "other"
    reference_signature_cid: str | None = None
    page: int = Field(ge=0, le=10_000)
    bbox: tuple[float, float, float, float] | None = None  # x0,y0,x1,y1 normalised


class SignatureSimilarity(BaseModel):
    score: float = Field(ge=0.0, le=1.0)        # 1 = identical
    ssim: float = Field(ge=-1.0, le=1.0)
    phash_distance: int = Field(ge=0, le=128)
    rationale: str = Field(min_length=4, max_length=300)


class FontAnomaly(BaseModel):
    score: float = Field(ge=0.0, le=1.0)        # 1 = strong anomaly
    field: Literal["amount", "supplier_name", "officer_name", "date", "other"] = "other"
    details: str = Field(min_length=4, max_length=500)


class ExifReport(BaseModel):
    had_gps: bool
    had_author: bool
    had_software: bool
    stripped_keys: list[str]


class ForensicsResult(BaseModel):
    document_cid: str
    finding_id: str | None
    signature_similarity_score: float | None = None
    font_anomaly_score: float | None = None
    signature: SignatureSimilarity | None = None
    font: FontAnomaly | None = None
    exif: ExifReport
    sanitised_cid: str | None = None
