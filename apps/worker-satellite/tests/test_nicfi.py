"""Tests for vigil_satellite.nicfi — credential gating + bearer signer."""

from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import MagicMock, patch

import pytest

from vigil_common.errors import VigilError
from vigil_satellite.nicfi import (
    _bearer_signer,
    _has_credentials,
    search_nicfi_scenes,
)
from vigil_satellite.schemas import GeoBBox


def _bbox() -> GeoBBox:
    return GeoBBox(min_lon=11.5, min_lat=3.85, max_lon=11.55, max_lat=3.9)


def test_has_credentials_returns_false_without_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("PLANET_API_KEY", raising=False)
    assert _has_credentials() is False


def test_has_credentials_returns_true_with_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("PLANET_API_KEY", "abc-key")
    assert _has_credentials() is True


def test_bearer_signer_returns_none_without_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("PLANET_API_KEY", raising=False)
    assert _bearer_signer() is None


def test_bearer_signer_appends_query_param(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("PLANET_API_KEY", "MY-KEY")
    sign = _bearer_signer()
    assert sign is not None

    # Build a fake item with two assets
    fake_asset_1 = MagicMock()
    fake_asset_1.href = "https://api.planet.com/x.tif"
    fake_asset_2 = MagicMock()
    fake_asset_2.href = "https://api.planet.com/y.tif?token=z"

    fake_item = MagicMock()
    fake_item.assets.values.return_value = [fake_asset_1, fake_asset_2]

    sign(fake_item)
    assert fake_asset_1.href.endswith("?api_key=MY-KEY")
    # Second one already had a query string → appended with `&`
    assert fake_asset_2.href.endswith("&api_key=MY-KEY")


def test_search_nicfi_disabled_without_key_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("PLANET_API_KEY", raising=False)
    with pytest.raises(VigilError) as exc:
        search_nicfi_scenes(
            aoi=_bbox(),
            when=datetime(2025, 1, 1, tzinfo=UTC),
        )
    assert exc.value.code == "SATELLITE_NICFI_DISABLED"


def test_search_nicfi_empty_results_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    """When STAC search returns no items, raise SATELLITE_NICFI_NO_SCENES."""
    monkeypatch.setenv("PLANET_API_KEY", "MY-KEY")
    fake_client = MagicMock()
    fake_search = MagicMock()
    fake_search.items.return_value = []
    fake_client.search.return_value = fake_search
    with (
        patch("vigil_satellite.nicfi.Client.open", return_value=fake_client),
        pytest.raises(VigilError) as exc,
    ):
        search_nicfi_scenes(
            aoi=_bbox(),
            when=datetime(2025, 1, 1, tzinfo=UTC),
        )
    assert exc.value.code == "SATELLITE_NICFI_NO_SCENES"


def test_search_nicfi_skips_items_above_cloud_threshold(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("PLANET_API_KEY", "MY-KEY")

    cloudy_item = MagicMock()
    cloudy_item.id = "I1"
    cloudy_item.datetime = datetime(2025, 1, 1, tzinfo=UTC)
    cloudy_item.properties = {"eo:cloud_cover": 80.0}
    cloudy_item.assets = {}

    fake_client = MagicMock()
    fake_search = MagicMock()
    fake_search.items.return_value = [cloudy_item]
    fake_client.search.return_value = fake_search
    with (
        patch("vigil_satellite.nicfi.Client.open", return_value=fake_client),
        pytest.raises(VigilError) as exc,
    ):
        search_nicfi_scenes(
            aoi=_bbox(),
            when=datetime(2025, 1, 1, tzinfo=UTC),
            max_cloud=20.0,
        )
    assert exc.value.code == "SATELLITE_NICFI_NO_SCENES"


def test_search_nicfi_returns_scenes_with_matching_assets(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("PLANET_API_KEY", "MY-KEY")
    red_a = MagicMock()
    red_a.href = "http://x/red.tif"
    nir_a = MagicMock()
    nir_a.href = "http://x/nir.tif"

    item = MagicMock()
    item.id = "scene-1"
    item.datetime = datetime(2025, 2, 1, tzinfo=UTC)
    item.properties = {"eo:cloud_cover": 5.0}
    item.assets = {"Red": red_a, "NIR": nir_a}

    fake_client = MagicMock()
    fake_search = MagicMock()
    fake_search.items.return_value = [item]
    fake_client.search.return_value = fake_search
    with patch("vigil_satellite.nicfi.Client.open", return_value=fake_client):
        scenes = search_nicfi_scenes(
            aoi=_bbox(),
            when=datetime(2025, 1, 15, tzinfo=UTC),
        )
    assert len(scenes) == 1
    assert scenes[0].item_id == "scene-1"
    assert scenes[0].bands["red"] == "http://x/red.tif"
    assert scenes[0].bands["nir"] == "http://x/nir.tif"
    # NICFI has no SWIR — `swir` placeholder mirrors NIR
    assert scenes[0].bands["swir"] == "http://x/nir.tif"


def test_search_nicfi_drops_items_missing_bands(monkeypatch: pytest.MonkeyPatch) -> None:
    """Items lacking both red and nir assets are skipped."""
    monkeypatch.setenv("PLANET_API_KEY", "MY-KEY")
    item = MagicMock()
    item.id = "scene-2"
    item.datetime = datetime(2025, 2, 1, tzinfo=UTC)
    item.properties = {"eo:cloud_cover": 5.0}
    item.assets = {}  # nothing usable

    fake_client = MagicMock()
    fake_search = MagicMock()
    fake_search.items.return_value = [item]
    fake_client.search.return_value = fake_search
    with (
        patch("vigil_satellite.nicfi.Client.open", return_value=fake_client),
        pytest.raises(VigilError) as exc,
    ):
        search_nicfi_scenes(
            aoi=_bbox(),
            when=datetime(2025, 1, 15, tzinfo=UTC),
        )
    assert exc.value.code == "SATELLITE_NICFI_NO_SCENES"


def test_search_nicfi_swallows_client_open_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Search-side errors are logged and trigger the "no scenes" path."""
    monkeypatch.setenv("PLANET_API_KEY", "MY-KEY")
    fake_client = MagicMock()
    fake_client.search.side_effect = RuntimeError("rate-limit")
    with (
        patch("vigil_satellite.nicfi.Client.open", return_value=fake_client),
        pytest.raises(VigilError) as exc,
    ):
        search_nicfi_scenes(
            aoi=_bbox(),
            when=datetime(2025, 1, 1, tzinfo=UTC),
        )
    assert exc.value.code == "SATELLITE_NICFI_NO_SCENES"
