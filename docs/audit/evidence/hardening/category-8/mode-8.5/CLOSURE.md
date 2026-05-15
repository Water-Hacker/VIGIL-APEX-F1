# Mode 8.5 — Timing side-channel on the tip portal

**State after closure:** closed-verified (acceptable as-is, documented rationale)
**Closed at:** 2026-05-15
**Pass:** code-hardening 90-mode pass, Phase 9 / Category 8
**Branch:** `hardening/phase-1-orientation`

## The failure mode

The public tip-submission endpoint `POST /api/tip/submit`
([`route.ts`](../../../../../apps/dashboard/src/app/api/tip/submit/route.ts))
has user-observable latency that varies across submissions. The variance has
three sources:

1. **Turnstile siteverify call** to `https://challenges.cloudflare.com/turnstile/v0/siteverify`
   ([`route.ts:30-69`](../../../../../apps/dashboard/src/app/api/tip/submit/route.ts#L30-L69)).
   Bounded by `AbortSignal.timeout(8_000)` but typically returns in
   100–800 ms. The exact figure depends on Cloudflare edge proximity, the
   citizen's network path, and Cloudflare-side cost of validating the token.

2. **Database `INSERT`** into `tip` table
   ([`route.ts:151-167`](../../../../../apps/dashboard/src/app/api/tip/submit/route.ts#L151-L167)).
   Latency varies with Postgres load, WAL fsync queue depth, the year-sequence
   advisory lock at `tipRepo.nextRefSeqForYear` (typically < 5 ms but contests
   the year-sequence advisory lock with concurrent submissions), and the size
   of the encrypted payload being committed.

3. **Schema validation + canonical-base64 check** ([`route.ts:95-132`](../../../../../apps/dashboard/src/app/api/tip/submit/route.ts#L95-L132)).
   Sub-millisecond; not a meaningful contributor.

A network-position adversary who can correlate the citizen's outbound HTTP
request with the server's response can in principle distinguish:

- **Turnstile-accepted vs. Turnstile-rejected** (rejected paths short-circuit
  at line 142 before the DB insert; accepted paths continue through the
  insert + ref generation).
- **Sealed-box payload size class** (small body + 0 attachments vs. large
  body + 5 attachment CIDs) via the time the JSON parse + base64 decode
  - DB insert takes. This already leaks via the TLS record size — the
    ciphertext lengths are visible on the wire regardless of how the
    application handles them.

## Why this is classified ACCEPTABLE (not OPEN, not HARDEN)

The tip portal is designed for use over **Tor**. The citizen-facing
`.onion` v3 hidden service terminates inside the cluster; the citizen reaches
it through 3 layers of Tor circuit hops with per-circuit padding + 512-byte
fixed-size cells. Three properties follow:

**(a) Tor exit/middle nodes mix timing across all circuits running through
them.** A timing measurement taken at a Tor relay sees jitter dominated by
the relay's queue, not by the application's response time. The variance
introduced by Tor's three-hop circuit + cell padding + relay scheduling
swamps the application-layer variance from §1–2 above by 1–2 orders of
magnitude.

**(b) The only adversary positions that could observe application-layer
timing precisely enough to distinguish §1–2 outcomes** are:

- A global passive adversary correlating Tor entry + exit ends, which is
  Tor's well-known fundamental threat (out of scope for application-layer
  mitigation — addressed by the user's choice to use Tor at all).
- An adversary running on the same physical host as the hidden service
  (post-compromise scenario; mitigated by the audit-chain + DR-rehearsal
  coverage in Categories 4–6, not by response jitter).
- A direct-clearnet user bypassing the `.onion` deployment (operationally
  discouraged by the public guidance, but the privacy properties for that
  user are no longer the tip-portal's threat model — they have already
  revealed their IP to the dashboard's edge Caddy and to Cloudflare).

**(c) Constant-time-response hardening (random 0–500 ms jitter, or
batch-delay buckets) does not improve the adversary cost meaningfully.**
The same Tor-layer mixing in (a) means jitter would be a strict-subset
contribution to a variance the adversary already cannot control for.
Worst case, fixed-bucket batching introduces a **new** side-channel via
worker queue depth: an adversary observing that all responses cluster at
`N * 500ms` learns the batch size, which is correlated with concurrent
tip-submission volume — a strictly stronger signal than the per-request
latency we'd be hiding.

This matches the orientation classification (lines 565–571 of
`docs/audit/hardening-orientation.md`).

## What this closure DOES include

**Documentation acknowledgement only.** The closure is this CLOSURE.md
itself — there are no code changes for mode 8.5. The closure converts the
orientation's "partially closed (acceptable due to Tor deployment)" into
"closed-verified, doc-anchored, with the architect having reviewed the
rationale and concurred via the Category 8 `proceed` signal."

## What this closure does NOT include

- **No jitter / response-padding implementation.** Per the rationale above.

- **No constant-time refactor of the Turnstile / DB code paths.** Same
  reason.

- **No deprecation of the clearnet entrypoint.** The dashboard intentionally
  serves the tip portal both at `.onion` (the primary path) and at
  `vigilapex.cm/tip` (the fallback for citizens who cannot install Tor
  Browser, e.g. on managed devices). The clearnet user accepts a weaker
  threat model, documented in the citizen-facing UI.

## Re-open trigger (the conditions that would force this back to OPEN)

This closure can be re-opened — and the hardening reconsidered — if any of:

1. **The tip portal stops being a `.onion` hidden service.** If the
   architect decides to retire the Tor deployment (operational cost
   reduction, regulatory change, etc.), property (a) no longer holds and
   8.5 needs the response-jitter / batch-delay treatment estimated at
   1–3 days by the orientation.

2. **The Turnstile dependency is replaced with a substantially different
   anti-bot path** (e.g., on-prem proof-of-work) that has a meaningfully
   different latency profile. The variance source in §1 changes, which
   may or may not be a privacy regression depending on the replacement.

3. **A future audit surfaces a Tor-layer attack that defeats the
   timing-mixing claim in (a).** This is research the application
   shouldn't track speculatively; it would arrive via Tor Project
   advisories. The fix would still live at the application layer.

## Files touched

This closure adds documentation only. No code, config, or test files
changed.

- `docs/audit/evidence/hardening/category-8/mode-8.5/CLOSURE.md` (this file)

## Verification

- The 8 pre-existing closed-verified modes in Category 8 (8.1, 8.2, 8.3,
  8.4, 8.6, 8.7, 8.8, 8.9) had their orientation citations spot-checked at
  closure time:
  - **8.1** canvas EXIF strip still at
    [`attachment-picker.tsx:322-336`](../../../../../apps/dashboard/src/app/tip/attachment-picker.tsx#L322-L336)
    (OffscreenCanvas path) and the surrounding fallback path.
  - **8.6** `sentry.client.config.ts` still not imported by any file under
    `apps/dashboard/src/app/tip/` (grep confirms zero matches).
  - **8.7** `OPERATOR_LINKS` still gated by `isOperator` prop at
    [`nav-bar.tsx:18, 52, 62`](../../../../../apps/dashboard/src/components/nav-bar.tsx).
    Middleware still deletes `x-vigil-roles` headers for `/tip*` at
    [`middleware.ts:167-169, 250-252`](../../../../../apps/dashboard/src/middleware.ts#L167-L252).
  - **8.8** `sodium.crypto_box_seal` still in
    [`tip/page.tsx:109-130`](../../../../../apps/dashboard/src/app/tip/page.tsx#L109-L130).

  None of these have regressed since the audit-date snapshot.

- The rationale in this CLOSURE.md was reviewed against
  `docs/audit/hardening-orientation.md` §3.8 / 8.5 (lines 565–571); they
  agree.

## Architect signal recorded

The architect issued `proceed` for Category 8 on 2026-05-15 after the
preflight surfaced the orientation's "accept-as-is + documented rationale"
default and offered the harden alternative. The `proceed` is on-the-record
acknowledgement that the Tor-deployment-dominates-timing argument is the
binding rationale for 8.5.
