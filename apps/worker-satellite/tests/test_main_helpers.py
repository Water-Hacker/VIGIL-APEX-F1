"""Tests for vigil_satellite.main pure helpers — _pixel_to_lonlat,
_ndvi_pipeline, _s1_pipeline.
"""

from __future__ import annotations

from datetime import UTC, datetime

import numpy as np
import pytest

from vigil_common.errors import VigilError
from vigil_satellite import main as main_mod
from vigil_satellite.main import (
    ProviderResult,
    _ndvi_pipeline,
    _pixel_to_lonlat,
    _s1_pipeline,
)
from vigil_satellite.schemas import GeoBBox
from vigil_satellite.stac import Scene


def _bbox() -> GeoBBox:
    return GeoBBox(min_lon=11.0, min_lat=3.0, max_lon=12.0, max_lat=4.0)


def test_pixel_to_lonlat_returns_none_for_none_pixel() -> None:
    assert _pixel_to_lonlat(None, _bbox(), (10, 10)) is None


def test_pixel_to_lonlat_returns_none_for_bad_shape() -> None:
    # 3-D shape ⇒ early return None
    assert _pixel_to_lonlat((1, 1), _bbox(), (10, 10, 3)) is None
    # 1-D shape too
    assert _pixel_to_lonlat((1, 1), _bbox(), (10,)) is None


def test_pixel_to_lonlat_centre_pixel_maps_to_centre() -> None:
    bbox = _bbox()
    # 10x10 grid, centre pixel at (5, 5) → lon ≈ 11.55, lat ≈ 3.45
    pt = _pixel_to_lonlat((5, 5), bbox, (10, 10))
    assert pt is not None
    assert 11.5 < pt.lon < 11.6
    assert 3.4 < pt.lat < 3.5


def test_pixel_to_lonlat_origin_corner() -> None:
    """Pixel (0,0) maps to roughly (min_lon + 0.5/w*dlon, max_lat - 0.5/h*dlat)."""
    bbox = _bbox()
    pt = _pixel_to_lonlat((0, 0), bbox, (10, 10))
    assert pt is not None
    assert pt.lon < 11.2  # close to min_lon
    assert pt.lat > 3.9  # close to max_lat


def _scene(item_id: str, sensor: str = "sentinel-2-l2a", *, cloud: float = 0.0) -> Scene:
    return Scene(
        item_id=item_id,
        sensor=sensor,
        captured_at=datetime(2025, 1, 1, tzinfo=UTC),
        cloud_pct=cloud,
        bands={"red": f"h-red-{item_id}", "nir": f"h-nir-{item_id}", "swir": f"h-swir-{item_id}"},
    )


def test_ndvi_pipeline_returns_none_when_no_matching_sensor() -> None:
    """No pair where before/after share a sensor ⇒ pipeline returns None."""
    before = [_scene("B1", sensor="sentinel-2-l2a")]
    after = [_scene("A1", sensor="landsat-c2-l2")]
    result = _ndvi_pipeline(before, after, _bbox(), provider="sentinel-2", cost=0.0)
    assert result is None


def test_ndvi_pipeline_returns_none_when_read_band_fails(monkeypatch: pytest.MonkeyPatch) -> None:
    """All read_band calls raising VigilError ⇒ no findings ⇒ pipeline returns None."""

    def boom(*_args, **_kwargs):  # type: ignore[no-untyped-def]
        raise VigilError(code="X", message="cannot read", severity="warn")

    monkeypatch.setattr(main_mod, "read_band", boom)
    before = [_scene("B1")]
    after = [_scene("A1")]
    result = _ndvi_pipeline(before, after, _bbox(), provider="sentinel-2", cost=0.0)
    assert result is None


def test_ndvi_pipeline_with_real_band_data(monkeypatch: pytest.MonkeyPatch) -> None:
    """Provide synthetic bands so compute_activity runs end-to-end."""

    # Make read_band return varied flat arrays so NDVI/NDBI change
    calls = {"n": 0}
    arrays = [
        np.full((16, 16), 0.10, dtype=np.float32),  # b_red
        np.full((16, 16), 0.40, dtype=np.float32),  # b_nir
        np.full((16, 16), 0.20, dtype=np.float32),  # b_swir
        np.full((16, 16), 0.20, dtype=np.float32),  # a_red
        np.full((16, 16), 0.20, dtype=np.float32),  # a_nir
        np.full((16, 16), 0.40, dtype=np.float32),  # a_swir
    ]

    def fake_read(_href, _aoi, target_resolution_m=10.0):  # type: ignore[no-untyped-def]
        i = calls["n"]
        calls["n"] += 1
        return arrays[i % len(arrays)]

    monkeypatch.setattr(main_mod, "read_band", fake_read)
    before = [_scene("B1")]
    after = [_scene("A1")]
    result = _ndvi_pipeline(before, after, _bbox(), provider="sentinel-2", cost=0.0)
    assert isinstance(result, ProviderResult)
    assert result.provider == "sentinel-2"
    assert result.findings
    assert result.activity_score > 0.5


def test_s1_pipeline_returns_none_when_empty() -> None:
    assert _s1_pipeline([], [], _bbox()) is None


def test_s1_pipeline_returns_none_when_band_read_fails(monkeypatch: pytest.MonkeyPatch) -> None:
    def boom(*_args, **_kwargs):  # type: ignore[no-untyped-def]
        raise VigilError(code="S1_X", message="bad", severity="warn")

    monkeypatch.setattr(main_mod, "read_s1_vv_backscatter", boom)
    # S1 scenes carry a {"vv": href} band map (not red/nir/swir).
    s1_scene = Scene(
        item_id="X",
        sensor="sentinel-1-rtc",
        captured_at=datetime(2025, 1, 1, tzinfo=UTC),
        cloud_pct=0.0,
        bands={"vv": "h-vv"},
    )
    assert _s1_pipeline([s1_scene], [s1_scene], _bbox()) is None


def test_s1_pipeline_succeeds_with_synthetic_bands(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_read(_href, _aoi):  # type: ignore[no-untyped-def]
        return np.full((10, 10), 0.5, dtype=np.float32)

    monkeypatch.setattr(main_mod, "read_s1_vv_backscatter", fake_read)

    # Use a scene with bands containing 'vv' key
    scene_vv = Scene(
        item_id="S-1",
        sensor="sentinel-1-rtc",
        captured_at=datetime(2025, 1, 1, tzinfo=UTC),
        cloud_pct=0.0,
        bands={"vv": "h-vv"},
    )
    result = _s1_pipeline([scene_vv], [scene_vv], _bbox())
    assert result is not None
    assert result.provider == "sentinel-1"
    # Identical before/after ⇒ rel == 0 ⇒ score == 0
    assert result.activity_score == 0.0
    assert len(result.findings) == 1
