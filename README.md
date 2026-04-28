# VIGIL APEX

**Real-Time Public Finance Compliance, Governance Monitoring & Intelligence Platform**
**République du Cameroun · Phase 1 Pilot · 2026**

VIGIL APEX continuously crawls Cameroonian public-procurement data, fuses scattered
identity records into a knowledge graph, applies 43 fraud-detection patterns, scores
every finding with a Bayesian certainty engine (target ECE < 5%), anchors evidence to
Polygon mainnet, and routes signed bilingual dossiers to CONAC under a 3-of-5
hardware-key council quorum.

Operates on **public data only**. Sovereignty by design.

---

## Status

| Phase | Status |
|---|---|
| **Assimilation** | ✅ Complete |
| **Ring 0 — Infrastructure scaffold** | ✅ Complete (12 packages, contracts, compose, host bootstrap, 26 sources registered) |
| **Ring 1 — Ingestion framework** | ✅ Adapter-runner + 5 reference adapters + document pipeline |
| **Ring 2 — AI brain** | ✅ Pattern engine + 8 reference patterns + 4 workers (entity/pattern/score/counter-evidence) |
| **Ring 3 — Intelligence products** | ✅ Next.js dashboard skeleton + tip portal + dossier renderer |
| **Ring 4 — Enforcement** | ✅ CONAC SFTP + MINFI scoring API + Polygon anchor |
| **Ring 5 — Governance shield** | ✅ Governance event watcher + audit-verifier (CT-01/CT-02) |
| Phase 0 dry-run (per EXEC §26) | ⏳ Pending architect sign-off |
| Remaining 21 adapters | ⏳ Follow-up agent run |
| Remaining 35 patterns | ⏳ Follow-up agent run |

---

## Document Pack (binding)

The system is governed by five interlocking documents. Load order is mandatory.

| Order | Document | Role | Authority |
|---|---|---|---|
| 1 | [`TRUTH.md`](TRUTH.md) | Single source of truth — resolves cross-doc drift | **Highest** (supersedes drift in originals) |
| 2 | [`docs/source/SRD-v3.md`](docs/source/SRD-v3.md) | Solution Requirements Document v3.0 | Binding spec |
| 3 | [`docs/source/EXEC-v1.md`](docs/source/EXEC-v1.md) | Execution Runbook (institutional) | Gates technical phases |
| 4 | [`docs/source/BUILD-COMPANION-v1.md`](docs/source/BUILD-COMPANION-v1.md) | Procedural backbone (LLM router, prompts, phases) | Procedural |
| 5 | [`docs/source/BUILD-COMPANION-v2.md`](docs/source/BUILD-COMPANION-v2.md) | Implementation reference (every adapter, pattern, worker) | Reference |
| 6 | [`docs/source/HSK-v1.md`](docs/source/HSK-v1.md) | YubiKey Estate Manual (rewritten from "pair" to 8-key model) | Operational |

The original `.docx` files remain in [`docs/archive/`](docs/archive/) (symlinks
to `~/Desktop/VIGIL APEX MVP/`) with SHA-256 checksums recorded in
[`TRUTH.md`](TRUTH.md). Markdown is the source of truth; `.docx` is the
distribution format for institutional partners.

The MVP commercial proposal lives at [`docs/archive/MVP_SERVER.docx`](docs/archive/MVP_SERVER.docx)
($357,028 / 6-month Phase 1). The conceptual five-ring deck at
[`docs/archive/RTPFC_Governance_Intelligence_Platform.pptx`](docs/archive/RTPFC_Governance_Intelligence_Platform.pptx).

---

## Repo Structure

```
README.md          ← this file
TRUTH.md           ← single source of truth (resolves all drift between docs)
ROADMAP.md         ← Phase 1 → Phase 4 with phase tags
OPERATIONS.md      ← repo strategy, branching, CI, code review
THREAT-MODEL-CMR.md← Cameroon-specific threat extension to SRD §05
CLAUDE.md          ← session bootstrap for the agent
docs/
  source/          ← markdown source-of-truth for the 5 binding docs
  archive/         ← .docx originals (symlinked, SHA-256 pinned)
  decisions/       ← decision log per EXEC §37
  weaknesses/      ← W-01..W-27 fix tracker
  runbooks/        ← R1..R6 per SRD §31
infra/             ← docker-compose, ansible, source registry (Phase 0+)
packages/          ← pnpm workspace libraries (Phase 0+)
apps/              ← pnpm workspace applications (Phase 0+)
contracts/         ← Solidity contracts (Phase 4)
personal/          ← gitignored: calibration seed, council candidates, prompts
.github/workflows/ ← CI: lint, type-check, test, anti-hallucination corpus
```

---

## Loading the Documentation Pack into Claude Code

At the start of every session, paste this verbatim as the first message:

```
Read in order:
  1. TRUTH.md                          (binding; supersedes drift)
  2. docs/source/SRD-v3.md             (specification)
  3. docs/source/EXEC-v1.md            (institutional gates)
  4. docs/source/BUILD-COMPANION-v1.md (procedural backbone)
  5. docs/source/BUILD-COMPANION-v2.md (implementation reference)
  6. docs/source/HSK-v1.md             (YubiKey estate)
  7. docs/decisions/log.md             (committed decisions)
  8. docs/weaknesses/INDEX.md          (current fix status)

Do NOT generate code. Confirm load. Then await phase + work-block instruction.
```

See [`CLAUDE.md`](CLAUDE.md) for the full bootstrap with phase gates.

---

## The Architect

**Junior Thuram Nana**
Sovereign Architect — VIGIL APEX SAS
satoshinakamotobull@gmail.com

The system is designed to outlive its architect. See [`docs/source/EXEC-v1.md`](docs/source/EXEC-v1.md)
§34-35 (exit & succession) and the unsealed envelope held by the architect's
personal lawyer per EXEC §34.5.

---

## Licence & Confidentiality

This repository is **RESTRICTED** — distribution governed by the v5.1 commercial
agreement with the Republic of Cameroon. Copyright VIGIL APEX SAS 2026.

> *"VIGIL APEX exists because the architect has decided to commit a year or
> more of focused work, supported by 5 council members who will stake reputation,
> in service of an outcome — meaningful accountability infrastructure for
> Cameroonian public spending — that may or may not arrive. Build it carefully.
> End it well, when the time comes."* — EXEC v1.0 §46.5
