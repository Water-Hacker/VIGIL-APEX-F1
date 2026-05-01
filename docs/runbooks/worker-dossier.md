# Runbook — worker-dossier

> Renders dossier PDFs (FR + EN) for findings approved for
> escalation. Pins to IPFS. Emits `vigil:dossier:deliver` for
> worker-conac-sftp.
>
> **Service:** [`apps/worker-dossier/`](../../apps/worker-dossier/) — LLM-using (narrative).

---

## Description

### 🇫🇷

Rend les dossiers bilingues PDF (FR + EN). LibreOffice headless +
PDF normaliser pour byte-identité (SRD §24.10). Narrative
LLM-générée via SafeLlmRouter (`promptName: 'dossier.narrative'`).
Pin chaque PDF dans IPFS ; émet `vigil:dossier:deliver` pour
worker-conac-sftp.

### 🇬🇧

Renders bilingual PDF dossiers (FR + EN). LibreOffice headless +
PDF normaliser for byte-identity (SRD §24.10). LLM-generated
narrative via SafeLlmRouter (`promptName: 'dossier.narrative'`).
Pins each PDF to IPFS; emits `vigil:dossier:deliver` for
worker-conac-sftp.

---

## Boot sequence

1. LibreOffice + PDF normaliser binaries available in container.
2. `LlmRouter` + `SafeLlmRouter` (DECISION-011 chokepoint).
3. `kubo-rpc-client` connected to vigil-ipfs.
4. `DossierRepo` — Postgres.
5. Consumer-group on `vigil:dossier:render`.

---

## Health-check signals

| Metric                                                    | Healthy | Unhealthy → action |
| --------------------------------------------------------- | ------- | ------------------ |
| `up{instance=~".*worker-dossier.*"}`                      | `1`     | `0` > 2 min → P0   |
| `vigil_worker_last_tick_seconds{worker="worker-dossier"}` | < 1 h   | > 1 h → P1         |

## SLO signals

| Metric                                      | SLO target              | Investigate-worthy             |
| ------------------------------------------- | ----------------------- | ------------------------------ |
| `vigil_dossier_render_duration_seconds` p99 | < 60 s                  | > 5 min → render slow          |
| `vigil_ipfs_pins_total{outcome="ok"}` rate  | matches escalation rate | rate < expected → pin failures |

---

## Common failures

| Symptom                                | Likely cause                                         | Mitigation                                                          |
| -------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------- |
| Render produces non-byte-identical PDF | LibreOffice version drift or ts-side template change | AUDIT-063 normalisation pass; if persistent, re-pin canonical hash. |
| `kubo.add` failures                    | IPFS down                                            | See [ipfs.md](./ipfs.md). Render queue retries.                     |
| Narrative LLM call timeout             | Tier-0 slow                                          | Tier-1 Bedrock failover; verify circuit state.                      |

---

## R1 — Routine deploy

```sh
docker compose pull worker-dossier
docker compose up -d worker-dossier
```

## R2 — Restore from backup

Reads escalation queue from Postgres; writes PDF + pins to IPFS.
After restore, ensure IPFS NAS mirror replays per [ipfs.md R2](./ipfs.md);
the worker re-pins on next render.

## R3 — Credential rotation

`anthropic/api_key` rotation per
[worker-counter-evidence.md R3](./worker-counter-evidence.md). The
narrative path is the only LLM use; rule-based render does NOT call
Claude.

## R5 — Incident response

| Severity | Trigger                                                      | Action                                                              |
| -------- | ------------------------------------------------------------ | ------------------------------------------------------------------- |
| **P0**   | Dossier-deliver SLA breach (CONAC delivery > 24 h post-vote) | Page architect. Spec-blocking for Phase-6 CONAC engagement.         |
| **P1**   | Worker down + render queue                                   | Page on-call. Escalated findings can't reach CONAC.                 |
| **P2**   | Render duration p99 > 5 min                                  | Investigate; LibreOffice resource constraint OR LLM narrative slow. |
| **P3**   | Byte-identity drift                                          | Architect-tracked; AUDIT-063 follow-up if regression.               |

## R4 — Council pillar rotation

N/A — see [R4-council-rotation.md](./R4-council-rotation.md).

## R6 — Monthly DR exercise

Included. See [R6-dr-rehearsal.md](./R6-dr-rehearsal.md).

---

## Cross-references

- [`apps/worker-dossier/src/index.ts`](../../apps/worker-dossier/src/index.ts) — render + pin orchestration.
- [`packages/dossier/`](../../packages/dossier/) — render templates.
- **SRD §24** — dossier structure + bilingual requirement.
- **SRD §25** — bilingual delivery.
- **AUDIT-063** — byte-identical PDF normaliser.
- **DECISION-011** — AI-Safety doctrine.
