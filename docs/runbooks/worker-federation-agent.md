# Runbook — worker-federation-agent

> Phase-3 scaffolded. Region-side federation sender — signs envelopes
> with the region-scoped Vault PKI cert and submits to the central
> federation receiver. Not running in Phase-1 steady state.
>
> **Service:** [`apps/worker-federation-agent/`](../../apps/worker-federation-agent/) — Phase-3 federation sender.

---

## Description

### 🇫🇷

Émetteur fédéré côté région. Signe chaque envelope avec le cert
PKI régional Vault (`pki-region-<code>/`) et submit au receiver
central. Phase-3 scaffolded ; ne tourne en Phase 1 que dans
les tests.

### 🇬🇧

Region-side federation sender. Signs each envelope with the
region-scoped Vault PKI cert (`pki-region-<code>/`) and submits to
the central receiver. Phase-3 scaffolded; only runs in tests during
Phase 1.

---

## Boot sequence

1. `VaultClient` — reads region PKI cert + key.
2. gRPC client to central federation receiver.
3. Polls `federation.outbound_envelope` for queued items.

---

## Health-check signals

| Metric                                        | Healthy (Phase 3) | Unhealthy → action         |
| --------------------------------------------- | ----------------- | -------------------------- |
| `up{instance=~".*worker-federation-agent.*"}` | `1` (Phase 3)     | `0` > 5 min → P2 (Phase 3) |

## SLO signals

| Metric                                   | SLO target | Investigate-worthy                |
| ---------------------------------------- | ---------- | --------------------------------- |
| `vigil_federation_flush_lag_seconds` p99 | < 5 s      | > 30 s → receiver slow OR network |
| `vigil_federation_pending_envelopes`     | < 100      | > 1000 → outbound backlog         |

---

## Common failures (Phase-3)

| Symptom                                          | Likely cause                                   | Mitigation                                                                        |
| ------------------------------------------------ | ---------------------------------------------- | --------------------------------------------------------------------------------- |
| Signature verification fails on central receiver | region PKI cert expired                        | Run R10-federation-key-rotation per docs/runbooks/R10-federation-key-rotation.md. |
| gRPC connection refused                          | central receiver down OR WireGuard mesh broken | See [worker-federation-receiver.md](./worker-federation-receiver.md).             |
| Outbound backlog growing                         | central receiver overloaded                    | Receiver-side capacity issue; back-pressure expected.                             |

---

## R1 — Routine deploy (Phase-3 only)

```sh
docker compose pull worker-federation-agent
docker compose up -d worker-federation-agent
```

Phase-1: container starts but is a no-op (no envelopes queued).

## R2 — Restore from backup

Reads `federation.outbound_envelope` from Postgres; PKI cert from
Vault. After restore, agent resumes from last unsent envelope.

## R3 — Credential rotation

Region PKI cert rotation per
[R10-federation-key-rotation.md](./R10-federation-key-rotation.md).
The agent reads the cert from Vault on boot; rotation is restart-
based.

```sh
# Architect runs the cert rotation per R10
vault write pki-region-<code>/issue/agent common_name=...
# Update Vault secret path the agent reads
docker compose restart worker-federation-agent
```

## R5 — Incident response (Phase-3 only)

| Severity | Trigger                              | Action                                                              |
| -------- | ------------------------------------ | ------------------------------------------------------------------- |
| **P1**   | Federation backlog > 10000 envelopes | Page on-call. Investigate receiver capacity.                        |
| **P2**   | Signature failures sustained         | Likely cert near expiry; run R10 rotation early.                    |
| **P3**   | Single envelope rejected             | Operator triage; possible payload-cap or replay-protection trigger. |

## R4 — Council pillar rotation

N/A — federation is region-scoped, not council-scoped. See
[R4-council-rotation.md](./R4-council-rotation.md).

## R6 — Monthly DR exercise

Phase-1: included only as a smoke-boot test. Phase-3: full
federation cutover scenario.

---

## Cross-references

### Code

- [`apps/worker-federation-agent/src/`](../../apps/worker-federation-agent/src/) — sender.
- [`packages/federation-stream/`](../../packages/federation-stream/) — envelope sign + verify.

### Binding spec

- **TRUTH §B.3** — Phase-3 federation scaffold.
- **R9-federation-cutover.md** — cutover procedure.
- **R10-federation-key-rotation.md** — PKI rotation.
