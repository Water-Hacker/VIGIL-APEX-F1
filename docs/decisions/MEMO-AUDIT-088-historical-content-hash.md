# Memo to architect — AUDIT-088 / historical contentHash canonicalisation

**Date:** 2026-05-01
**Author:** build agent (Claude)
**Status:** awaiting architect decision
**Scope:** decides whether to leave / migrate / invalidate `contentHash`
values produced before commit [`5dc5a82`](../../packages/dossier/src/render.ts)
(AUDIT-063 fix) under the broken canonicalisation.

---

## 1. The bug, restated

Before commit `5dc5a82`, `packages/dossier/src/render.ts` canonicalised
the dossier input via:

```ts
const canonical = JSON.stringify(input, Object.keys(input).sort());
```

This is a footgun: when `JSON.stringify`'s second argument is an array,
it is treated as a **deep property-name allow-list applied to every
nesting level**, not as a key sort. Top-level keys (`finding`,
`auditAnchor`, `recipient`, …) are kept; nested keys whose names happen
not to appear in the top-level array (`finding.posterior`,
`auditAnchor.polygonTxHash`, `finding.amount_xaf`, …) are silently
dropped.

Net effect: the `contentHash` was insensitive to most input changes.
Two dossiers with completely different `posterior_probability` or
`polygon_tx_hash` values produced the **same** `contentHash`. The
"determinism contract" of SRD §24.10 was vacuously true.

Fix (AUDIT-063, commit 5dc5a82): replaced with a recursive sorted-key
serialiser (`canonicalJson`), with 14 new tests pinning content-
sensitivity per field.

---

## 2. What was anchored on the broken hash

The `contentHash` returned by `renderDossier()` is stored at:

- `apps/worker-dossier/src/index.ts:226` — written as `content_hash`
  into the dossier persistence path. (Whether it lands in the
  `dossier.dossier.metadata` JSONB blob or a future named column
  depends on how the architect chooses to expose it; the value
  exists in the worker's commit path either way.)
- The dossier render step is the input to:
  - **Audit-chain row** for `dossier.rendered` — the canonicalised
    payload feeds the `record_hash` of the action; the broken
    canonicalisation made the audit-chain row hash insensitive to the
    finding's posterior or polygon tx hash.
  - **Federation envelope** content-hash on the regional → core push
    of dossier metadata.
  - **Public-verify URL** at `/verify/<contentHash>` — citizens look
    up dossiers by this value.

Other historical hashes computed elsewhere via different
canonicalisations (e.g., `audit.public_export.csv_sha256` which is
`sha256(csv_bytes)`, NOT a JSON-canonical hash) are **not** affected.
Only consumers of `renderDossier`'s returned `contentHash` (and any
upstream sites that imported the same broken pattern) are in scope.

A grep on the working tree as of this memo finds **one** call site for
the post-fix `renderDossier`: [`apps/worker-dossier/src/index.ts:226`](../../apps/worker-dossier/src/index.ts#L226).
Historical rows (if any exist on a deployed instance) are the only
artefacts that carry the broken hash.

---

## 3. Three options

The audit row offered three candidates. Each is examined below in
operational detail.

### Option 1 — Leave historical hashes as-is; document the change

**Operational shape:** add a `canonicalisation_version` field to the
dossier metadata going forward (`v1` for broken, `v2` for fixed).
Public-verify URLs continue to work; the public-verify endpoint maps
the URL fragment to the row regardless of which canonicalisation
produced it. A doctrine note explains the change.

**Pros**

- Zero migration. No re-anchoring on Polygon, no reissue of public-
  verify URLs.
- Operational risk near zero — nothing in the running system needs to
  change retroactively.

**Cons**

- The historical hash continues to exist as a "valid identifier" but
  not as the canonical hash of the dossier content. If a citizen
  computes the contentHash themselves from a downloaded dossier (per
  the SRD §24.10 reproducibility contract), the value won't match
  the historical row's hash. The contract is broken silently for
  pre-fix dossiers.
- The audit-chain row's `record_hash` for any `dossier.rendered`
  action committed under the broken canonicalisation is insensitive
  to the dossier's actual contents — a dossier could be modified
  post-anchor and the chain wouldn't catch it. (Whether any such
  rows exist on a deployed instance is an operator-side question.)

### Option 2 — Recompute and store both forms during a one-shot migration

**Operational shape:** a one-shot migration walks every historical
dossier row, re-renders the contentHash with the fixed
canonicalisation, stores **both** the historical (broken) and the
correct hashes. Public-verify URLs accept either. Going forward, only
the correct hash is computed.

**Pros**

- Backwards-compatible URLs (the historical hash still resolves).
- Audit-chain rows can be re-anchored with the correct hash; the
  historical row stands as a record of what was committed at the
  time, the new row records the canonical state today.
- Citizens who re-compute the hash from a downloaded dossier get the
  correct value and it matches the system.

**Cons**

- Re-anchoring on Polygon costs gas (small but non-zero per dossier).
- Doubles the storage on the contentHash column (one column becomes
  two, or one column becomes a JSONB `{v1, v2}` blob).
- A new audit-chain row records the migration itself; this is good
  for transparency but adds operational complexity.

### Option 3 — Invalidate historical hashes; require re-anchoring

**Operational shape:** every pre-fix dossier is marked
`requires_reanchoring = true` in metadata. The public-verify endpoint
returns a 410 Gone for the historical URLs and a 200 OK with the new
URL once the operator has re-rendered the dossier under the fixed
canonicalisation. The audit chain commits a new
`dossier.recanonicalised` action per migrated dossier with the old
hash → new hash mapping.

**Pros**

- Strongest correctness guarantee: only canonical hashes exist in the
  system after migration. No two-form ambiguity.
- The audit-chain delta is fully recorded; an external observer can
  reconstruct exactly what was changed and when.

**Cons**

- Public-verify URLs from before the fix break for citizens — they
  see 410 Gone. If any external party (NGO, journalist) bookmarked
  or cited a public-verify URL, it stops resolving.
- Heaviest operational lift — every historical dossier is touched;
  signed PDFs are reissued; CONAC delivery acknowledgments may need
  to be re-confirmed against the new hash.

---

## 4. Recommendation

**Option 2 — recompute and store both forms.**

The deciding factor is the **public-verify URL contract**. The system
promises citizens (and the council) that a public-verify URL is a
permanent identifier. Option 1 leaves the URL working but breaks the
"compute it yourself and check" property — silently. Option 3 breaks
the URL contract loudly (410 Gone) which is an institutional cost
disproportionate to the original bug.

Option 2 keeps the historical URLs working, restores the
"compute-it-yourself" property by serving the correct hash via a new
verify path, and lets the audit chain explicitly record the migration
event. The cost is double-storing a 32-byte sha256 — operationally
negligible.

Concrete proposal for Option 2:

1. Add a column `dossier.dossier.content_sha256_legacy` (nullable),
   populated only for rows migrated from the pre-fix canonicalisation.
   The primary `content_sha256` (or whatever the canonical column is
   named in the architect's review) holds the post-fix value going
   forward.
2. Migration: for each pre-fix dossier, compute the post-fix hash by
   re-rendering with the same input snapshot. The input snapshot is
   already retained in `dossier.dossier.metadata` and the linked
   evidence rows; no LLM recomputation is required.
3. New audit-chain action `dossier.recanonicalised` per migrated row,
   carrying both hashes and the migration timestamp.
4. Polygon re-anchor: skipped on cost grounds. The legacy anchor
   stands as a historical commitment; the new audit row links the old
   to the new without requiring on-chain re-commitment.
5. Public-verify endpoint: serves either hash as a lookup key; on a
   hit by the legacy hash, the response includes a `migrated_at`
   timestamp + the canonical hash so external citers can update their
   reference.

Whether the migration runs on the existing deployed instance is an
operator-side question — if no production dossiers exist yet (Phase 1
not yet exited), the migration is a no-op and Option 2 collapses to
"add the legacy column for future-safety, run the migration script
defensively." That is the lowest-cost outcome of all three options
and is the assumed default unless the architect signals otherwise.

---

## 5. Architect read-through checklist

Confirm one of:

- [ ] **Approve Option 1** — leave historical hashes as-is; add a
      `canonicalisation_version` field; document the change in
      `docs/decisions/log.md`. Public-verify URLs work; "compute it
      yourself" property silently broken for pre-fix dossiers.
- [ ] **Approve Option 2** (recommended) — recompute and store both
      forms; add `content_sha256_legacy` column; new
      `dossier.recanonicalised` audit action per migrated row; no
      Polygon re-anchor; public-verify endpoint accepts either hash.
- [ ] **Approve Option 3** — invalidate historical hashes; 410 Gone
      on legacy URLs until operator re-renders; full re-anchoring on
      Polygon for migrated dossiers.
- [ ] **Defer to Phase-9 entry** — no production dossiers exist
      today; the architect chooses the option at Phase-9 entry when
      the actual production-row count is known.

The decision is recorded in `docs/decisions/log.md` as a follow-up to
DECISION-011 (or a new DECISION number). AUDIT-088 in
[AUDIT.md](../../AUDIT.md) flips from `architect (needs-human-confirmation)`
to `fixed` once the migration ships (Options 2 / 3) or to
`fixed (documented-only)` (Option 1) or stays `deferred-to-phase-9`
(Option 4).

---

## 6. Files this memo touches once approved

| File                                                                                                     | Change (Option 2 recommended)                                                                                                |
| -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| [`docs/decisions/log.md`](log.md)                                                                        | DECISION-019 (or similar) — historical contentHash policy, FINAL after approval                                              |
| [`packages/db-postgres/drizzle/00NN_dossier_legacy_hash.sql`](../../packages/db-postgres/drizzle/) (new) | adds `content_sha256_legacy text` (nullable) on `dossier.dossier`; paired `_down.sql` per AUDIT-051 / DECISION-017           |
| [`packages/db-postgres/src/repos/dossier.ts`](../../packages/db-postgres/src/)                           | reader honors both columns when looking up by hash                                                                           |
| [`scripts/migrate-dossier-canonicalisation.ts`](../../scripts/) (new)                                    | one-shot migration: walks rows where `content_sha256_legacy IS NULL AND rendered_at < '<cutover-date>'`, recomputes + writes |
| [`packages/shared/src/schemas/audit.ts`](../../packages/shared/src/schemas/audit.ts)                     | adds `dossier.recanonicalised` to `zAuditAction` enum                                                                        |
| [`apps/dashboard/src/app/verify/[hash]/page.tsx`](../../apps/dashboard/src/app/verify/)                  | accepts either hash; surfaces `migrated_at` + canonical pointer                                                              |

No code change ships in this memo; this is a decision document only.
