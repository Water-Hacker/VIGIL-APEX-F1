# Runbook — worker-document

> Document fetcher + OCR + dedupe. Receives source events with
> `document_cids[]`, fetches each from the source URL, hashes,
> stores in IPFS, runs OCR if needed.
>
> **Service:** [`apps/worker-document/`](../../apps/worker-document/) — IPFS + OCR pipeline.

---

## Description

### 🇫🇷

Pipeline document. Pour chaque CID référencé dans une
`source.event`, télécharge depuis l'URL source, calcule SHA-256,
pin dans IPFS, déclenche OCR si PDF/image, stocke le texte
extrait dans `dossier.document_text`. Dédupe par sha256.

### 🇬🇧

Document pipeline. For each CID referenced in a `source.event`,
downloads from source URL, computes SHA-256, pins to IPFS,
triggers OCR if PDF/image, stores extracted text in
`dossier.document_text`. Dedupes by sha256.

---

## Boot sequence

1. Tesseract OCR + LibreOffice in container.
2. `kubo-rpc-client` to vigil-ipfs.
3. `getDb()` — Postgres.
4. Consumer-group on `vigil:document:fetch`.

---

## Health-check signals

| Metric                                                     | Healthy | Unhealthy → action |
| ---------------------------------------------------------- | ------- | ------------------ |
| `up{instance=~".*worker-document.*"}`                      | `1`     | `0` > 2 min → P1   |
| `vigil_worker_last_tick_seconds{worker="worker-document"}` | < 1 h   | > 1 h → P1         |

## SLO signals

| Metric                                 | SLO target           | Investigate-worthy             |
| -------------------------------------- | -------------------- | ------------------------------ |
| `vigil_forensics_documents_total` rate | matches event volume | flat → consumer wedged         |
| Per-document fetch+OCR latency p99     | < 60 s               | > 5 min → OCR slow / large PDF |

---

## Common failures

| Symptom              | Likely cause                         | Mitigation                                          |
| -------------------- | ------------------------------------ | --------------------------------------------------- |
| 4xx from source URL  | source page evolved or auth required | worker-adapter-repair triggers if pattern persists. |
| OCR garbled output   | Tesseract language data missing      | Verify `tesseract --list-langs` includes fra + eng. |
| Duplicate CID logged | dedupe working as intended           | No action.                                          |

---

## R1 — Routine deploy

```sh
docker compose pull worker-document
docker compose up -d worker-document
```

## R2 — Restore from backup

Reads `source.events` + writes `dossier.document_text` + IPFS pins.
No local state.

## R3 — Credential rotation

N/A — no service-specific credential. (No LLM calls; no external
auth to source URLs beyond standard User-Agent.)

## R5 — Incident response

| Severity | Trigger                                     | Action                                                          |
| -------- | ------------------------------------------- | --------------------------------------------------------------- |
| **P1**   | Worker down + document backlog > 1000       | Page on-call. Findings can't materialise without document text. |
| **P2**   | Repeated OCR timeouts on specific documents | Investigate; possibly raise per-document timeout.               |
| **P3**   | Tesseract memory pressure                   | Reduce concurrency or bump container memory.                    |

## R4 — Council pillar rotation

N/A — see [R4-council-rotation.md](./R4-council-rotation.md).

## R6 — Monthly DR exercise

Included. See [R6-dr-rehearsal.md](./R6-dr-rehearsal.md).

---

## Cross-references

- [`apps/worker-document/src/index.ts`](../../apps/worker-document/src/index.ts) — pipeline.
- **SRD §14** — document pipeline (fetch, hash, OCR, store, dedupe).
