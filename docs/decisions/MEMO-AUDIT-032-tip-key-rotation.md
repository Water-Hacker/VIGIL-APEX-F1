# Memo to architect — AUDIT-032 / TIP_OPERATOR_TEAM_PUBKEY rotation cadence

**Date:** 2026-05-01
**Author:** build agent (Claude)
**Status:** awaiting architect decision
**Scope:** picks the rotation cadence for the libsodium sealed-box static key
that encrypts citizen tips in transit from `/tip` → operator triage.

---

## 1. The question

`TIP_OPERATOR_TEAM_PUBKEY` is a libsodium `crypto_box_seal` static key
served by [`apps/dashboard/src/app/api/tip/public-key/route.ts`](../../apps/dashboard/src/app/api/tip/public-key/route.ts).
The browser fetches it, encrypts each tip body to it, and posts the
ciphertext. Sealed-box generates a fresh ephemeral key on every send,
so each ciphertext has a per-tip ephemeral keypair — but the
**receiver-side static key** can be reused indefinitely.

**No documented rotation cadence today.** AUDIT-032 originally claimed
DECISION-016 specified "90-day rotation" — that was wrong. The 90-day
references at [`docs/decisions/log.md:1193`](log.md) and `:1454` are
the **federation-signer** rotation (DECISION-014c), a different key
class. DECISION-016 covers tip retention + UI; it does not specify
operator-tip-key rotation.

The build agent will not pick a rotation cadence unilaterally
(per the per-finding workflow rule "Don't pick a number without
confirming"). This memo lays out three candidate cadences and
recommends one for the architect to confirm or override.

---

## 2. Threat model recap

`TIP_OPERATOR_TEAM_PUBKEY` is the long-term static receiver key for
sealed-box encryption. If an adversary obtains the corresponding
private key:

- **Retroactive decryption.** Every sealed-box ciphertext sent to the
  static key during the key's lifetime can be decrypted, including
  ciphertexts the adversary captured weeks earlier (no forward secrecy
  in `crypto_box_seal`).
- **No replay protection.** The sealed-box construction is not
  authenticated (the ephemeral sender is anonymous by design). Replay
  is mitigated by transport TLS + the dashboard's idempotency keys,
  not by the cipher.

Rotation reduces the **window of retroactive exposure**. After
rotation, ciphertexts encrypted to the old static key are no longer
decryptable by the new private key; the old private key MUST be
destroyed (or kept offline only for the agreed retention window of
existing tips that have not yet been triaged).

---

## 3. Three candidate cadences

### Option A — 90 days, mirroring federation-signer (DECISION-014c)

**Operational shape:** rotate every 90 days; ramp up the new key 7
days before cutover (dashboard fetches both keys, encrypts to the
newer one, accepts ciphertexts to either); destroy the old private
key 30 days after cutover (after the operator has triaged or migrated
all open tips).

**Pros**

- Mirrors an existing cadence the operator already runs (less calendar
  fragmentation).
- 90 days is a known industry norm for static long-term keys.
- The federation-signer rotation runbook already exists; tip-key
  rotation can reuse the same operational ceremony.

**Cons**

- The federation-signer protects integrity of regional → core feeds;
  the tip-operator key protects citizen anonymity. Different threat
  models, different blast radius. Coupling them on calendar invites
  "rotation fatigue" — if one slips, the other slips.
- A 90-day exposure window for citizen tips is non-trivial. A leaked
  private key compromises three months of citizen-submitted evidence
  at once.

### Option B — Quarterly, mirroring `AUDIT_PUBLIC_EXPORT_SALT` (DECISION-012)

**Operational shape:** rotate at every quarterly public-export salt
rotation (already a 4-times-per-year ceremony). Cutover at the
quarterly export run; destroy old private key after the quarter's
tips have been triaged.

**Pros**

- Same calendar as the public-export salt → one quarterly key
  ceremony covers two key classes.
- 90-day cadence in practice (similar to Option A) but the operator
  invests in **one** ceremony per quarter rather than two.
- The quarterly anchor is already a public, externally-observable
  cadence (the public CSV publishes on it). Tip-key rotation
  becomes auditable from outside the system.

**Cons**

- Couples tip-key rotation to TAL-PA's public-export schedule. If the
  TAL-PA cadence ever changes (e.g., monthly exports under public
  pressure), tip-key rotation either follows blindly or de-couples
  with no clear rule.
- The quarterly ceremony is heavier than a quiet 90-day rotation —
  more chance of an operator deferring the quarterly batch.

### Option C — Council-rotation-coupled (per DECISION-005 council cadence)

**Operational shape:** rotate every time a council member is enrolled
or resigns (i.e., every membership change of the 5-of-5 set).

**Pros**

- Anchors rotation to a real-world authority change. After a council
  member rotation, the new committee has cryptographic proof that
  the operator has "started over" with citizen tips.
- Ties the citizen-trust contract directly to the council's
  legitimacy. A leak surfaces at a member-change event when escrow
  reset is already on the table.

**Cons**

- Council rotation cadence is **unpredictable** — could be 2 years
  between events, could be 3 weeks. A 2-year stale key is worse than
  any of the other options. Adding a "max age" clause re-introduces
  the calendar-cadence question.
- Couples the cipher key lifecycle to a political body. If the
  council is briefly inquorate (4 of 5), is the tip key valid? The
  spec gets complex.

---

## 4. Recommendation

**Option A — 90-day calendar rotation, mirroring federation-signer**,
with one explicit difference from the federation-signer runbook: the
**old private key MUST be destroyed 30 days after cutover** (rather
than retained in cold storage indefinitely). The 30-day grace covers
operator triage of ciphertexts that arrived just before cutover; past
30 days, retroactive decryption is no longer possible regardless of
key compromise.

**Why this option:**

1. The threat model is "bound the retroactive-decryption window."
   90 days is the smallest standard interval that doesn't impose a
   monthly ceremony. Option B (quarterly) is roughly the same window
   but couples to an unrelated cadence; Option C (council-coupled)
   has unbounded staleness.
2. Mirroring federation-signer keeps the operator runbook simple —
   one rotation calendar across the two static-key classes the system
   ships.
3. The 30-day private-key-destruction rule is the meaningful security
   improvement on top of the calendar choice. Once the architect
   confirms cadence, the build agent can wire:
   - a runtime check at `/api/tip/public-key` that refuses to serve
     a key older than 90 days (state stored in Vault with `not_after`)
   - an alert when the key is within 7 days of expiry (operator
     provisioning warning)
   - a unit test asserting refusal past max age and refusal of an
     absent `not_after` claim.

The rotation runbook itself (SOP for the operator) is a separate
deliverable; it is not part of this memo.

---

## 5. Architect read-through checklist

Confirm one of:

- [ ] **Approve Option A** — 90 days, federation-signer-aligned, with
      30-day post-cutover private-key destruction. Build agent proceeds
      to wire the runtime check + test in a follow-up branch.
- [ ] **Approve Option B** — quarterly, AUDIT_PUBLIC_EXPORT_SALT-aligned,
      with same 30-day destruction rule. Build agent proceeds.
- [ ] **Approve Option C** — council-rotation-coupled, with explicit
      max-age clause (architect specifies the max).
- [ ] **Reject all three** — architect proposes a fourth cadence.

The decision is recorded in `docs/decisions/log.md` as a follow-up to
DECISION-016, and AUDIT-032 in [AUDIT.md](../../AUDIT.md) flips from
`needs-human-confirmation` to `fixed` once the runtime check ships.

---

## 6. Files this memo touches once approved

| File                                                                                                             | Change                                                                                 |
| ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| [`docs/decisions/log.md`](log.md)                                                                                | DECISION-018 (or similar) — tip-key rotation cadence, FINAL after approval             |
| [`apps/dashboard/src/app/api/tip/public-key/route.ts`](../../apps/dashboard/src/app/api/tip/public-key/route.ts) | runtime check refuses key older than max-age                                           |
| [`apps/dashboard/__tests__/tip-public-key-rotation.test.ts`](../../apps/dashboard/__tests__/) (new)              | refusal past max age + refusal on missing `not_after`                                  |
| [`.env.example`](../../.env.example)                                                                             | document `TIP_OPERATOR_TEAM_PUBKEY_NOT_AFTER` (ISO date)                               |
| [`OPERATIONS.md`](../../OPERATIONS.md)                                                                           | add the rotation SOP step under §R3 (YubiKey rotation runbook is the closest analogue) |

No code change ships in this memo; this is a decision document only.
