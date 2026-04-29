# Planet NICFI MOU — registration steps

The Norway International Climate and Forest Initiative (NICFI) provides
free monthly Planet basemaps over the tropics for "qualifying organisations
working in tropical-forest conservation, sustainable land use, climate or
biodiversity." VIGIL APEX's anti-corruption mandate against irregular
infrastructure spend is intersectional with forest protection (a large
share of un-verified Cameroonian projects in MINEPAT's BIP touch
forested areas) and qualifies on those grounds.

## Steps the architect takes

1. **Eligibility application** — fill the public form at
   `https://www.planet.com/nicfi/apply` (or the successor URL on the
   Planet portal). Use:
   - Organisation name: VIGIL APEX SAS (Cameroun)
   - Country of operation: Cameroon
   - Use category: "Government / public-finance accountability"
   - Stated outcome: anti-corruption verification of public-funded
     infrastructure projects in 10 administrative regions of Cameroon
   - Expected scene volume: ~500 AOIs / month at 4.77 m, ~50 AOIs / month
     at 3 m
2. **MOU acknowledgement** — Planet returns a memorandum specifying:
   - Permitted users (architect + council-approved analysts)
   - Permitted derivative works (CONAC dossiers, public verify pages —
     all permitted under NICFI Article 4)
   - Required acknowledgement string in any published derivative
3. **API key issuance** — the Planet console exposes a per-organisation
   API key. Store it in Vault under `secret/data/satellite/planet-nicfi`
   and populate `PLANET_API_KEY` from the deploy environment.
4. **Code activation** — once the env var is non-PLACEHOLDER,
   `worker-satellite/src/vigil_satellite/nicfi.py` self-activates and the
   provider chain places NICFI before Sentinel-2.

## Phase-1 fallback

Until the API key is provisioned, the provider chain skips NICFI silently
(see `_run_provider` in `apps/worker-satellite/src/vigil_satellite/main.py`)
and proceeds with Sentinel-2 then Sentinel-1. No code path breaks; the
audit chain records `provider_used = sentinel-2` as the source of every
finding for this period.

## Required attribution

Every derivative work shipped to CONAC / Cour des Comptes / MINFI / ANIF
must include the line:

> Imagery © 2024–YYYY Planet Labs PBC. Provided under NICFI Article 4
> for qualifying organisation use.

The dossier renderer's footer block (`packages/dossier/src/render.ts`)
will be updated to emit this line automatically when the underlying
finding cites a NICFI scene.
