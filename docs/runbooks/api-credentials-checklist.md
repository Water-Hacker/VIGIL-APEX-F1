# API + credentials checklist (pre-`docker compose up`)

> **Use:** the architect runs through this checklist once before
> bringing up the stack on a fresh host (or before Phase-1 dry run).
> Each row says what credential is needed, where to obtain it, and
> whether it is **blocking** (the system refuses to boot, or the
> source returns no events) or **soft** (the system runs degraded and
> the source falls through to a fallback).
>
> **Quick check:** run [`scripts/check-source-credentials.ts`](../../scripts/check-source-credentials.ts)
> against your `.env` to get a one-screen pass/fail per source.
> Fix the blocking rows before `pnpm compose:up`.

---

## 1. Tier classification

The 29 source feeds in [`infra/sources.json`](../../infra/sources.json)
split four ways by access tier:

| Tier                     | Count | Behaviour                                                                                                   |
| ------------------------ | ----: | ----------------------------------------------------------------------------------------------------------- |
| `public-no-contact`      |    15 | Open data; scraping legitimate; no permission needed; can run from day one.                                 |
| `public-with-courtesy`   |     5 | Public but courtesy outreach to the ministry's communications office is recommended before active scraping. |
| `public-with-engagement` |     5 | Public but explicit engagement is required (call, email, in-person) before sustained scraping.              |
| `mou-gated`              |     3 | Adapter refuses to run until a Memorandum of Understanding is countersigned (env-var ack required).         |

**Phase-1 boot can succeed with only the 15 `public-no-contact`
sources active**; the other 14 fall through gracefully or refuse to
run, depending on the adapter. Production cadence assumes the
courtesy + engagement tiers come online over Phase 1; the MOU-gated
tier is Phase 2.

---

## 2. Platform credentials (always required)

These are the platform-wide keys; **the stack will not boot without
them** (or will boot in degraded mode that cannot ship a finding).

| Key                                        | Where to obtain                                              | Boot status                                                                                                                               |
| ------------------------------------------ | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `ANTHROPIC_API_KEY`                        | console.anthropic.com → API keys                             | **Blocking** for worker-extractor LLM extraction; without it the worker runs deterministic-only (a partial degradation, not a hard fail). |
| `POSTGRES_PASSWORD_FILE`                   | generated at host bootstrap (`infra/host-bootstrap`)         | **Blocking** — every package opens a Pool to it.                                                                                          |
| `REDIS_PASSWORD_FILE`                      | generated at host bootstrap                                  | **Blocking** — every queue worker connects.                                                                                               |
| `VAULT_TOKEN_FILE`                         | issued by AppRole at startup                                 | **Blocking** for any worker that reads from Vault.                                                                                        |
| `GPG_FINGERPRINT` + private key in keyring | architect's hardware-token-backed OpenPGP key                | **Blocking** for worker-dossier (signs every dossier; refuses unsigned in production).                                                    |
| `KEYCLOAK_ADMIN_PASSWORD_FILE`             | generated at host bootstrap                                  | **Blocking** for dashboard auth.                                                                                                          |
| `AUDIT_PUBLIC_EXPORT_SALT`                 | architect rotates per quarter (32 hex bytes)                 | **Blocking** for the quarterly TAL-PA export (DECISION-012); other paths run.                                                             |
| `WEBAUTHN_RP_ID` / `WEBAUTHN_RP_ORIGIN`    | host's public hostname (e.g. `vigilapex.cm`)                 | **Blocking** for council vote — without these the WebAuthn assertion verification rejects every vote.                                     |
| `TIP_OPERATOR_TEAM_PUBKEY`                 | libsodium-generated at council enrolment (3-of-5 ceremony)   | **Soft** — the `/tip` endpoint returns 503 `tip-portal-not-yet-provisioned` until set; rest of platform unaffected.                       |
| `POLYGON_ANCHOR_CONTRACT`                  | deployed at Phase 7 (DECISION-008 Tier-1 guard refuses null) | **Blocking** for worker-anchor; soft for everything else.                                                                                 |
| `POLYGON_RPC_URL`                          | Alchemy / Infura / public Polygon RPC                        | **Soft** — falls back to public RPC with a warning.                                                                                       |

Per the AUDIT-094 note, `POLYGON_ANCHOR_CONTRACT` currently accepts
the literal `PLACEHOLDER_DEPLOYED_AT_M1` — the architect's umbrella-
authorised follow-up tightens that to refuse PLACEHOLDER (umbrella-
deferred at the time of writing).

---

## 3. Per-source credentials

Sources grouped by their `contact.tier` in `infra/sources.json`.
"Boot status" is what happens when the credential is absent or
PLACEHOLDER on stack-up.

### 3.1 `public-no-contact` (15 sources — 0 credentials needed)

These are open data; the platform pulls without auth. **No work for
the architect.**

| Source ID              | What it is                                    |
| ---------------------- | --------------------------------------------- |
| `afdb-sanctions`       | African Development Bank sanctions list (CSV) |
| `dgi-attestations`     | Direction Générale des Impôts — attestations  |
| `eu-sanctions`         | EU consolidated sanctions XML                 |
| `journal-officiel`     | Journal Officiel de la République (PDF index) |
| `minedub-basic-ed`     | MINEDUB sectoral procurement                  |
| `minee-energy`         | MINEE sectoral procurement                    |
| `minesec-secondary-ed` | MINESEC sectoral procurement                  |
| `minhdu-housing`       | MINHDU sectoral procurement                   |
| `minsante-health`      | MINSANTE sectoral procurement                 |
| `mintp-public-works`   | MINTP sectoral procurement                    |
| `occrp-aleph`          | OCCRP Aleph public records (free tier)        |
| `ofac-sdn`             | OFAC SDN list                                 |
| `opencorporates`       | OpenCorporates (free tier)                    |
| `opensanctions`        | OpenSanctions (free tier)                     |
| `un-sanctions`         | UN consolidated sanctions XML                 |
| `worldbank-sanctions`  | World Bank debarred firms list                |

**Note on `occrp-aleph` and `opencorporates`:** the **free tier**
works for low-volume Phase-1 use. Production-scale entity matching
needs a paid key (`ALEPH_API_KEY`, `OPENCORPORATES_API_KEY`); the
adapter falls back to anonymous rate-limited access without one.

### 3.2 `public-with-courtesy` (5 sources — courtesy email recommended)

The architect should send a one-paragraph courtesy email to each
ministry's communications office before sustained scraping. The
adapter runs without it (no env gate), but Phase-1 ethics require
the courtesy. Templates in [docs/templates/institutional/](../templates/institutional/) — adapt the §15 letter to a lighter "courtesy notification" form.

| Source ID          | Who to email                               |
| ------------------ | ------------------------------------------ |
| `cour-des-comptes` | Cour des Comptes — communications          |
| `dgb-budget`       | MINFI / Direction Générale du Budget       |
| `dgtcfm-treasury`  | MINFI / DGTCFM                             |
| `minepat-bip`      | MINEPAT — Banque d'Investissement Publique |
| `minmap-portal`    | MINMAP communications                      |
| `rccm-search`      | OAPI / RCCM secretariat                    |

### 3.3 `public-with-engagement` (5 sources — explicit engagement required)

The architect must engage in person (or by formal letter) before
sustained scraping. EXEC §19.3 specifies this; the adapter does
**not** gate boot on it (that would be technical theatre), but the
architect's institutional record must show the engagement happened.
The CONAC engagement letter template at
[docs/templates/institutional/F3.1-conac-engagement-letter.md](../templates/institutional/F3.1-conac-engagement-letter.md)
is the model.

| Source ID        | Who to engage                                                           |
| ---------------- | ----------------------------------------------------------------------- |
| `armp-main`      | ARMP DG (~70% of findings come from here per EXEC §19.3 — engage first) |
| `coleps-tenders` | ARMP COLEPS team (COLEPS is an ARMP subsystem)                          |
| `anif-pep`       | ANIF — politically-exposed-persons feed                                 |
| `minfi-portal`   | MINFI — public portal scraping notification                             |

### 3.4 `mou-gated` (3 sources — countersigned MOU required)

Each adapter **refuses to run** until both an env flag AND a
hardware credential are present. Architect drives the MOU; the
build path is wired and waiting.

| Source ID        | Adapter                                                                                                        | Env flag (set after MOU is countersigned)       | Credentials                                                                                                                       |
| ---------------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `minfi-bis`      | [apps/adapter-runner/src/adapters/minfi-bis.ts](../../apps/adapter-runner/src/adapters/minfi-bis.ts)           | `MINFI_BIS_ENABLED=1` AND `MINFI_BIS_MOU_ACK=1` | mTLS client cert, key, CA at `/run/secrets/minfi_bis_*` (paths: `MINFI_BIS_CERT_FILE`, `MINFI_BIS_KEY_FILE`, `MINFI_BIS_CA_FILE`) |
| `beac-payments`  | [apps/adapter-runner/src/adapters/beac-payments.ts](../../apps/adapter-runner/src/adapters/beac-payments.ts)   | `BEAC_ENABLED=1` AND `BEAC_MOU_ACK=1`           | OAuth2 client credentials: `BEAC_CLIENT_ID`, `BEAC_CLIENT_SECRET_FILE`, `BEAC_TOKEN_URL`, `BEAC_BASE_URL`                         |
| `anif-amlscreen` | [apps/adapter-runner/src/adapters/anif-amlscreen.ts](../../apps/adapter-runner/src/adapters/anif-amlscreen.ts) | `ANIF_AML_ENABLED=1` AND `ANIF_AML_MOU_ACK=1`   | API key at `/run/secrets/anif_api_key` (`ANIF_API_KEY_FILE`); `ANIF_PEP_SURFACE_ALLOWED=1` for the PEP-egress flag                |

**MOU sequencing.** Per EXEC §19, the MOU is negotiated **after** the
council is formed and CONAC has issued the F3.1 acknowledgement —
a minimum-viable Phase 2 entry. Pre-MOU, the adapters log their
disabled state on every run and the source returns zero events; this
is intentional and visible in `adapter_health`.

---

## 4. Optional / phase-deferred credentials

The platform ships the wiring; the keys are populated when the
relevant phase activates.

| Key                                        | Phase | What it enables                                                                                                                                                                                                    |
| ------------------------------------------ | ----: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `PLANET_API_KEY`                           |     1 | Planet NICFI close-view satellite imagery (free tier under qualifying-organisation MOU). Without it the satellite worker falls through to Sentinel-2. AUDIT-094 / T1.04 pinned: `PLACEHOLDER` literal is rejected. |
| `SENTINEL_HUB_CLIENT_ID/SECRET`            |     1 | Sentinel Hub commercial tier (optional; default is free Copernicus Open Access Hub).                                                                                                                               |
| `MAPBOX_ACCESS_TOKEN`                      |     1 | Map rendering on the dashboard (without it, maps render with OSM defaults).                                                                                                                                        |
| `MAXAR_API_KEY`                            |     2 | Maxar high-resolution imagery (paid; deferred).                                                                                                                                                                    |
| `AIRBUS_API_KEY`                           |     2 | Airbus Pleiades imagery (paid; deferred).                                                                                                                                                                          |
| `PROXY_BRIGHT_DATA_USERNAME/PASSWORD`      |     1 | Residential proxy rotation for adapter requests (optional; without it, requests go direct).                                                                                                                        |
| `CAPTCHA_API_KEY`                          |     1 | 2Captcha-style solver for captcha-gated sources (only `coleps-tenders` typically needs it).                                                                                                                        |
| `CONAC_SFTP_HOST` + hostkey                |     6 | CONAC SFTP delivery endpoint. Provisioned at the F3.1 letter follow-up.                                                                                                                                            |
| `COUR_DES_COMPTES_SFTP_HOST`               |     6 | Plan-B delivery endpoint per DECISION-010.                                                                                                                                                                         |
| `FABRIC_PEER_ENDPOINT`                     |     2 | Hyperledger Fabric internal-chain witness (DECISION-008 Phase-2 scaffold).                                                                                                                                         |
| `BACKUP_ARCHITECT_EMAIL` + key fingerprint |     1 | Backup architect identity (W-17 institutional gate).                                                                                                                                                               |

---

## 5. Pre-boot ceremony (recommended order)

1. **Generate platform secrets** — run `infra/host-bootstrap/`
   scripts in numbered order (`00-init-host.sh` through
   `10-vigil-backup.sh`). These produce `POSTGRES_PASSWORD_FILE`,
   `REDIS_PASSWORD_FILE`, `VAULT_TOKEN_FILE`, GPG keyring.
2. **Vault Shamir initialisation** — [docs/runbooks/vault-shamir-init.md](vault-shamir-init.md).
3. **Get `ANTHROPIC_API_KEY`** — paste into Vault (path
   `secret/data/vigil/anthropic`); the dashboard reads via
   `VaultClient.read('anthropic', 'api_key')`.
4. **Generate `AUDIT_PUBLIC_EXPORT_SALT`** — `openssl rand -hex 32`,
   put in Vault (`secret/data/vigil/audit/public_export_salt`).
5. **Set `WEBAUTHN_RP_ID` / `WEBAUTHN_RP_ORIGIN`** — to the host's
   public hostname (no `https://` for `RP_ID`; with `https://` for
   `RP_ORIGIN`).
6. **Run the credential precheck:**
   ```bash
   node_modules/.pnpm/node_modules/.bin/tsx scripts/check-source-credentials.ts
   ```
   It reports every source's per-tier readiness. Fix the
   `BLOCKING` rows.
7. **`pnpm compose:up`** — boots the stack. With only Tier-1
   platform secrets set + the 15 `public-no-contact` sources
   active, the platform processes findings end-to-end at reduced
   coverage (no MOU-gated feeds, no Tier-1 satellite imagery).

---

## 6. What's safe to defer to "after first dry run"

- All MOU-gated sources (Phase 2).
- `BACKUP_ARCHITECT_*` (W-17 institutional gate).
- `CONAC_SFTP_HOST` (Phase 6 — after F3.1 acknowledgement).
- `MAXAR_API_KEY` / `AIRBUS_API_KEY` (Phase 2 paid imagery).
- `FABRIC_PEER_ENDPOINT` (Phase 2 cross-witness).

Operating in this state for the dry run is correct: the platform
will produce findings from public sources, push them through the
council, and stop short of CONAC delivery (which is gated on the
Phase 6 SFTP endpoint anyway).
