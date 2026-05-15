"""Sentinel-1 SAR cloud-penetrating fallback.

When NICFI and Sentinel-2 fail (cloud-saturated AOI, common over Cameroon
in the rainy season), we fall back to Sentinel-1 RTC backscatter via
Microsoft Planetary Computer's `sentinel-1-rtc` collection. SAR is
weather-agnostic and gives a coarser activity proxy through VV-band
backscatter delta.

The activity score from S1 is intentionally less precise than the NDVI/NDBI
flow — it answers "did anything change on the ground" rather than
"vegetation was lost / structures appeared". Pattern-D operators should
treat S1-only verifications as preliminary; a second NICFI / S2 pass is
attempted when cloud conditions improve.
"""

from __future__ import annotations

from datetime import datetime, timedelta

import numpy as np
import rasterio
from numpy.typing import NDArray
from pyproj import Transformer
from pystac_client import Client

from vigil_common.errors import VigilError
from vigil_common.logging import get_logger

from .schemas import GeoBBox
from .stac import Scene, _planetary_computer_signer

_logger = get_logger("vigil-satellite.sentinel1")

_S1_COLLECTION = "sentinel-1-rtc"
_S1_VV_ASSET = "vv"


def search_s1_scenes(
    *,
    catalog_url: str,
    aoi: GeoBBox,
    when: datetime,
    window_days: int = 90,
    limit: int = 4,
) -> list[Scene]:
    """STAC search for Sentinel-1 RTC scenes; ignores cloud-cover (SAR is
    weather-agnostic)."""
    client = Client.open(catalog_url, modifier=_planetary_computer_signer())
    start = (when - timedelta(days=window_days)).isoformat()
    end = (when + timedelta(days=window_days)).isoformat()
    found: list[Scene] = []
    try:
        search = client.search(
            collections=[_S1_COLLECTION],
            bbox=[aoi.min_lon, aoi.min_lat, aoi.max_lon, aoi.max_lat],
            datetime=f"{start}/{end}",
            max_items=limit,
        )
        for item in search.items():
            asset = item.assets.get(_S1_VV_ASSET)
            if asset is None:
                continue
            found.append(
                Scene(
                    item_id=item.id,
                    sensor=_S1_COLLECTION,
                    captured_at=item.datetime or when,
                    cloud_pct=0.0,  # SAR — clouds irrelevant
                    bands={"vv": asset.href},
                )
            )
    except Exception as e:
        _logger.warning("sentinel1-search-failed", error=str(e))
    if not found:
        raise VigilError(
            code="SATELLITE_S1_NO_SCENES",
            message="Sentinel-1 returned no qualifying scenes",
            severity="info",
            retryable=True,
        )
    found.sort(key=lambda s: s.captured_at)
    return found


def read_s1_vv_backscatter(href: str, aoi: GeoBBox) -> NDArray[np.float32]:
    """Read Sentinel-1 RTC VV backscatter (linear power) over the AOI.

    The MPC RTC collection serves linear-power values; we keep linear (not
    convert to dB) since the activity computation works on relative deltas.
    """
    with rasterio.open(href) as src:
        transformer = Transformer.from_crs("EPSG:4326", src.crs, always_xy=True)
        x0, y0 = transformer.transform(aoi.min_lon, aoi.min_lat)
        x1, y1 = transformer.transform(aoi.max_lon, aoi.max_lat)
        win = src.window(min(x0, x1), min(y0, y1), max(x0, x1), max(y0, y1))
        data = src.read(1, window=win, masked=True)
    arr = np.asarray(data.filled(np.nan), dtype=np.float32)
    if arr.size == 0:
        raise VigilError(
            code="SATELLITE_S1_EMPTY_WINDOW",
            message="Sentinel-1 RTC window read returned 0 pixels",
            severity="warn",
        )
    return arr


def s1_activity_score(
    before_vv: NDArray[np.float32],
    after_vv: NDArray[np.float32],
) -> float:
    """Compute an activity score in [0, 1] from a pair of S1 VV scenes.

    Method: ratio of mean backscatter delta to a fixed reference (1.5 dB
    equivalent, expressed in linear power). New construction shows an
    increase in backscatter; vegetation regrowth shows a decrease. We take
    the absolute relative change so either direction registers.
    """
    if before_vv.size == 0 or after_vv.size == 0:
        return 0.0
    b = float(np.nanmean(before_vv))
    a = float(np.nanmean(after_vv))
    if not np.isfinite(b) or not np.isfinite(a) or b <= 0:
        return 0.0
    rel = abs(a - b) / b
    # Empirical scaling — 1.5x relative change ≈ saturated activity.
    return float(min(1.0, rel / 1.5))
