# DECISION-012 (TAL-PA) — Promotion Prep (Block-B B.6 / A6.1 + A6.3 + A6.4)

> **Purpose.** Agent-doable preparation for the architect read-through
> that promotes DECISION-012 from PROVISIONAL → FINAL. Three deliverables:
>
> - **A6.1** — Cross-reference audit: every file the doctrine cites exists.
> - **A6.3** — Schema side-by-side: live `audit.user_action_event` vs SRD §17 + doctrine §3 expectations.
> - **A6.4** — Salt rotation operations: custody, cadence, runbook references.
>
> A6.2 (architect read-through checklist) was previously shipped at
> [`docs/decisions/decision-012-readthrough-checklist.md`](decision-012-readthrough-checklist.md).
> A6.5 (FINAL flip in [`log.md`](log.md)) is architect-only and stays out of agent scope.

**Generated:** 2026-05-01.
**Author:** build agent (Claude).
**Status:** ready for architect read-through. Promotion to FINAL is the architect's separate action.

---

## A6.1 — Cross-reference audit (mechanical)

Every link in [`docs/source/TAL-PA-DOCTRINE-v1.md`](../source/TAL-PA-DOCTRINE-v1.md)
that points back into the codebase was checked against the live tree
on 2026-05-01. **All 29 unique cited paths resolve.**

| Cited path                                                                                                                           | Resolves |
| ------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| [`apps/adapter-runner/src/triggers/quarterly-audit-export.ts`](../../apps/adapter-runner/src/triggers/quarterly-audit-export.ts)     | ✓        |
| [`apps/adapter-runner/__tests__/quarterly-audit-export.test.ts`](../../apps/adapter-runner/__tests__/quarterly-audit-export.test.ts) | ✓        |
| [`apps/dashboard/src/app/api/audit/aggregate/route.ts`](../../apps/dashboard/src/app/api/audit/aggregate/route.ts)                   | ✓        |
| [`apps/dashboard/src/app/api/audit/public/route.ts`](../../apps/dashboard/src/app/api/audit/public/route.ts)                         | ✓        |
| [`apps/dashboard/src/app/public/audit/page.tsx`](../../apps/dashboard/src/app/public/audit/page.tsx)                                 | ✓        |
| [`apps/dashboard/src/lib/audit-emit.server.ts`](../../apps/dashboard/src/lib/audit-emit.server.ts)                                   | ✓        |
| [`apps/dashboard/src/middleware.ts`](../../apps/dashboard/src/middleware.ts)                                                         | ✓        |
| [`apps/dashboard/__tests__/public-audit-route.test.ts`](../../apps/dashboard/__tests__/public-audit-route.test.ts)                   | ✓        |
| [`apps/worker-anchor/`](../../apps/worker-anchor/)                                                                                   | ✓        |
| [`apps/worker-anchor/src/index.ts`](../../apps/worker-anchor/src/index.ts)                                                           | ✓        |
| [`apps/worker-anchor/__tests__/high-sig-loop.test.ts`](../../apps/worker-anchor/__tests__/high-sig-loop.test.ts)                     | ✓        |
| [`apps/worker-audit-watch/`](../../apps/worker-audit-watch/)                                                                         | ✓        |
| [`apps/worker-audit-watch/src/index.ts`](../../apps/worker-audit-watch/src/index.ts)                                                 | ✓        |
| [`packages/audit-chain/src/hash-chain.ts`](../../packages/audit-chain/src/hash-chain.ts)                                             | ✓        |
| [`packages/audit-chain/src/verifier.ts`](../../packages/audit-chain/src/verifier.ts)                                                 | ✓        |
| [`packages/audit-log/src/anomaly.ts`](../../packages/audit-log/src/anomaly.ts)                                                       | ✓        |
| [`packages/audit-log/src/emit.ts`](../../packages/audit-log/src/emit.ts)                                                             | ✓        |
| [`packages/audit-log/src/halt.ts`](../../packages/audit-log/src/halt.ts)                                                             | ✓        |
| [`packages/audit-log/src/hash.ts`](../../packages/audit-log/src/hash.ts)                                                             | ✓        |
| [`packages/audit-log/src/public-view.ts`](../../packages/audit-log/src/public-view.ts)                                               | ✓        |
| [`packages/audit-log/src/signer.ts`](../../packages/audit-log/src/signer.ts)                                                         | ✓        |
| [`packages/audit-log/__tests__/`](../../packages/audit-log/__tests__/)                                                               | ✓        |
| [`packages/audit-log/__tests__/hash.test.ts`](../../packages/audit-log/__tests__/hash.test.ts)                                       | ✓        |
| [`packages/db-postgres/drizzle/0010_tal_pa.sql`](../../packages/db-postgres/drizzle/0010_tal_pa.sql)                                 | ✓        |
| [`packages/db-postgres/src/repos/audit-log.ts`](../../packages/db-postgres/src/repos/audit-log.ts)                                   | ✓        |
| [`packages/db-postgres/src/schema/audit-log.ts`](../../packages/db-postgres/src/schema/audit-log.ts)                                 | ✓        |
| [`packages/db-postgres/__tests__/audit-log-cas.test.ts`](../../packages/db-postgres/__tests__/audit-log-cas.test.ts)                 | ✓        |
| [`packages/shared/src/schemas/audit-log.ts`](../../packages/shared/src/schemas/audit-log.ts)                                         | ✓        |
| [`packages/shared/src/schemas/audit.ts`](../../packages/shared/src/schemas/audit.ts)                                                 | ✓        |

**No broken cross-references.** The doctrine's §11 implementation
index is consistent with the tree as of 2026-05-01.

---

## A6.3 — Schema side-by-side

The TAL-PA doctrine §3 (per-actor hash chain) and SRD §17 (hardware
keys + audit chain provisioning) describe the expected schema for
`audit.user_action_event` and `audit.user_action_chain`. Compare
against the live Drizzle schema mirror in
[`packages/db-postgres/src/schema/audit-log.ts`](../../packages/db-postgres/src/schema/audit-log.ts).

### `audit.user_action_event`

| Field                      | Type (live)                      | Doctrine §3 / SRD §17 expectation                          | Match                          |
| -------------------------- | -------------------------------- | ---------------------------------------------------------- | ------------------------------ |
| `event_id`                 | `uuid PK`                        | uuid PK                                                    | ✓                              |
| `global_audit_id`          | `uuid NOT NULL`                  | global ID across the platform-wide chain                   | ✓                              |
| `event_type`               | `text NOT NULL`                  | one of `KNOWN_EVENT_TYPES` (≈80 slugs)                     | ✓                              |
| `category`                 | `text NOT NULL`                  | one of 11 categories (A–K)                                 | ✓                              |
| `timestamp_utc`            | `timestamptz NOT NULL`           | UTC always                                                 | ✓                              |
| `actor_id`                 | `text NOT NULL`                  | actor identity                                             | ✓                              |
| `actor_role`               | `text NOT NULL`                  | role at action time                                        | ✓                              |
| `actor_yubikey_serial`     | `text NULL`                      | YubiKey serial when the role required hardware-key signing | ✓                              |
| `actor_ip`                 | `text NULL`                      | NULLable for system actors                                 | ✓                              |
| `actor_device_fingerprint` | `text NULL`                      | for browser-side actors                                    | ✓                              |
| `session_id`               | `uuid NULL`                      | session bind                                               | ✓                              |
| `target_resource`          | `text NOT NULL`                  | what was acted on                                          | ✓                              |
| `action_payload`           | `jsonb NOT NULL DEFAULT '{}'`    | extension shape per category                               | ✓                              |
| `result_status`            | `text NOT NULL`                  | success / failure / refused                                | ✓                              |
| `prior_event_id`           | `uuid NULL`                      | this actor's previous chain link                           | ✓                              |
| `correlation_id`           | `uuid NULL`                      | request-correlation                                        | ✓                              |
| `digital_signature`        | `text NULL`                      | signature over the canonical record                        | ✓ (NULL for unsigned dev runs) |
| `chain_anchor_tx`          | `text NULL`                      | Polygon tx hash; populated by worker-anchor                | ✓                              |
| `record_hash`              | `text NOT NULL`                  | sha256 of the canonical NFKC + sorted-key JSON             | ✓                              |
| `high_significance`        | `boolean NOT NULL DEFAULT false` | drives the 5-second fast-lane                              | ✓                              |

**Indexes:**

| Live index                    | Purpose                                   | Status                                  |
| ----------------------------- | ----------------------------------------- | --------------------------------------- |
| `(actor_id, timestamp_utc)`   | per-actor recent activity feed            | ✓ matches doctrine §3 retrieval pattern |
| `(category, timestamp_utc)`   | per-category public view + anomaly window | ✓                                       |
| `(event_type, timestamp_utc)` | rule-engine event-type cuts               | ✓                                       |
| `(correlation_id)`            | request-correlation walk                  | ✓                                       |

### `audit.user_action_chain`

| Field               | Type (live)                          | Doctrine §3 expectation                | Match |
| ------------------- | ------------------------------------ | -------------------------------------- | ----- |
| `actor_id`          | `text PK`                            | one row per actor (CAS contention key) | ✓     |
| `latest_event_id`   | `uuid NOT NULL`                      | head of this actor's chain             | ✓     |
| `latest_event_hash` | `text NOT NULL`                      | record_hash of the head                | ✓     |
| `latest_at`         | `timestamptz NOT NULL DEFAULT NOW()` | head timestamp                         | ✓     |
| `event_count`       | `bigint NOT NULL DEFAULT 1`          | events in chain                        | ✓     |

**Verdict.** Schema matches doctrine and SRD §17. No discrepancies.

### Aux tables

`audit.session`, `audit.redaction`, `audit.public_anchor`,
`audit.anomaly_alert`, `audit.public_export` all match the doctrine
§3 / §5 / §7 / §8 contracts. Block-B reconciliation §5.b also added
`entity.canonical.neo4j_mirror_state` (commit `3bc1250`) which is
orthogonal — not part of TAL-PA but documented here since it
shipped on the same Block-A branch.

---

## A6.4 — Salt rotation operations (`AUDIT_PUBLIC_EXPORT_SALT`)

The doctrine §5 specifies that the quarterly anonymised CSV export
hashes `actor_id` with a per-quarter rotated salt. The salt's
**custody, rotation cadence, and operational procedure** are
captured here so that future architects (or the backup architect
during disaster recovery) can rotate without re-deriving the
contract from code.

### What the salt does

`hashPii(actor_id, AUDIT_PUBLIC_EXPORT_SALT)` is the keyed hash that
appears as `actor_id_hash` in the quarterly public export CSV
(IPFS-pinned). With a fresh salt each quarter:

- **Within a quarter:** an external observer can correlate
  `actor_id_hash` across rows in the SAME quarterly CSV (they share
  the salt). This is the intended observability — "actor X took 14
  decisions in Q3-2026."
- **Across quarters:** `actor_id_hash` from Q3-2026 cannot be
  matched to `actor_id_hash` for the same actor in Q4-2026
  (different salts). This caps the long-term linkability surface.

### Salt format

- 32-byte hex string (64 hex chars) — entropy >= the chain's
  signature scheme.
- Generated via `openssl rand -hex 32` (or equivalent CSPRNG; never
  `Math.random` or human-chosen).
- The literal string `PLACEHOLDER` is refused by both
  [`hashPii`](../../packages/audit-log/src/public-view.ts#L75) and
  [`runQuarterlyAuditExport`](../../apps/adapter-runner/src/triggers/quarterly-audit-export.ts#L80) — defence-in-depth.

### Custody

Per [TODO_PHASE1_CLOSURE.md §3.5.2](../TODO_PHASE1_CLOSURE.md):

- The salt lives in HashiCorp Vault at path
  `tal-pa/public-export-salt-q{N}` where `{N}` is the quarter
  identifier (e.g. `2026Q3`).
- Each quarter's salt is committed BEFORE the export job runs.
- The architect (or backup architect during DR) is the only role
  that holds the Vault token capable of writing to that path. The
  adapter-runner service has read-only access to the current
  quarter's path.
- Old salts (previous quarters) are RETAINED in Vault — never
  deleted — so a future audit can re-verify the published CSV's
  hashes by re-reading the salt and re-running `hashPii`. Removing
  old salts breaks cryptographic auditability of past exports.

### Rotation cadence

Quarterly. Specifically:

- The export cron `0 5 1 1,4,7,10 *` Africa/Douala runs on the 1st
  of January, April, July, October at 05:00 local.
- The salt rotation MUST happen BEFORE the cron fires for that
  quarter. The standard window is the last week of the previous
  quarter (Dec 24–31, Mar 24–31, Jun 24–30, Sep 24–30).
- The architect runs the rotation manually:

```bash
# 1. Generate new salt
NEW_SALT="$(openssl rand -hex 32)"

# 2. Determine the next quarter label
NEXT_Q="$(date -d 'next quarter' +%YQ%q)"  # e.g. 2026Q3

# 3. Write to Vault (architect's token only)
vault kv put tal-pa/public-export-salt-${NEXT_Q} \
  salt="${NEW_SALT}" \
  generated_at="$(date -Iseconds)" \
  rotated_by="architect:junior"

# 4. Update the adapter-runner env to point at the new path on the
#    next deploy. The PLACEHOLDER guard fires on boot if env still
#    holds the old or literal PLACEHOLDER.
```

### Salt-collision detection

[`audit.public_export.salt_fingerprint`](../../packages/db-postgres/src/schema/audit-log.ts#L144)
stores the first 8 hex of `sha256(salt)` per export row. If two
consecutive quarterly exports share a fingerprint, the operator
forgot to rotate. The
[`audit.public_export_salt_collisions`](../../packages/db-postgres/drizzle/0012_audit_export_salt_fingerprint.sql)
view surfaces collisions; a CI alert (deferred to a follow-up)
fires on a non-empty result.

### Disaster recovery

If the architect is unavailable and a quarterly export must ship
mid-rotation-window:

1. The backup architect (per HSK-v1 §5.3) opens the safe-deposit
   box that holds the offline copy of the architect's Vault recovery
   token.
2. They use the token to `vault kv put tal-pa/public-export-salt-{NEXT_Q}`
   with a freshly generated 32-byte hex salt.
3. The export runs as normal with the new salt.
4. The audit row at `audit.actions` records who performed the
   rotation (the backup architect's actor_id).
5. The architect, when available, reviews the `decision.recorded`
   audit row and the new Vault path, and updates the doctrine
   custody section if procedure changed.

### Failure modes & guards

| Failure mode                       | Guard                                                                                      |
| ---------------------------------- | ------------------------------------------------------------------------------------------ |
| Salt env var unset                 | `runQuarterlyAuditExport` refuses (`apps/adapter-runner/.../quarterly-audit-export.ts:80`) |
| Salt env var literal `PLACEHOLDER` | Same guard + `hashPii` throws (`packages/audit-log/src/public-view.ts:75`)                 |
| Operator forgot quarterly rotation | `salt_fingerprint` collision view + (deferred) CI alert                                    |
| Vault unavailable mid-export       | `quarterly-audit-export` retries; cron re-fires next day if still down                     |
| Salt deleted from Vault            | Past export hashes become unreproducible — operational policy: **never delete**            |

---

## What the architect does next (A6.5)

When the read-through checklist
[`docs/decisions/decision-012-readthrough-checklist.md`](decision-012-readthrough-checklist.md)
is fully signed AND the items above review clean:

1. Open [`docs/decisions/log.md`](log.md), find the DECISION-012 entry
   (currently around line 2444).
2. Change `Status: PROVISIONAL — promote to FINAL ...` → `Status: FINAL`.
3. Append a `Promoted to FINAL: 2026-NN-NN` line + `Architect: ...` line.
4. Commit on `main` with `git commit -S`:
   `chore(decisions): promote DECISION-012 (TAL-PA) to FINAL`.
5. Emit the `decision.recorded` audit-of-audit row per the
   read-through checklist's procedure block.

The agent does not perform A6.5 autonomously per the architect's
Block-B operating posture ("Do not promote any DECISION from
PROVISIONAL to FINAL autonomously").
