# Slither Baseline — VIGIL APEX Smart Contracts

**Generated:** 2026-04-29
**Slither version:** 0.11.5
**solc:** 0.8.27 (matches contract pragma)
**Scope:** `contracts/contracts/VIGILAnchor.sol`, `contracts/contracts/VIGILGovernance.sol`
**Result:** **0 findings** under [`contracts/slither.config.json`](../../contracts/slither.config.json).

---

## How to reproduce locally

```bash
# Install (one-time)
python3 -m venv /tmp/slither-venv
/tmp/slither-venv/bin/pip install slither-analyzer
unset VIRTUAL_ENV
/tmp/slither-venv/bin/solc-select install 0.8.27
/tmp/slither-venv/bin/solc-select use 0.8.27

# Run
cd contracts/
/tmp/slither-venv/bin/slither . \
  --config-file slither.config.json \
  --solc /home/kali/.solc-select/artifacts/solc-0.8.27/solc-0.8.27
```

CI runs the same command via [.github/workflows/contract-test.yml](../../.github/workflows/contract-test.yml). After this baseline lands, the workflow's `|| true` is removed so any new finding is a blocking failure.

---

## Initial run (no config) — 21 findings

The unconfigured run produced 21 findings. They split into three buckets:

### Bucket 1 — actionable in our code (1)

| #   | Detector             | Where                                                                                           | Action                                                                                                        |
| --- | -------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| 1   | `missing-zero-check` | [VIGILAnchor.sol](../../contracts/contracts/VIGILAnchor.sol) constructor `_committer` parameter | **Fixed.** Same pattern as `rotateCommitter` — `if (_committer == address(0)) revert ZeroCommitterAddress();` |

### Bucket 2 — false-positive on our use, suppressed via [`slither.config.json`](../../contracts/slither.config.json) (6)

| Detector                | Count | Where                                                                                                   | Why suppressed                                                                                                                                                                                                                                                                                    |
| ----------------------- | ----- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `timestamp`             | 5     | `VIGILGovernance.{vote, openProposal, settleExpiredProposal, getProposal}`, `VIGILAnchor.getCommitment` | Slither flags any use of `block.timestamp`. Three of our uses are in views that read stored timestamps without comparison; the other two enforce a 14-day vote window and a 2-minute commit-reveal delay — both vastly outside the ~15-second miner-influence range the detector exists to catch. |
| `cyclomatic-complexity` | 1     | `VIGILGovernance.vote` (CCN = 12)                                                                       | Informational. The choice-dispatch chain (`if YES … else if NO … else if ABSTAIN … else if RECUSE …`) is intentionally flat for readability; refactoring into a lookup table would obscure the per-choice state-machine semantics that auditors need to read sequentially.                        |

### Bucket 3 — out of scope (third-party code), suppressed via `filter_paths: "node_modules"` (14)

| Detector             | Count | Source                                                                                                |
| -------------------- | ----- | ----------------------------------------------------------------------------------------------------- |
| `assembly`           | 9     | `@openzeppelin/contracts/utils/StorageSlot.sol` (intentional — that's the entire purpose of the file) |
| `solc-version`       | 3     | OZ pragmas `>=0.8.4`, `^0.8.20`, `>=0.4.16` (the union of OZ floor versions)                          |
| `pragma`             | 1     | "4 different versions of Solidity used" — same OZ-version-floor situation                             |
| `missing-zero-check` | 1     | `Ownable2Step.transferOwnership(newOwner)` — OZ design choice; out of scope for our audit             |

The `--filter-paths node_modules` flag drops Bucket 3 entirely. The `detectors_to_exclude` list in the config drops Bucket 2.

---

## Fixed — `missing-zero-check` on VIGILAnchor constructor

Before:

```solidity
constructor(address _committer) Ownable(msg.sender) {
    committer = _committer;
}
```

After:

```solidity
constructor(address _committer) Ownable(msg.sender) {
    if (_committer == address(0)) revert ZeroCommitterAddress();
    committer = _committer;
}
```

The `ZeroCommitterAddress()` custom error already existed (added in commit `99a3c13`) for `rotateCommitter`'s zero-check; reusing it here keeps the contract's revert-vocabulary consistent.

---

## Configured run — 0 findings

```
. analyzed (11 contracts with 96 detectors), 0 result(s) found
```

11 contracts = ours (2) + the OZ inheritance graph (9). Zero results across the configured detector set.

---

## Re-run cadence

- **CI:** every push or PR touching `contracts/**` runs the workflow above. After this commit, the workflow uses the same `slither.config.json` and runs without `|| true`, so any new finding fails the job and gates the merge.
- **Local:** the architect runs the reproduce command above when adding or modifying a contract.
- **Quarterly:** when the binding docs are reconciled per EXEC §43.4, the baseline is re-run with the latest Slither release; if new detectors fire, the response is the same triage (real / false-positive / OZ).

## Configured detector exceptions — when to revisit

Each entry in `detectors_to_exclude` should be re-evaluated when the surrounding code changes substantially:

| Detector                 | Re-evaluate when                                                                                                               |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `timestamp`              | Any new state-changing function uses `block.timestamp` for a comparison < 1 hour, OR a new view-only function reads timestamps |
| `cyclomatic-complexity`  | `vote()` is refactored, OR a new function reaches CCN ≥ 10                                                                     |
| `solc-version`, `pragma` | OpenZeppelin contracts version bumps; the floor-pragma situation may change                                                    |
| `assembly`               | Any contract under `contracts/contracts/` adopts inline assembly (none currently does)                                         |

If any of those conditions arise, drop the relevant entry from the config and re-classify the resulting findings before re-suppressing.
