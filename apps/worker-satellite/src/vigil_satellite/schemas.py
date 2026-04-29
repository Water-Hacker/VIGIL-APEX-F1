"""Pydantic schemas for worker-satellite envelopes — mirrors the
TypeScript-side `@vigil/satellite-client` contract.

DECISION-010 — the envelope shape is the single source of truth shared with
the TS satellite-client; both sides validate against the same fields.
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal

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


class PolygonGeoJson(BaseModel):
    """GeoJSON Polygon with at least one ring (the outer boundary)."""

    type: Literal["Polygon"]
    coordinates: list[list[tuple[float, float]]] = Field(min_length=1)


class ContractWindow(BaseModel):
    start: datetime
    end: datetime

    @field_validator("end")
    @classmethod
    def _end_after_start(cls, v: datetime, info) -> datetime:  # type: ignore[no-untyped-def]
        start = info.data.get("start")
        if start is not None and v <= start:
            raise ValueError("contract end must be after start")
        return v


Provider = Literal["nicfi", "sentinel-2", "sentinel-1", "maxar", "airbus"]


# ---- Inbound — `vigil:satellite:request` -------------------------------------
class SatelliteRequest(BaseModel):
    """Worker input: a project / finding to assess.

    Mirrors `@vigil/satellite-client` SatelliteRequest exactly.
    """

    request_id: str = Field(min_length=8, max_length=80)
    project_id: str | None = None
    finding_id: str | None = None
    aoi_geojson: PolygonGeoJson
    contract_window: ContractWindow
    providers: list[Provider] = Field(min_length=1, max_length=5)
    max_cloud_pct: float = Field(ge=0.0, le=100.0, default=20.0)
    max_cost_usd: float = Field(ge=0.0, default=0.0)
    requested_by: str = Field(min_length=1, max_length=120)


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
    rationale: str = Field(min_length=4, max_length=2000)


class SatelliteEventPayload(BaseModel):
    """Aggregated outbound payload — one event per project per run.

    Matches `Schemas.zSatelliteImageryPayload` in `packages/shared`.
    """

    activity_score: float = Field(ge=0.0, le=1.0)
    activity_centroid: GeoPoint | None = None
    activity_trend: float | None = Field(default=None, ge=-1.0, le=1.0)
    ndvi_delta: float | None = Field(default=None, ge=-2.0, le=2.0)
    ndbi_delta: float | None = Field(default=None, ge=-2.0, le=2.0)
    pixel_change_pct: float | None = Field(default=None, ge=0.0, le=100.0)
    scene_findings: list[ActivityFinding] = Field(default_factory=list, max_length=20)
    contract_window: ContractWindow
    aoi_geojson: PolygonGeoJson
    provider: Provider
    cost_usd: float = Field(ge=0.0, default=0.0)
    result_cid: str | None = None
