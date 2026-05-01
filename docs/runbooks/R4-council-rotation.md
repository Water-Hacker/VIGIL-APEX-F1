# R4 — Council pillar rotation (canonical)

> System-wide ceremony. Per-worker runbooks reference this file
> rather than replicating it. Only `worker-governance` and the
> dashboard council portal touch council state directly; every
> other worker omits R4.
>
> Per SRD §23 (Governance) + EXEC §08–§14 (council formation).

---

## When does R4 fire?

A pillar holder change. Triggers:

- A pillar holder steps down.
- A pillar holder is recused permanently (single-incident recusal
  is handled by the vote-time recusal flow, not R4).
- A pillar's WebAuthn / YubiKey credential is lost or compromised.
- Replacement appointment by the architect per EXEC §08.4.

The architect's hardware-key estate (HSK-v1) governs the cryptographic
half; this runbook governs the application-state half.

---

## Pre-conditions

- New pillar holder named in writing per EXEC §08.4.
- New pillar's YubiKey provisioned with WebAuthn keypair (HSK-v1 §4.6).
- The architect available 24h to authorise the rotation.
- No open council vote in progress that the rotating pillar is
  participating in (if there is, defer the rotation until that
  vote closes or, if urgent, the architect signs an override
  decision-log entry).

## Procedure

1. **Architect issues the rotation directive.** Signed in writing,
   filed under `personal/council/rotation-{NNN}.md`. References
   the outgoing pillar id + the new pillar id + effective date.

2. **Dashboard operator opens the council admin surface.** This is
   gated behind WebAuthn challenge — only the architect's YubiKey
   passes.

3. **Old pillar marked `terminated`.** The
   `governance.council_member` row's `terminated_at` field is set
   to NOW(). Audit row written via halt-on-failure
   `governance.pillar_terminated`.

4. **New pillar registered.** The new pillar's WebAuthn credential
   public key is added to `governance.council_member` with
   `started_at = NOW()`. Audit row written via
   `governance.pillar_appointed`.

5. **Quorum re-check.** Dashboard verifies `5` active pillars
   AND `3` of the 5 are reachable (last `ping_at` < 24h).
   If the rotation drops the count below 5, the dashboard refuses
   to record any pillar-affecting decision until a 5th is
   appointed.

6. **Audit chain emit.** Both audit rows hit the
   `audit.user_action_event` chain (per DECISION-012 / TAL-PA);
   `governance.pillar_terminated` and `governance.pillar_appointed`
   are HIGH_SIGNIFICANCE_EVENT_TYPES, anchored individually
   within seconds.

7. **Public surface.** The
   [public verify portal](../../apps/dashboard/src/app/verify/) shows
   the new pillar holder once the audit row's Polygon anchor
   confirms (typically < 5 min on mainnet).

## Validation

- `SELECT count(*) FROM governance.council_member WHERE terminated_at IS NULL` → exactly 5.
- `SELECT polygon_tx_hash FROM audit.public_anchor JOIN audit.user_action_event USING (event_id) WHERE event_type IN ('governance.pillar_terminated', 'governance.pillar_appointed') ORDER BY anchored_at DESC LIMIT 2` → both rows present, both anchored.
- The new pillar successfully signs a test challenge via the dashboard council portal.

## Rollback

If a defective rotation needs to be undone before the new pillar
casts a real vote:

1. Architect issues a counter-directive filed alongside the
   original.
2. New pillar's `terminated_at` set; old pillar's `terminated_at`
   cleared.
3. Audit row `governance.pillar_rotation_reverted` written
   (HIGH_SIGNIFICANCE).

Once a new pillar has cast a real vote, rotation is forward-only
— a defective appointment is corrected by another rotation, never
by retroactive removal.

## Workers that touch council state

| Service                                                                                    | What it reads / writes                                                                       |
| ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| [`apps/worker-governance/`](../../apps/worker-governance/)                                 | quorum-tally + recusal logic; reads `governance.council_member` + `governance.proposal_vote` |
| [`apps/dashboard/src/app/council/`](../../apps/dashboard/src/app/council/)                 | council portal UI + WebAuthn challenge / assertion                                           |
| [`apps/worker-anchor/src/high-sig-loop.ts`](../../apps/worker-anchor/src/high-sig-loop.ts) | anchors `governance.pillar_*` events individually within seconds                             |

Every other worker is council-state-blind. Per-worker R4 sections
in non-council runbooks read: **"N/A — see [R4-council-rotation.md](./R4-council-rotation.md)."**

## Cross-references

- SRD §23 (Council) — governance principle + 5-pillar structure.
- SRD §28 — quorum thresholds (3-of-5 escalate, 4-of-5 release).
- EXEC §08–§14 — pillar formation, recusal, replacement.
- HSK-v1 §4.6 — pillar YubiKey provisioning.
- DECISION-012 / TAL-PA-DOCTRINE-v1 §2 — `governance.pillar_*` event types.
