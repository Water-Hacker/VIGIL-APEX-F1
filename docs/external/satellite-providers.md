# Satellite imagery providers — VIGIL APEX

DECISION-010 wires three free providers and two paid hooks. The runtime
chain (env: `SATELLITE_PROVIDER_CHAIN`) determines try-order; the worker
falls through on any per-provider error.

## Comparison

| Provider | Resolution | Free / paid | License | Cameroon | Latency |
|---|---|---|---|---|---|
| **Planet NICFI** | 3–4.77 m | Free (tropical-MOU tier) | Derivative works permitted | ✅ qualifies | monthly basemap |
| **Sentinel-2 L2A** | 10 m | Free | Creative Commons 0 (Copernicus) | ✅ | 5–10 day revisit |
| **Sentinel-1 RTC SAR** | 10 m | Free | Creative Commons 0 (Copernicus) | ✅ | 6–12 day revisit; cloud-penetrating |
| Maxar WV-3 | 0.31 m | Paid (~$100–$1000 / scene) | per-scene licence | ✅ | on-tasking |
| Airbus SPOT | 1.5 m | Paid (~$200–$800 / scene) | per-scene licence | ✅ | on-tasking |

## Default chain rationale

For Phase-1 free-tier coverage of Cameroon:

1. **NICFI** — best resolution at zero marginal cost; resolves construction
   equipment / ground clearing on a typical infrastructure project AOI.
   Requires `PLANET_API_KEY` after the architect submits the MOU
   (`docs/external/planet-nicfi-mou.md`).
2. **Sentinel-2** — global, frequent, well-supported by Microsoft
   Planetary Computer's free STAC catalog. NDVI / NDBI delta gives a
   reliable activity signal at 10 m where construction footprints are
   ≥ ~3–4 pixels.
3. **Sentinel-1 SAR** — cloud-penetrating fallback for the rainy season
   (Cameroon's central / western regions average 60–80 % cloud cover from
   April to October). VV-band backscatter delta is a coarser proxy
   (`activity_score` reflects "did anything change", not what); operators
   should treat S1-only verifications as preliminary.

## Cost ceiling enforcement

`SATELLITE_MAX_COST_PER_REQUEST_USD` (default `0`) gates Maxar / Airbus.
The worker drops paid providers from the chain when the budget is zero,
so the integration code stays warm without burning money.

## Do-not-call until budget approved

- Maxar (Vivid HD on-tasking)
- Airbus SPOT / Pléiades on-tasking
- SkyFi marketplace
- Capella SAR (already redundant with Sentinel-1)

These providers' API keys remain `PLACEHOLDER` in `.env.example`; the
code path for them throws `SATELLITE_PROVIDER_NOT_IMPLEMENTED` so the
chain falls through to the next free provider.
