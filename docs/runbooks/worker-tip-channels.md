# Runbook — worker-tip-channels

> Telecom-gateway ingestion for the USSD/SMS tip channel (SRD §28.5).
> Receives raw tip submissions from the MTN/Orange gateway bridge
> (terminating on Caddy → audit-bridge → STREAMS.TIP_CHANNELS_INCOMING),
> deduplicates, validates the menu transition, and hands off to
> worker-tip-triage with a sealed-box ciphertext payload.
>
> **Service:** [`apps/worker-tip-channels/`](../../apps/worker-tip-channels/) — deterministic state-machine over the multi-step USSD menu; no LLM calls.

---

## Description

### 🇫🇷

Bridge canal-tip télécom. Consomme `vigil:tip:channels:incoming`
(envelopes émises par le webhook gateway dans Caddy). Pour chaque
session USSD/SMS, applique la machine d'états du menu défini dans
`menus.ts` (langue → catégorie → preuve textuelle → numéro de
rappel facultatif). Dédupe par `session_id`. À la complétion,
chiffre le contenu via libsodium `crypto_box_seal` avec la clé
publique d'équipe-opérateur, et publie sur `vigil:tip:incoming`
pour worker-tip-triage. Le worker ne stocke jamais le texte clair :
chiffrement avant toute écriture Postgres.

### 🇬🇧

Telecom-gateway tip channel bridge. Consumes
`vigil:tip:channels:incoming` (envelopes published by the gateway
webhook in Caddy). For each USSD/SMS session, runs the menu
state-machine defined in `menus.ts` (language → category →
free-text evidence → optional callback number). Deduplicates by
`session_id`. On completion, encrypts the assembled tip body via
libsodium `crypto_box_seal` against the operator-team public key,
then publishes to `vigil:tip:incoming` for worker-tip-triage. The
worker NEVER persists plaintext — encryption happens before any
Postgres write.

---

## Boot sequence

1. `getDb()` — Postgres source for session state.
2. `TipRepo` + `TipChannelsRepo`.
3. `VaultClient.connect()` → `vault.read('tip-operator-team/public_key')`.
4. Consumer-group on `STREAMS.TIP_CHANNELS_INCOMING`.

---

## Health-check signals

| Metric                                                         | Healthy | Unhealthy → action                  |
| -------------------------------------------------------------- | ------- | ----------------------------------- |
| `up{job="vigil-workers", instance=~".*worker-tip-channels.*"}` | `1`     | `0` for > 2 min → P1                |
| `vigil_tip_operator_pubkey_loaded`                             | `1`     | `0` at boot → P0 (refuses to start) |

## SLO signals

| Metric                                       | SLO target | Investigate-worthy                               |
| -------------------------------------------- | ---------- | ------------------------------------------------ |
| `vigil_tip_channels_session_completion_rate` | > 70 %     | < 40 % → menu state-machine bug or gateway flake |
| `vigil_tip_channels_dedup_rate`              | < 5 %      | > 20 % → gateway double-emitting webhooks        |
| `vigil_tip_channels_seal_latency_ms` p99     | < 200 ms   | > 1 s → libsodium bind issue                     |

---

## Common failures

| Symptom                                                 | Likely cause                                                                   | Mitigation                                                                                                                                |
| ------------------------------------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Worker refuses to boot                                  | Vault key `tip-operator-team/public_key` missing or unreadable                 | Re-run the M0c key provisioning ceremony per [vault-shamir-init.md](vault-shamir-init.md).                                                |
| Sessions stuck in mid-menu state                        | Gateway dropping the second webhook for a session_id                           | Check Caddy access log for the gateway endpoint; restart the gateway connection.                                                          |
| Plaintext appears in `audit.actions` payload (CRITICAL) | Pre-encryption bug — the worker should NEVER write plaintext tip body to audit | Halt the worker immediately; rotate the operator-team key; see [audit-chain-divergence.md](audit-chain-divergence.md) for full forensics. |
| Sealed-box size exceeding 64 KiB                        | Citizen submission longer than the gateway's character cap                     | Reject upstream at the gateway with a friendly menu-prompt; document in tip-portal.md.                                                    |

---

## R1 — Routine deploy

```sh
docker compose pull worker-tip-channels
docker compose up -d worker-tip-channels
```

## R2 — Restore from backup

Stateful in `tip_channels.session` (Postgres). Resumes after
Postgres restore completes per [backup.md](backup.md). Sessions
in-flight at restore-time replay from the last completed menu step
(idempotent on `session_id` dedup).

## R3 — Credential rotation

The operator-team libsodium keypair lives in Vault at
`tip-operator-team/public_key` (public, distributed to the gateway
webhook) and the 3-of-5 Shamir-shared `tip-operator-team/private_key`
(private, used only by worker-tip-triage at decryption time). Rotate
per [vault-shamir-init.md](vault-shamir-init.md) §R3. Worker reads
the public key fresh at boot; rolling restart is sufficient
post-rotation.

## R5 — Incident response

| Severity | Trigger                                                       | Action                                                                                         |
| -------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| **P0**   | Plaintext tip body appears in `audit.actions` or any DB write | HALT worker; alert architect via SMS; rotate operator-team key; see audit-chain-divergence.md. |
| **P1**   | Worker down + PEL backlog > 100                               | Page on-call. Tip ingestion is citizen-facing; backlog risks discouraging future submissions.  |
| **P2**   | Session completion rate < 40 % sustained                      | Audit menu state-machine + gateway integration; instrument failed transitions.                 |
| **P3**   | Dedup rate climbing                                           | Coordinate with telecom-gateway vendor — webhook retry semantics may have changed.             |

## R4 — Council pillar rotation

N/A — see [R4-council-rotation.md](./R4-council-rotation.md).

## R6 — Monthly DR exercise

Included. See [R6-dr-rehearsal.md](./R6-dr-rehearsal.md).

---

## Cross-references

- [`apps/worker-tip-channels/src/index.ts`](../../apps/worker-tip-channels/src/index.ts) — boot + consumer.
- [`apps/worker-tip-channels/src/menus.ts`](../../apps/worker-tip-channels/src/menus.ts) — multi-step USSD menu definition.
- [`apps/worker-tip-channels/src/handler.ts`](../../apps/worker-tip-channels/src/handler.ts) — state-machine + sealed-box encryption.
- [`apps/worker-tip-channels/src/tip-channels.ts`](../../apps/worker-tip-channels/src/tip-channels.ts) — channel registry + per-channel config.
- [worker-tip-triage.md](worker-tip-triage.md) — downstream decryption worker.
- [vault-shamir-init.md](vault-shamir-init.md) — operator-team key ceremony.
- **SRD §28.5** — telecom-gateway USSD/SMS tip channel.
- **W-09** — Tor-native tip portal (sibling ingestion path).
