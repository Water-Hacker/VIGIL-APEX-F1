"""Tests for vigil_satellite.sentinel1 — scene search + activity score."""

from __future__ import annotations

import warnings
from datetime import UTC, datetime
from unittest.mock import MagicMock, patch

import numpy as np
import pytest

from vigil_common.errors import VigilError
from vigil_satellite.schemas import GeoBBox
from vigil_satellite.sentinel1 import s1_activity_score, search_s1_scenes


def _bbox() -> GeoBBox:
    return GeoBBox(min_lon=11.5, min_lat=3.85, max_lon=11.55, max_lat=3.9)


def test_s1_activity_score_empty_array_returns_zero() -> None:
    a = np.array([], dtype=np.float32)
    b = np.array([], dtype=np.float32)
    assert s1_activity_score(a, b) == 0.0


def test_s1_activity_score_zero_mean_returns_zero() -> None:
    """A zero before-mean disables the ratio path (b <= 0)."""
    a = np.zeros((4, 4), dtype=np.float32)
    b = np.ones((4, 4), dtype=np.float32)
    assert s1_activity_score(a, b) == 0.0


def test_s1_activity_score_nan_returns_zero() -> None:
    """A non-finite mean (all-NaN before) ⇒ score is zero."""
    a = np.full((4, 4), np.nan, dtype=np.float32)
    b = np.ones((4, 4), dtype=np.float32)
    # numpy emits "Mean of empty slice" RuntimeWarning on all-NaN nanmean —
    # silence it here; pytest's filterwarnings=error mode would otherwise
    # treat it as a hard failure even though the code under test handles
    # the resulting non-finite value via `not np.isfinite`.
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)
        assert s1_activity_score(a, b) == 0.0


def test_s1_activity_score_proportional_to_delta() -> None:
    """A 50% relative change should land below saturation."""
    before = np.full((10, 10), 0.5, dtype=np.float32)
    after = np.full((10, 10), 0.75, dtype=np.float32)
    score = s1_activity_score(before, after)
    # rel = 0.25/0.5 = 0.5 ; score = min(1, 0.5/1.5) = 0.333...
    assert 0.30 <= score <= 0.40


def test_s1_activity_score_saturates_at_one() -> None:
    """Large delta hits the 1.0 ceiling."""
    before = np.full((10, 10), 0.1, dtype=np.float32)
    after = np.full((10, 10), 1.0, dtype=np.float32)
    assert s1_activity_score(before, after) == 1.0


def test_s1_activity_score_handles_decrease() -> None:
    """Absolute delta — the score is symmetric on direction."""
    before = np.full((10, 10), 1.0, dtype=np.float32)
    after = np.full((10, 10), 0.5, dtype=np.float32)
    score = s1_activity_score(before, after)
    # rel = 0.5/1.0 = 0.5; score = 0.333
    assert 0.30 <= score <= 0.40


def test_search_s1_scenes_no_results_raises() -> None:
    fake_client = MagicMock()
    fake_search = MagicMock()
    fake_search.items.return_value = []
    fake_client.search.return_value = fake_search
    with (
        patch("vigil_satellite.sentinel1.Client.open", return_value=fake_client),
        pytest.raises(VigilError) as exc,
    ):
        search_s1_scenes(
            catalog_url="https://example.com/stac",
            aoi=_bbox(),
            when=datetime(2025, 1, 1, tzinfo=UTC),
        )
    assert exc.value.code == "SATELLITE_S1_NO_SCENES"


def test_search_s1_scenes_skips_items_without_vv_asset() -> None:
    item_no_vv = MagicMock()
    item_no_vv.id = "I1"
    item_no_vv.datetime = datetime(2025, 1, 1, tzinfo=UTC)
    item_no_vv.assets = MagicMock()
    item_no_vv.assets.get.return_value = None

    fake_client = MagicMock()
    fake_search = MagicMock()
    fake_search.items.return_value = [item_no_vv]
    fake_client.search.return_value = fake_search

    with (
        patch("vigil_satellite.sentinel1.Client.open", return_value=fake_client),
        pytest.raises(VigilError) as exc,
    ):
        search_s1_scenes(
            catalog_url="https://example.com/stac",
            aoi=_bbox(),
            when=datetime(2025, 1, 1, tzinfo=UTC),
        )
    assert exc.value.code == "SATELLITE_S1_NO_SCENES"


def test_search_s1_scenes_returns_scenes_when_vv_present() -> None:
    asset = MagicMock()
    asset.href = "https://example.com/vv.tif"

    # Make assets.get behave dict-like
    fake_item = MagicMock()
    fake_item.id = "S1-1"
    fake_item.datetime = datetime(2025, 2, 1, tzinfo=UTC)
    fake_item.assets.get.return_value = asset

    fake_client = MagicMock()
    fake_search = MagicMock()
    fake_search.items.return_value = [fake_item]
    fake_client.search.return_value = fake_search

    with patch("vigil_satellite.sentinel1.Client.open", return_value=fake_client):
        scenes = search_s1_scenes(
            catalog_url="https://example.com/stac",
            aoi=_bbox(),
            when=datetime(2025, 1, 15, tzinfo=UTC),
        )
    assert len(scenes) == 1
    assert scenes[0].sensor == "sentinel-1-rtc"
    assert scenes[0].cloud_pct == 0.0
    assert scenes[0].bands["vv"] == "https://example.com/vv.tif"


def test_search_s1_scenes_swallows_client_failure() -> None:
    fake_client = MagicMock()
    fake_client.search.side_effect = RuntimeError("STAC down")
    with (
        patch("vigil_satellite.sentinel1.Client.open", return_value=fake_client),
        pytest.raises(VigilError) as exc,
    ):
        search_s1_scenes(
            catalog_url="https://example.com/stac",
            aoi=_bbox(),
            when=datetime(2025, 1, 1, tzinfo=UTC),
        )
    assert exc.value.code == "SATELLITE_S1_NO_SCENES"
