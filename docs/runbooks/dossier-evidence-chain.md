# Dossier evidence-chain runbook

Block-E E.13 / C9 backup gap 3 (architect-clarified E.13.c).

> **Procedural-law citation placeholder.** The artefact-of-record
> convention here is a technical mirror of a procedural-law concept
> (preuve documentaire / documentary evidence). Cameroonian civil
> procedure recognises documentary evidence under specific articles
> of the procedural code; this runbook intentionally does NOT
> identify the article number — that is counsel's call.
>
> `<<COUNSEL: confirm article number for documentary evidence under
Cameroonian civil procedure code>>`
>
> When counsel returns the citation, replace this block with the
> definitive article reference. Do not invent or guess.

## Court-defensible artefact-of-record

VIGIL APEX produces tamper-evident audit dossiers. The architect's
binding framing is: _"the artefact-of-record convention says you
produce the document itself, not the means of producing it."_ In
practice that means a court reviewer must be able to verify the audit
chain WITHOUT a running Postgres cluster, WITHOUT the operator's
help, and WITHOUT trusting any single component.

Four artefacts together meet this bar:

1. **`audit-chain.csv`** — every row of `audit.actions` exported with
   ISO-8601 millisecond-precision timestamps, hex-encoded prev_hash /
   body_hash, and JSONB payload rendered as text. Schema is **format
   v1, 10 columns**: `id, seq, action, actor, subject_kind,
subject_id, occurred_at, payload, prev_hash, body_hash` (in this
   order). The verifier validates the header against this column
   list and refuses to parse if the header drifts — any future
   schema change must bump the format version explicitly and update
   both the writer (`10-vigil-backup.sh`) and the parser
   (`packages/audit-chain/src/offline-verify.ts:EXPECTED_COLUMNS`)
   in the same commit.
2. **`audit-chain.csv.sig`** — architect-GPG detached signature over
   the CSV. Confirms the file content was authored by the architect's
   hardware key at backup time.
3. **`scripts/verify-hashchain-offline.ts`** — pure-function chain
   walker that recomputes body_hash + row_hash via the SAME canonical
   functions the in-Postgres `HashChain.verify()` uses (architect E.13
   hold-point option a — strict bit-identical parity by construction;
   neither path has its own copy of the canonicalisation algorithm).
4. **A signed verification report** — the verifier's stdout output
   is byte-deterministic (no timestamps, no random ids); the
   reviewer signs the report bytes via `gpg --detach-sign` to attest
   "I ran this verifier on this CSV and got this result". Two
   independent reviewers signing the same report content produces
   end-to-end attestation that survives any single-component
   compromise.

### Payload column format

The `payload` column is a single-cell JSON-encoded string — the
JSONB column rendered as text by Postgres' `\copy ... CSV HEADER`.
This was the deliberate choice over flattened-per-known-shape
columns because the audit-action payload schema is open-ended (each
action contributes its own subset of fields), and a flattened CSV
would either drop fields silently or break on every new action.
JSON-encoded keeps the schema stable; the CSV header itself is the
schema for the row metadata, while payload schema is per-action and
documented in [`packages/shared/src/schemas/audit.ts`](../../packages/shared/src/schemas/audit.ts).

## Verifying an archive

From any host (including a court reviewer's air-gapped laptop):

```sh
# 1. Verify the signature on the CSV (proves the file is architect-authored).
gpg --verify audit-chain.csv.sig audit-chain.csv

# 2. Walk the chain — recomputes every body_hash + row_hash, collects
#    every divergence (does NOT stop at first), writes a deterministic
#    verification report to stdout.
pnpm tsx scripts/verify-hashchain-offline.ts audit-chain.csv > report.txt
echo "exit code: $?"

# 3. Sign the report so the verification result itself is attested.
gpg --detach-sign --armor -o report.txt.sig report.txt
```

The verifier surfaces EVERY divergence found in the CSV in a single
pass — partial tampering at row N does not mask further tampering at
row N+k (architect E.13.c review #4: continue-and-collect cascade-
suppression via the recomputed-rh rolling-pointer trick).

### Exit-code contract (architect E.13.c review #5)

The verifier's exit code is **stable across releases**. Court use
relies on this contract:

| Exit | Meaning               | Report content                                                                                                  |
| ---- | --------------------- | --------------------------------------------------------------------------------------------------------------- |
| `0`  | chain intact          | `status: OK`; `rows-verified == rows-input`; no divergences listed                                              |
| `1`  | chain has divergences | `status: BREAK (<m> divergences)`; one line per divergence, in seq order                                        |
| `2`  | input error           | one-line stderr message; no report on stdout (CSV malformed, header invalid, payload not JSON, file unreadable) |

Any future change to this contract requires a new format-version
number AND a runbook update in the same commit. Treat exit codes as
a binding interface, not an implementation detail.

### Divergence report format

Each divergence is one line:

```
seq=<n> field=<body_hash|prev_hash|seq_gap> expected=<hex|str> actual=<hex|str>
```

The header lines fix the report version + CSV format version + row
counts so a reviewer can confirm the report was produced by a
known-good verifier against a known-good CSV before signing.

## Bit-identical-parity proof

Both paths import `bodyHash` + `rowHash` from a single source
([`packages/audit-chain/src/canonical.ts`](../../packages/audit-chain/src/canonical.ts)):

```
packages/audit-chain/src/hash-chain.ts:4    import { bodyHash, rowHash } from './canonical.js';   # in-Postgres path
packages/audit-chain/src/offline-verify.ts:16 import { bodyHash, rowHash } from './canonical.js';   # offline path
```

`grep -rn 'createHash.*sha256' packages/audit-chain/src` returns
exactly one site (`canonical.ts` line 37 / 41). There is no second
copy of the canonicalisation algorithm anywhere in the tree. This
makes the parity-by-construction guarantee a structural property of
the source, not a runtime claim — and the architect can re-run that
grep at any time to confirm.

The unit test
[`packages/audit-chain/__tests__/offline-verify.test.ts`](../../packages/audit-chain/__tests__/offline-verify.test.ts)
constructs a deterministic 100-row chain in memory using the same
`bodyHash` + `rowHash` functions, renders the chain to the CSV format
`10-vigil-backup.sh` produces, parses it back, and asserts:

- The offline verifier returns OK on the clean chain (parity with
  the in-Postgres `HashChain.verify()` happy path).
- Two independent body_hash tampers (rows 3 and 7) surface as TWO
  divergences in a single pass — cascade suppression validated.
- Body_hash and prev_hash divergences from different rows surface
  cleanly without each masking the other.
- The report bytes are stable across reruns (the signable property
  — same input always produces the same report content).

The canonical primitives are pinned by
[`packages/audit-chain/__tests__/canonical.test.ts`](../../packages/audit-chain/__tests__/canonical.test.ts).

## What this runbook does NOT cover

- **Polygon-side anchor verification.** The on-chain Merkle commitment
  is a separate (orthogonal) check; see
  [`packages/audit-chain/src/verifier.ts`](../../packages/audit-chain/src/verifier.ts)
  `LedgerVerifier.verifyAll()`. The offline CSV verifier here proves
  the chain's internal integrity; the on-chain anchor proves the
  chain's externally-visible commitment. Both are needed for
  end-to-end attestation.
- **Per-actor `audit.user_action_event` chain.** That chain has a
  different topology (per-actor head, separate `record_hash`
  algorithm); the `audit-user-actions.csv` exported alongside is
  archival only at this scope. Building the offline verifier for the
  per-actor chain is a Phase-2 task.
- **Restoration.** [`docs/RESTORE.md`](../RESTORE.md) covers full
  cluster restore from the backup archive; the verifier here is for
  attestation, not restoration.
