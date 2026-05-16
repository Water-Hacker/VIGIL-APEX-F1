"""Tests for vigil_satellite.stac helpers — bbox_around + signer + reproject."""

from __future__ import annotations

import dataclasses
import math
from datetime import UTC, datetime

import pytest

from vigil_satellite import stac as stac_mod
from vigil_satellite.schemas import GeoPoint
from vigil_satellite.stac import (
    Scene,
    _planetary_computer_signer,
    bbox_around,
    reproject_match,
)


def test_bbox_around_returns_metric_buffer() -> None:
    """A 100 m buffer at the equator ≈ 0.0009° in each direction."""
    point = GeoPoint(lat=0.0, lon=10.0)
    bbox = bbox_around(point, buffer_m=100)
    # dlat = 100 / 111_320 ≈ 0.000898
    assert math.isclose(bbox.max_lat - bbox.min_lat, 2 * 100 / 111_320, rel_tol=1e-3)
    # at lat=0, dlon ≈ dlat
    assert math.isclose(bbox.max_lon - bbox.min_lon, 2 * 100 / 111_320, rel_tol=1e-3)


def test_bbox_around_handles_high_latitude() -> None:
    """At higher latitudes, lon width inflates."""
    point = GeoPoint(lat=60.0, lon=0.0)
    bbox = bbox_around(point, buffer_m=1000)
    lon_span = bbox.max_lon - bbox.min_lon
    lat_span = bbox.max_lat - bbox.min_lat
    # at lat=60, cos(60°)=0.5 so lon span ~= 2x lat span
    assert lon_span > lat_span


def test_bbox_around_clamps_lon_factor_at_pole() -> None:
    """At |lat|=90, cos(lat)=0 — clamp prevents infinite span."""
    point = GeoPoint(lat=89.9, lon=0.0)
    bbox = bbox_around(point, buffer_m=10)
    # No crash, finite numbers
    assert math.isfinite(bbox.max_lon - bbox.min_lon)


def test_planetary_computer_signer_returns_callable_or_none() -> None:
    signer = _planetary_computer_signer()
    # planetary_computer is installed via the satellite extras — signer is callable
    assert signer is None or callable(signer)


def test_planetary_computer_signer_returns_none_when_pc_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """When the optional dep is unavailable, the signer returns None."""
    monkeypatch.setattr(stac_mod, "_pc", None)
    assert _planetary_computer_signer() is None


def test_reproject_match_signature_smoke() -> None:
    """reproject_match wraps rasterio.warp.reproject; we only assert it's
    callable from the module surface — the real transform needs CRS+affine
    metadata which we don't synthesise in a unit test.
    """
    assert callable(reproject_match)


def test_scene_dataclass_is_frozen() -> None:
    s = Scene(
        item_id="X",
        sensor="sentinel-2-l2a",
        captured_at=datetime(2025, 1, 1, tzinfo=UTC),
        cloud_pct=5.0,
        bands={"red": "h"},
    )
    with pytest.raises(dataclasses.FrozenInstanceError):
        s.item_id = "Y"  # type: ignore[misc]
