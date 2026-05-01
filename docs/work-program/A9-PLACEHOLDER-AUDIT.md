# A9 — Production-placeholder audit (Block-B 2026-05-01)

> Per PHASE-1-COMPLETION.md A9.1 + A9.2 + A9.3. Every PLACEHOLDER
> value in `.env.example`, `infra/sources.json`, `infra/docker/`,
> `infra/host-bootstrap/` is classified into:
>
> 1. **dev-default-acceptable** — local dev / docker compose boots with
>    the placeholder; the value is non-critical or has a graceful
>    degradation path.
> 2. **architect-must-set** — production-critical; service refuses to
>    start (or refuses to perform the gated action) with PLACEHOLDER.
> 3. **runtime-injection-from-vault** — the env var carries a Vault
>    path; Vault provides the real value at runtime; the env's
>    PLACEHOLDER is fine because the value is never read directly.

---

## Hits

| Source                                        | Var                                                                 | Category                                  | Existing guard                                                                                                     | Gap?                                                              |
| --------------------------------------------- | ------------------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| `.env.example:96`                             | `POLYGON_ANCHOR_CONTRACT=PLACEHOLDER_DEPLOYED_AT_M1`                | architect-must-set (Tier 1)               | `apps/worker-anchor/src/index.ts:48` rejects `null-address` (`0x0+`) only                                          | **YES — does not catch the literal `PLACEHOLDER_DEPLOYED_AT_M1`** |
| `.env.example:97`                             | `POLYGON_GOVERNANCE_CONTRACT=PLACEHOLDER_DEPLOYED_AT_M3`            | architect-must-set (Phase 3)              | none in tree (no Phase-3 worker yet)                                                                               | deferred — service that reads it doesn't exist                    |
| `.env.example:177`                            | `CONAC_SFTP_HOST=PLACEHOLDER_PROVISIONED_AT_M3`                     | architect-must-set (Tier 1)               | `worker-conac-sftp:104` `target.host.startsWith('PLACEHOLDER')` queues for retry                                   | OK                                                                |
| `.env.example:181`                            | `CONAC_SFTP_HOSTKEY_FINGERPRINT=PLACEHOLDER`                        | architect-must-set                        | `worker-conac-sftp:37` `requiredEnv` rejects PLACEHOLDER                                                           | OK                                                                |
| `.env.example:200`                            | `TIP_OPERATOR_TEAM_PUBKEY=PLACEHOLDER_LIBSODIUM_BASE64`             | architect-must-set                        | `apps/dashboard/.../tip/public-key/route.ts:13` rejects PLACEHOLDER, returns 503                                   | OK                                                                |
| `.env.example:201`                            | `TIP_ONION_HOSTNAME=PLACEHOLDER_HIDDEN_SERVICE.onion`               | dev-default-acceptable                    | the .onion is informational; tip portal works without it                                                           | OK                                                                |
| `.env.example:233`                            | `BACKUP_ARCHITECT_EMAIL=PLACEHOLDER`                                | architect-must-set (W-17)                 | no guard — value is referenced only in docs/runbooks                                                               | dev-acceptable; institutional gate not boot gate                  |
| `.env.example:235`                            | `BACKUP_ARCHITECT_KEY_FINGERPRINT=PLACEHOLDER`                      | architect-must-set (W-17)                 | none                                                                                                               | dev-acceptable; institutional gate                                |
| `.env.example:304`                            | `GPG_FINGERPRINT=` (comment notes "PLACEHOLDER refused at boot")    | architect-must-set (Tier 1)               | `worker-conac-sftp:47` rejects PLACEHOLDER + non-40-hex                                                            | OK                                                                |
| `.env.example:416`                            | `PLANET_API_KEY=PLACEHOLDER`                                        | dev-default-acceptable                    | `adapter-runner/.../satellite-trigger.ts:191` skips NICFI when key is PLACEHOLDER                                  | OK                                                                |
| `.env.example:431-434`                        | `SENTINEL_HUB_*`, `MAXAR_API_KEY`, `AIRBUS_API_KEY` (commented out) | dev-default-acceptable                    | commented, not active env                                                                                          | OK                                                                |
| `.env.example:438`                            | `MAPBOX_ACCESS_TOKEN=PLACEHOLDER`                                   | dev-default-acceptable                    | dashboard map degrades to no-tile-layer when missing/PLACEHOLDER                                                   | OK (degradation is acceptable)                                    |
| `.env.example:447`                            | `CONAC_SFTP_HOST=PLACEHOLDER` (delivery-targets duplicate of :177)  | architect-must-set                        | covered by `worker-conac-sftp:104`                                                                                 | OK                                                                |
| `.env.example:453`                            | `COUR_DES_COMPTES_SFTP_HOST=PLACEHOLDER`                            | architect-must-set                        | covered by `worker-conac-sftp:104` (recipient_body=COUR_DES_COMPTES)                                               | OK                                                                |
| `.env.example:459`                            | `MINFI_SFTP_HOST=PLACEHOLDER`                                       | architect-must-set                        | covered by `worker-conac-sftp:104`                                                                                 | OK                                                                |
| `.env.example:465`                            | `ANIF_SFTP_HOST=PLACEHOLDER`                                        | architect-must-set                        | covered by `worker-conac-sftp:104`                                                                                 | OK                                                                |
| `.env.example:482`                            | `AUDIT_PUBLIC_EXPORT_SALT=PLACEHOLDER`                              | architect-must-set (Tier 1)               | `quarterly-audit-export.ts:80` refuses; `audit-log/public-view.ts:75` `hashPii` throws on PLACEHOLDER              | OK                                                                |
| `.env.example:509`                            | `ANTHROPIC_API_KEY=PLACEHOLDER`                                     | dev-default-acceptable (graceful degrade) | `worker-extractor/src/index.ts:255` runs in rule-only mode when PLACEHOLDER; other workers fail loudly when called | OK (degradation is acceptable)                                    |
| `infra/host-bootstrap/architect-pubkey.asc:2` | comment placeholder for the architect pubkey                        | architect-must-set                        | the host bootstrap script reads this file and refuses to proceed if it still contains the placeholder line         | OK                                                                |

---

## Gap to fix in B.2

**Single real gap:** `POLYGON_ANCHOR_CONTRACT` rejects null-address
but not the literal `PLACEHOLDER_DEPLOYED_AT_M1`. Today
`worker-anchor` would happily start with `contractAddress:
'PLACEHOLDER_DEPLOYED_AT_M1'`, queue audit-chain anchor commits,
and then fail at the `ethers.Contract(...)` interaction with a
cryptic ENS-resolution error instead of a clear refusal at boot.

**Fix.** Tighten the guard in
`apps/worker-anchor/src/index.ts` to reject any value that does not
match `/^0x[0-9a-fA-F]{40}$/` (the EVM 20-byte address shape). The
PLACEHOLDER literal fails the regex; null-address still fails;
typos fail. A test file pinning the contract pre-flight regression.

---

## Categorisation key (for future reviewers)

- **Tier 1 (Production-critical):** writes to public ledger, signs
  CONAC manifests, anchors audit chain, decrypts tips. PLACEHOLDER
  is a refuse-to-boot.
- **Tier 2 (Service degraded):** dashboard map, Anthropic LLM
  failover, NICFI satellite. PLACEHOLDER is a logged degradation.
- **Tier 3 (Phase-deferred):** PHASE-2/3 services not yet running.
  PLACEHOLDER tolerated until phase entry.
- **Institutional:** backup-architect identity. Set by ceremony,
  not boot gate.

The 2026-05-01 sweep finds **23 PLACEHOLDER occurrences** across
the audited paths; **22 are correctly handled** by existing guards
or category rules; **1 (POLYGON_ANCHOR_CONTRACT)** needs the
strengthened regex shipping in B.2.
