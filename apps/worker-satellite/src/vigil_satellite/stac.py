"""STAC + COG I/O for worker-satellite.

We use Microsoft Planetary Computer's free-and-tokenless STAC catalog by
default. The Sentinel Hub / Sentinel-2 L2A collection has been the most
reliable since 2019 over Cameroon. Landsat C2 L2 is the fallback when MPC
returns no Sentinel scenes (e.g. heavy cloud).
"""

from __future__ import annotations

import math
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, cast

import numpy as np
import rasterio
from numpy.typing import NDArray
from pyproj import Transformer
from pystac_client import Client
from rasterio.io import MemoryFile
from rasterio.warp import Resampling, reproject

from vigil_common.errors import VigilError
from vigil_common.logging import get_logger

from .schemas import GeoBBox, GeoPoint

try:
    # `planetary_computer` ships no py.typed marker; we opt out of stub
    # analysis for this optional dependency rather than vendor a stub.
    import planetary_computer as _pc  # type: ignore[import-untyped]
except Exception:  # optional dep; absence is non-fatal — callers fall through
    _pc = None

_logger = get_logger("vigil-satellite.stac")

# Sentinel-2 band names per MPC's STAC item-asset key
_S2_RED = "B04"
_S2_NIR = "B08"
_S2_SWIR16 = "B11"

# Landsat 8/9 C2 L2 surface-reflectance band names
_LS_RED = "red"
_LS_NIR = "nir08"
_LS_SWIR16 = "swir16"


@dataclass(frozen=True)
class Scene:
    """A satellite scene resolved against the AOI."""

    item_id: str
    sensor: str
    captured_at: datetime
    cloud_pct: float
    bands: dict[str, str]  # asset_key → signed COG href


def bbox_around(centroid: GeoPoint, buffer_m: int) -> GeoBBox:
    """Return a metric-buffered bbox around a lat/lon centroid."""
    # Approximate metres-per-degree at the centroid's latitude
    deg_per_m_lat = 1 / 111_320
    deg_per_m_lon = 1 / (111_320 * max(math.cos(math.radians(centroid.lat)), 1e-6))
    dlat = buffer_m * deg_per_m_lat
    dlon = buffer_m * deg_per_m_lon
    return GeoBBox(
        min_lon=centroid.lon - dlon,
        min_lat=centroid.lat - dlat,
        max_lon=centroid.lon + dlon,
        max_lat=centroid.lat + dlat,
    )


def search_scenes(
    *,
    catalog_url: str,
    aoi: GeoBBox,
    when: datetime,
    window_days: int = 90,
    sensors: Iterable[str] = ("sentinel-2-l2a", "landsat-c2-l2"),
    max_cloud: float = 30.0,
    limit: int = 6,
) -> list[Scene]:
    """STAC search for the closest cloud-low scenes around `when`."""
    client = Client.open(catalog_url, modifier=_planetary_computer_signer())
    start = (when - timedelta(days=window_days)).isoformat()
    end = (when + timedelta(days=window_days)).isoformat()
    found: list[Scene] = []
    for sensor in sensors:
        try:
            search = client.search(
                collections=[sensor],
                bbox=[aoi.min_lon, aoi.min_lat, aoi.max_lon, aoi.max_lat],
                datetime=f"{start}/{end}",
                query={"eo:cloud_cover": {"lt": max_cloud}},
                max_items=limit,
            )
            for item in search.items():
                if sensor == "sentinel-2-l2a":
                    bands = {
                        "red": item.assets[_S2_RED].href,
                        "nir": item.assets[_S2_NIR].href,
                        "swir": item.assets[_S2_SWIR16].href,
                    }
                else:
                    bands = {
                        "red": item.assets[_LS_RED].href,
                        "nir": item.assets[_LS_NIR].href,
                        "swir": item.assets[_LS_SWIR16].href,
                    }
                cloud = float(item.properties.get("eo:cloud_cover", 0.0))
                found.append(
                    Scene(
                        item_id=item.id,
                        sensor=sensor,
                        captured_at=item.datetime or when,
                        cloud_pct=cloud,
                        bands=bands,
                    )
                )
        except Exception as e:
            _logger.warning("stac-search-failed", sensor=sensor, error=str(e))
    if not found:
        raise VigilError(
            code="SATELLITE_NO_SCENES",
            message=f"no scenes for AOI in [{start}..{end}] across {list(sensors)}",
            severity="warn",
            retryable=True,
        )
    found.sort(key=lambda s: s.cloud_pct)
    return found[:limit]


def _planetary_computer_signer() -> Callable[[Any], Any] | None:
    """Return a `pystac-client` modifier that signs MPC asset URLs.

    `planetary_computer` is imported at module load (top-level, guarded);
    its absence is non-fatal — we return None and callers fall through.
    """
    if _pc is None:
        return None
    # `_pc.sign_inplace` is Any because planetary_computer is stub-less.
    return cast("Callable[[Any], Any]", _pc.sign_inplace)


def read_band(href: str, aoi: GeoBBox, target_resolution_m: float = 10.0) -> NDArray[np.float32]:
    """Read a band over the AOI as a float32 numpy array."""
    with rasterio.open(href) as src:
        # Reproject AOI bounds to the source CRS
        transformer = Transformer.from_crs("EPSG:4326", src.crs, always_xy=True)
        x0, y0 = transformer.transform(aoi.min_lon, aoi.min_lat)
        x1, y1 = transformer.transform(aoi.max_lon, aoi.max_lat)
        win = src.window(min(x0, x1), min(y0, y1), max(x0, x1), max(y0, y1))
        data = src.read(1, window=win, masked=True)

    # Normalise to surface-reflectance scale [0, 1] for both Sentinel-2 (10000)
    # and Landsat-C2 (0.0000275 * x + -0.2). We use the simpler /10000 path since
    # both COGs we read carry uint16 reflectance * 10000 in their default form.
    arr = np.asarray(data.filled(np.nan), dtype=np.float32)
    if arr.size == 0:
        raise VigilError(
            code="SATELLITE_EMPTY_WINDOW",
            message="STAC window read returned 0 pixels",
            severity="warn",
        )
    arr = arr / 10_000.0
    return arr


def read_cog_to_bytes(href: str) -> bytes:
    """Read a COG into bytes — used by tests / archival."""
    with (
        rasterio.open(href) as src,
        MemoryFile() as memfile,
        memfile.open(
            driver="GTiff",
            count=1,
            dtype=src.dtypes[0],
            crs=src.crs,
            transform=src.transform,
            width=src.width,
            height=src.height,
            compress="deflate",
        ) as dst,
    ):
        dst.write(src.read(1), 1)
        memfile.seek(0)
        # rasterio is stub-less (`ignore_missing_imports = True` in mypy.ini);
        # the read returns Any. Cast localises the boundary.
        return cast("bytes", memfile.read())


def reproject_match(src: NDArray[np.float32], target_shape: tuple[int, int]) -> NDArray[np.float32]:
    """Resample to a target shape via bilinear interpolation."""
    out = np.empty(target_shape, dtype=np.float32)
    reproject(
        source=src,
        destination=out,
        src_crs="EPSG:4326",
        dst_crs="EPSG:4326",
        resampling=Resampling.bilinear,
    )
    return out
