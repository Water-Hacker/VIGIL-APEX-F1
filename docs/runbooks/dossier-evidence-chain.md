# Dossier evidence-chain runbook

Block-E E.13 / C9 backup gap 3.

## Court-defensible artefact-of-record

VIGIL APEX produces tamper-evident audit dossiers. The architect's
binding framing is: _"the artefact-of-record convention says you
produce the document itself, not the means of producing it."_ In
practice that means a court reviewer must be able to verify the audit
chain WITHOUT a running Postgres cluster, WITHOUT the operator's
help, and WITHOUT trusting any single component.

Three artefacts together meet this bar:

1. **`audit-chain.csv`** — every row of `audit.actions` exported with
   ISO-8601 millisecond-precision timestamps, hex-encoded prev_hash /
   body_hash, and JSONB payload rendered as text.
2. **`audit-chain.csv.sig`** — architect-GPG detached signature over
   the CSV. Confirms the file content was authored by the architect's
   hardware key at backup time.
3. **`scripts/verify-hashchain-offline.ts`** — pure-function chain
   walker that recomputes body_hash + row_hash via the SAME canonical
   functions the in-Postgres `HashChain.verify()` uses (architect E.13
   hold-point option a — strict bit-identical parity).

## Verifying an archive

From any host (including a court reviewer's air-gapped laptop):

```sh
# 1. Verify the signature (proves the CSV is the architect-authored file).
gpg --verify audit-chain.csv.sig audit-chain.csv

# 2. Walk the chain (recomputes every body_hash + row_hash).
pnpm tsx scripts/verify-hashchain-offline.ts audit-chain.csv
```

Both must succeed. Exit 0 from the verifier means every row's hash
chains back to the prior row by construction; any break is reported
with the offending `seq` and the offending field
(`body_hash` / `prev_hash` / `seq_gap`).

## Bit-identical-parity proof

The unit test
[`packages/audit-chain/__tests__/offline-verify.test.ts`](../../packages/audit-chain/__tests__/offline-verify.test.ts)
constructs a deterministic 100-row chain in memory using the same
`bodyHash` + `rowHash` functions both verifier paths (in-Postgres
`HashChain.verify()` and offline `verify()`) consume, renders the
chain to the CSV format `10-vigil-backup.sh` produces, parses it back,
and asserts the offline verifier returns OK on the clean chain and
reports the right field on each break category (body_hash tampering,
prev_hash tampering, seq-gap).

By construction (single-source canonicalisation), the two paths agree
byte-for-byte. The unit test pins the CSV pipeline; the canonical
functions are pinned by
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
