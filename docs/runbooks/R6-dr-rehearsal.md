# R6 — Disaster-recovery rehearsal (canonical)

> Monthly DR exercise. System-wide ceremony. Per-worker runbooks
> reference this file rather than replicating it.
>
> Per SRD §31.6 (R6 monthly DR exercise) + SRD §27 (DR plan).

---

## Status — Block-C C.3 in progress

The full DR rehearsal — script + scenario walkthrough + restore-time
SLA validation — is the **Block-C C.3 deliverable** (still
pending). When C.3 lands:

- [`scripts/dr-rehearsal.ts`](../../scripts/dr-rehearsal.ts) — the
  rehearsal script that simulates host loss and validates restore
  from NAS-replica within the 6-hour SLA.
- This file becomes the operator runbook accompanying the script.

This placeholder exists so per-worker runbooks (Block-C C.2.\* group
commits) can cross-link to the canonical R6 immediately. The link
target stays valid; the body fills in with C.3.

## Architect-tracked

- B3 / C.3 — DR rehearsal script + runbook (this file's eventual content).
- Block-D follow-up — SRD §31.6 enumeration; the actual R6 exit
  criteria are not currently written into the binding doc.

## Cross-references (provisional)

- SRD §27 — DR plan (high-level).
- SRD §31.6 — R6 monthly exercise (currently empty heading; Block-D follow-up).
- [`docs/runbooks/dr-restore-test.sh`](../../scripts/dr-restore-test.sh) — the existing backup-restore smoke test (subset of full R6).
