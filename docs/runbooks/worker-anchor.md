# Runbook — worker-anchor

> Polygon mainnet anchor for the audit chain. Hourly Merkle root
> commit + 5-second high-significance individual anchor.
> Polygon-signer YubiKey via UDS to host signer daemon.
>
> **Service:** [`apps/worker-anchor/`](../../apps/worker-anchor/) — YubiKey-protected signing path (no in-process private key).

---

## Description

### 🇫🇷

Ancre la chaîne d'audit sur Polygon mainnet. Deux boucles :

1. **Lot horaire** — calcule un Merkle root sur `audit.actions[fromSeq..toSeq]`,
   appelle `anchor.commit(fromSeq, toSeq, rootHash)` ; signature
   via le démon Polygon-signer côté hôte (clé sur YubiKey
   dédiée, jamais en mémoire conteneur).
2. **Voie rapide haute-signification** — toutes les 5 s, ancre
   chaque événement `high_significance=true` individuellement
   ; record `(event_id, polygon_tx_hash)` dans
   `audit.public_anchor`.

### 🇬🇧

Anchors the audit chain to Polygon mainnet. Two loops:

1. **Hourly batch** — computes a Merkle root over
   `audit.actions[fromSeq..toSeq]`, calls
   `anchor.commit(fromSeq, toSeq, rootHash)`; signature via the
   host-side Polygon-signer daemon (key on a dedicated YubiKey,
   never in container memory).
2. **High-sig fast lane** — every 5 s, anchors each
   `high_significance=true` event individually; records
   `(event_id, polygon_tx_hash)` in `audit.public_anchor`.

---

## Boot sequence

1. `getPool()` — Postgres.
2. `HashChain` instantiated.
3. `UnixSocketSignerAdapter` — connects to `/run/vigil/polygon-signer.sock`.
4. **Boot guard** (Block-B B.2): `POLYGON_ANCHOR_CONTRACT` regex check
   — refuses to start if the env var doesn't match `^0x[0-9a-fA-F]{40}$`.
5. `PolygonAnchor` constructed with the contract + signer + RPC URL.
6. Two loops launched in parallel (hourly batch + 5-second fast lane).

---

## Health-check signals

| Metric                                                   | Healthy | Unhealthy → action                                  |
| -------------------------------------------------------- | ------- | --------------------------------------------------- |
| `up{instance=~".*worker-anchor.*"}`                      | `1`     | `0` > 2 min → P0                                    |
| `vigil_worker_last_tick_seconds{worker="worker-anchor"}` | < 2 h   | > 2 h → P1 (the loop is hourly; some lag is normal) |
| `vigil_polygon_anchor_total{outcome="ok"}` rate          | > 0     | flat for 2 h → batch loop wedged                    |

## SLO signals

| Metric                                              | SLO target | Investigate-worthy                                                |
| --------------------------------------------------- | ---------- | ----------------------------------------------------------------- |
| `vigil_audit_high_sig_anchor_lag_seconds` p99       | < 30 s     | > 5 min → fast-lane loop wedged                                   |
| `vigil_polygon_anchor_total{outcome="failed"}` rate | 0          | > 0 → page on-call (alert: `PolygonAnchorFailing`)                |
| Gas-price-hit rate                                  | < 5/day    | > 20/day → POLYGON_GAS_PRICE_GWEI_MAX too low for current network |

---

## Common failures

| Symptom                                     | Likely cause                                            | Mitigation                                                                    |
| ------------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Anchor commit timeout                       | RPC provider down or rate-limited                       | Verify `POLYGON_RPC_URL`; cycle to fallback URL; check Alchemy/Infura status. |
| `signer-uds-failed` log lines               | host signer daemon down                                 | `systemctl status vigil-polygon-signer`; restart if needed.                   |
| Polygon-signer YubiKey unplugged            | hardware not seated OR architect removed for ceremony   | Re-seat; signer auto-recovers when YubiKey re-detected.                       |
| Gas-price-hit (commit refused at threshold) | network congestion exceeds `POLYGON_GAS_PRICE_GWEI_MAX` | Operator decision: raise the cap OR wait for the gas window to drop.          |

---

## R1 — Routine deploy

```sh
docker compose pull worker-anchor
docker compose up -d worker-anchor
```

The host-side Polygon-signer daemon must be up. If it's not, the
worker's UDS connect fails at boot and the container exits.

## R2 — Restore from backup

Reads `audit.actions` + writes `audit.anchor_commitment` +
`audit.public_anchor`. Both in Postgres. After restore, the worker
resumes from the last anchored seq and walks forward.

## R3 — Credential rotation

**YubiKey-protected signing path** — full YubiKey rotation per
HSK-v1 §6. The Polygon-signer YubiKey is the dedicated wallet key;
rotation is a hardware ceremony:

1. Architect generates new wallet via `age-plugin-yubikey` on the
   replacement YubiKey (HSK-v1 §6.4).
2. Fund the new wallet (Polygon mainnet MATIC).
3. Update the contract owner if relevant (typically not for
   anchor commits — the contract is single-owner; rotating the
   YubiKey alone is sufficient as long as the address stays the
   same via the same recovery seed).
4. Phase-2 deep-cold backup: also update the safe-deposit box
   replica per HSK-v1 §5.6.

The signer daemon reads the YubiKey on boot; restart the daemon
after physical swap.

`POLYGON_ANCHOR_CONTRACT` itself is the contract address, not a
credential, and only changes if a new contract is deployed
(Phase-7 ceremony). Rotation otherwise is a no-op.

## R5 — Incident response

| Severity | Trigger                                             | Action                                                                                |
| -------- | --------------------------------------------------- | ------------------------------------------------------------------------------------- |
| **P0**   | High-sig events not anchored for > 5 min            | Page architect 24/7. TAL-PA breach risk; CONAC delivery may halt.                     |
| **P0**   | Polygon-signer YubiKey suspected lost/compromised   | Page architect. Initiate emergency wallet rotation per HSK-v1 §6.4 + draw down funds. |
| **P1**   | Hourly anchor commit failed > 5 in 1 h              | Page on-call (alert: `PolygonAnchorFailing`). Investigate RPC + gas window.           |
| **P2**   | Gas-price-hit threshold exceeded > 50 % of attempts | Operator decision: raise `POLYGON_GAS_PRICE_GWEI_MAX` for the day OR wait.            |
| **P3**   | RPC provider rate-limit warnings                    | Verify Alchemy plan; consider adding a fallback RPC.                                  |

## R4 — Council pillar rotation

`worker-anchor` anchors `governance.pillar_*` events as
HIGH_SIGNIFICANCE. R4 rotation procedure in
[R4-council-rotation.md](./R4-council-rotation.md) §Procedure step 6
relies on this worker confirming the on-chain anchor within 5 min.

## R6 — Monthly DR exercise

Critical scope. See [R6-dr-rehearsal.md](./R6-dr-rehearsal.md).
The post-restore catch-up window may take ~1 h to anchor every
unanchored row from the recovered Postgres state.

---

## Cross-references

- [`apps/worker-anchor/src/index.ts`](../../apps/worker-anchor/src/index.ts) — handler + boot guard.
- [`apps/worker-anchor/src/high-sig-loop.ts`](../../apps/worker-anchor/src/high-sig-loop.ts) — fast-lane loop.
- [`apps/worker-anchor/__tests__/contract-address-guard.test.ts`](../../apps/worker-anchor/__tests__/contract-address-guard.test.ts) — Block-B A9 regression pin.
- [`packages/audit-chain/src/anchor.ts`](../../packages/audit-chain/src/anchor.ts) — PolygonAnchor class.
- **SRD §22** — anchoring.
- **SRD §17.7** — Polygon transaction signing flow.
- **DECISION-012** — TAL-PA: high-sig fast lane.
- **HSK-v1 §6.4** — Polygon-signer YubiKey rotation.
- **HSK-v1 §5.6** — deep-cold backup.
- **Block-B A9** — POLYGON_ANCHOR_CONTRACT regex guard (commit `7230283`).
