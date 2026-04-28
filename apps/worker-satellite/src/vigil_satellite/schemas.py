"""Pydantic schemas for worker-satellite envelopes."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, Field, field_validator


class GeoPoint(BaseModel):
    lat: float = Field(ge=-90.0, le=90.0)
    lon: float = Field(ge=-180.0, le=180.0)


class GeoBBox(BaseModel):
    min_lon: float = Field(ge=-180.0, le=180.0)
    min_lat: float = Field(ge=-90.0, le=90.0)
    max_lon: float = Field(ge=-180.0, le=180.0)
    max_lat: float = Field(ge=-90.0, le=90.0)

    @field_validator("max_lon")
    @classmethod
    def _check_lon(cls, v: float, info) -> float:  # type: ignore[no-untyped-def]
        lo = info.data.get("min_lon")
        if lo is not None and v < lo:
            raise ValueError("max_lon must be >= min_lon")
        return v


# ---- Inbound — `vigil:satellite:request` -------------------------------------
class SatelliteRequest(BaseModel):
    """Worker input: a project to assess.

    Either `bbox` or `centroid + buffer_m` may be supplied.
    """

    project_id: str = Field(min_length=1, max_length=120)
    finding_id: str | None = None
    contract_start: datetime
    contract_end: datetime
    centroid: GeoPoint | None = None
    bbox: GeoBBox | None = None
    buffer_m: Annotated[int, Field(ge=50, le=10_000)] = 250
    sensor_priority: list[str] = Field(default_factory=lambda: ["sentinel-2-l2a", "landsat-c2-l2"])

    @field_validator("contract_end")
    @classmethod
    def _end_after_start(cls, v: datetime, info) -> datetime:  # type: ignore[no-untyped-def]
        start = info.data.get("contract_start")
        if start is not None and v <= start:
            raise ValueError("contract_end must be after contract_start")
        return v


# ---- Outbound — `vigil:adapter:out` (kind=satellite_imagery) -----------------
class ActivityFinding(BaseModel):
    """Per-scene activity assessment, attached to the source event payload."""

    scene_id: str
    sensor: str
    captured_at: datetime
    cloud_pct: float = Field(ge=0.0, le=100.0)
    activity_score: float = Field(ge=0.0, le=1.0)
    activity_centroid: GeoPoint | None = None
    ndvi_mean: float | None = Field(default=None, ge=-1.0, le=1.0)
    ndbi_mean: float | None = Field(default=None, ge=-1.0, le=1.0)
    rationale: str = Field(min_length=4, max_length=500)


class SatelliteEventPayload(BaseModel):
    """Aggregated outbound payload — one event per project per run."""

    project_id: str
    finding_id: str | None = None
    contract_window: dict[str, datetime]
    aoi_geojson: dict[str, object]
    n_scenes: int = Field(ge=0)
    activity_score: float = Field(ge=0.0, le=1.0)
    activity_trend: float = Field(ge=-1.0, le=1.0)
    activity_centroid: GeoPoint | None = None
    findings: list[ActivityFinding]
