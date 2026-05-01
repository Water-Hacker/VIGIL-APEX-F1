# Runbook — worker-image-forensics

> Python worker. Image-tampering detector for documents / photos
> attached to source events. Local-only (no external API calls);
> uses opencv + custom forgery-detection heuristics.
>
> **Service:** [`apps/worker-image-forensics/`](../../apps/worker-image-forensics/) — Python; local-only.

---

## Description

### 🇫🇷

Détection de manipulation d'images sur les pièces jointes de
`source.event` (PDFs scannés, photos). Heuristiques locales :
copy-move detection, ELA (error-level analysis), JPEG ghost
detection. Émet un `vigil:finding:signal` avec
`pattern_id='P-G-001'` quand la confiance dépasse le seuil.

### 🇬🇧

Image-tampering detection on attachments to `source.event`
(scanned PDFs, photos). Local heuristics: copy-move detection, ELA
(error-level analysis), JPEG ghost detection. Emits a
`vigil:finding:signal` with `pattern_id='P-G-001'` when confidence
exceeds threshold.

---

## Boot sequence

1. `pip install` from `apps/worker-image-forensics/requirements.txt`.
2. `getDb()` + Postgres.
3. Polls `vigil:document:fetch` ack channel for new images.

---

## Health-check signals

| Metric                                       | Healthy            | Unhealthy → action |
| -------------------------------------------- | ------------------ | ------------------ |
| `up{instance=~".*worker-image-forensics.*"}` | `1`                | `0` > 5 min → P2   |
| `vigil_forensics_documents_total` rate       | matches image rate | flat → wedged      |

## SLO signals

| Metric                             | SLO target | Investigate-worthy                                    |
| ---------------------------------- | ---------- | ----------------------------------------------------- |
| Per-image latency p99              | < 30 s     | > 5 min → opencv slow                                 |
| Forgery-detection confidence drift | bimodal    | always-low → false-negative-prone (review heuristics) |

---

## Common failures

| Symptom                               | Likely cause                               | Mitigation                                          |
| ------------------------------------- | ------------------------------------------ | --------------------------------------------------- |
| OpenCV crash on PDF page              | rasterise step OOM                         | Bump container memory; reduce per-page resolution.  |
| Forgery-detection always 0 confidence | heuristics too conservative for the source | Operator-side calibration adjustment per AUDIT-097. |

---

## R1 — Routine deploy

```sh
docker compose pull worker-image-forensics
docker compose up -d worker-image-forensics
```

## R2 — Restore from backup

Reads source events + writes `finding.signal`. No local state.

## R3 — Credential rotation

N/A — service has no rotatable external credential. Local-only
processing; no API keys.

## R5 — Incident response

| Severity | Trigger                                           | Action                                                   |
| -------- | ------------------------------------------------- | -------------------------------------------------------- |
| **P2**   | Worker down + image queue                         | Forgery signals lapse; pattern P-G-001 fires less often. |
| **P3**   | High false-positive rate in operator review queue | Operator-side calibration; tune heuristic thresholds.    |

## R4 — Council pillar rotation

N/A — see [R4-council-rotation.md](./R4-council-rotation.md).

## R6 — Monthly DR exercise

Included. See [R6-dr-rehearsal.md](./R6-dr-rehearsal.md).

---

## Cross-references

- [`apps/worker-image-forensics/src/`](../../apps/worker-image-forensics/src/) — Python heuristics.
- [`packages/patterns/src/category-g/`](../../packages/patterns/src/category-g/) — document-integrity patterns (P-G-\*).
- **SRD §16** — document forensics pillar.
