"""Planet NICFI close-view provider.

NICFI ("Norway International Climate and Forest Initiative") provides
free monthly basemaps over the tropics at 4.77 m/pixel, sufficient to
spot construction equipment and ground-clearing on infrastructure
projects. Cameroon qualifies under the tropical coverage; once the
architect's MOU is countersigned (see `docs/external/planet-nicfi-mou.md`),
this provider activates automatically.

Cost model: $0 / scene under the qualifying-organisation tier.
"""

from __future__ import annotations

import os
from datetime import datetime, timedelta

from pystac_client import Client

from vigil_common.errors import VigilError
from vigil_common.logging import get_logger

from .schemas import GeoBBox
from .stac import Scene

_logger = get_logger("vigil-satellite.nicfi")

_NICFI_DEFAULT_CATALOG = "https://api.planet.com/basemaps/v1/stac"
_NICFI_COLLECTION = "planet-nicfi-monthly"


def _has_credentials() -> bool:
    return bool(os.environ.get("PLANET_API_KEY"))


def _bearer_signer():  # type: ignore[no-untyped-def]
    """Return a pystac-client modifier that adds the Planet bearer token."""

    api_key = os.environ.get("PLANET_API_KEY")
    if not api_key:
        return None

    def _sign(item) -> object:  # type: ignore[no-untyped-def]
        for asset in item.assets.values():
            asset.href = (
                asset.href
                + ("&" if "?" in asset.href else "?")
                + f"api_key={api_key}"
            )
        return item

    return _sign


def search_nicfi_scenes(
    *,
    aoi: GeoBBox,
    when: datetime,
    window_days: int = 60,
    max_cloud: float = 20.0,
    limit: int = 4,
) -> list[Scene]:
    """STAC search against Planet NICFI monthly basemaps.

    Raises `VigilError` with `code='SATELLITE_NICFI_DISABLED'` if no API key
    is configured — caller should fall through to the next provider.
    """
    if not _has_credentials():
        raise VigilError(
            code="SATELLITE_NICFI_DISABLED",
            message="PLANET_API_KEY not set; NICFI provider not active",
            severity="info",
            retryable=False,
        )

    catalog_url = os.environ.get("PLANET_NICFI_CATALOG_URL", _NICFI_DEFAULT_CATALOG)
    client = Client.open(catalog_url, modifier=_bearer_signer())
    start = (when - timedelta(days=window_days)).isoformat()
    end = (when + timedelta(days=window_days)).isoformat()
    found: list[Scene] = []
    try:
        search = client.search(
            collections=[_NICFI_COLLECTION],
            bbox=[aoi.min_lon, aoi.min_lat, aoi.max_lon, aoi.max_lat],
            datetime=f"{start}/{end}",
            max_items=limit,
        )
        for item in search.items():
            cloud = float(item.properties.get("eo:cloud_cover", 0.0))
            if cloud > max_cloud:
                continue
            # NICFI quad-tile assets are RGB-NIR; map to band slots used by
            # activity computation. NDVI uses Red + NIR; NDBI uses SWIR which
            # NICFI lacks, so we set NDBI to NaN downstream when provider=nicfi.
            assets = item.assets
            red_href = (assets.get("Red") or assets.get("red")).href if (
                assets.get("Red") or assets.get("red")
            ) else None
            nir_href = (assets.get("NIR") or assets.get("nir")).href if (
                assets.get("NIR") or assets.get("nir")
            ) else None
            if not red_href or not nir_href:
                continue
            found.append(
                Scene(
                    item_id=item.id,
                    sensor="planet-nicfi-monthly",
                    captured_at=item.datetime or when,
                    cloud_pct=cloud,
                    bands={
                        "red": red_href,
                        "nir": nir_href,
                        # NICFI has no SWIR; reuse NIR as a placeholder so the
                        # activity computation completes without NDBI.
                        "swir": nir_href,
                    },
                )
            )
    except Exception as e:  # noqa: BLE001
        _logger.warning("nicfi-search-failed", error=str(e))
    if not found:
        raise VigilError(
            code="SATELLITE_NICFI_NO_SCENES",
            message="NICFI returned no qualifying scenes",
            severity="info",
            retryable=True,
        )
    found.sort(key=lambda s: s.cloud_pct)
    return found
