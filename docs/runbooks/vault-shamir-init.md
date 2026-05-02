# Vault Shamir Initialization Runbook

> One-time ceremony. Architect-driven. Resolves W-12 (Shamir storage on
> YubiKey PIV slot 9d via age-plugin-yubikey). Required before M0c per
> EXEC §43.2.

**Doctrine:** TRUTH §B (`Vault unseal: Shamir 3-of-5; shares stored via age-plugin-yubikey to PIV slot 9d`)

**Time required:** ~90 minutes total. Quiet room. Single architect + (if available) backup architect as witness.

**Outputs:** 5 sealed envelopes, each containing: 1 paper card with the encrypted share + 1 YubiKey provisioned for PIV slot 9d. Distributed per HSK §05.

---

## Pre-flight

- [ ] All 8 YubiKeys present, PIN-set, factory-reset (or freshly enrolled per HSK §05.2).
- [ ] `age` + `age-plugin-yubikey` v0.5+ installed on the architect workstation.
- [ ] Vault server reachable at `https://vault.vigilapex.cm:8200` and uninitialized:
  ```
  curl -sk https://vault.vigilapex.cm:8200/v1/sys/init | jq .initialized
  # → false
  ```
- [ ] Sealed-envelope kit + tamper-evident tape.
- [ ] [`infra/host-bootstrap/02-yubikey-enrol.sh`](../../infra/host-bootstrap/02-yubikey-enrol.sh) and [`03-vault-shamir-init.sh`](../../infra/host-bootstrap/03-vault-shamir-init.sh) checked out at the latest signed commit.
- [ ] Counter-signature notebook ready (architect logs each step + PIV slot 9d serial).

## Procedure

1. **Enrol each YubiKey for PIV slot 9d age identity.**
   For each of the 5 unseal-share keys, run:

   ```
   sudo bash infra/host-bootstrap/02-yubikey-enrol.sh \
     --serial <YUBIKEY_SERIAL> \
     --label "vigil-vault-shamir-share-N"
   ```

   Record the resulting age recipient (`age1yubikey1...`) string in the notebook.

2. **Initialize Vault** with 5 shares + 3 threshold, encrypting each share to one of the 5 age recipients:

   ```
   sudo bash infra/host-bootstrap/03-vault-shamir-init.sh \
     --recipient share1=age1yubikey1... \
     --recipient share2=age1yubikey1... \
     --recipient share3=age1yubikey1... \
     --recipient share4=age1yubikey1... \
     --recipient share5=age1yubikey1...
   ```

   The script:
   - Calls `POST /v1/sys/init` with `{"secret_shares":5,"secret_threshold":3}`.
   - Encrypts each returned share to the corresponding age recipient.
   - Prints the encrypted share to stdout.
   - Writes `/etc/vigil/vault-init.json` (root token + share metadata, no plaintext shares).

3. **For each share**, paste the encrypted age block into a paper card, seal in an envelope along with the matching YubiKey, label `Vigil Vault Share N — DO NOT OPEN UNDER NON-EMERGENCY`, sign across the seal.

4. **Distribute** per HSK §05.5:
   - Share 1 → architect's primary safe (Yaoundé)
   - Share 2 → architect's secondary safe (off-site, EU jurisdiction)
   - Share 3 → backup architect (W-17)
   - Share 4 → council pillar 1 (after enrollment)
   - Share 5 → safe-deposit box (off-jurisdiction; W-08, TRUTH §L Q5)

5. **Initial unseal test.** Use shares 1, 2, 3 (any quorum):

   ```
   for i in 1 2 3; do
     age --identity yubikey:share$i.identity -d share$i.encrypted | \
       vault operator unseal -
   done
   vault status   # Sealed: false
   ```

   Re-seal immediately:

   ```
   vault operator seal
   ```

   Confirm Vault is sealed again. Both unsealing AND re-sealing must succeed for the ceremony to be considered complete.

6. **Audit row.** Once Vault is unsealed and re-sealed, append a `vault.unsealed` + `vault.sealed` audit-of-audit pair to the chain via `audit-bridge`:

   ```
   curl --unix-socket /run/vigil/audit-bridge.sock http://localhost/append \
     -H 'content-type: application/json' \
     -d '{"action":"vault.unsealed","actor":"architect:junior","subject_kind":"system","subject_id":"vault","payload":{"ceremony":"shamir-init","shares":5,"threshold":3}}'
   curl --unix-socket /run/vigil/audit-bridge.sock http://localhost/append \
     -H 'content-type: application/json' \
     -d '{"action":"vault.sealed","actor":"architect:junior","subject_kind":"system","subject_id":"vault","payload":{"ceremony":"shamir-init"}}'
   ```

7. **Decision-log entry.** Open [docs/decisions/log.md](../decisions/log.md), append a `DECISION-013` entry recording:
   - Date + architect signature.
   - Each YubiKey serial → share-number mapping (PUBLIC information; no shares leaked).
   - The 5 distribution targets.
   - Ceremony-witness (backup architect, if present).

## Failure modes + rollback

| Failure                                                 | Action                                                                                                                                                                              |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vault operator init` returns 400 (already initialized) | Verify with `vault status`. If genuinely initialized in error, **do not re-init** — escalate to backup architect; treat as a security incident.                                     |
| YubiKey PIV slot 9d already populated                   | Run `ykman piv keys delete 9d --force` (only if architect confirms slot 9d is owned by VIGIL APEX); re-enrol via 02-yubikey-enrol.sh.                                               |
| age-plugin-yubikey not found                            | Install from `https://github.com/str4d/age-plugin-yubikey` v0.5+. Pin the version in `infra/host-bootstrap/00-prerequisites.sh`.                                                    |
| Test unseal fails ("invalid key share")                 | Decrypt one share at a time; verify each plaintext is exactly 33 bytes (32-byte share + 1-byte parity). If any share fails, ABORT — do not seal Vault yet; you have the root token. |

## Post-ceremony

- [ ] All 5 envelopes sealed + signed across the seal.
- [ ] Distribution log committed to the architect's notebook.
- [ ] Decision-log entry committed + signed.
- [ ] Audit row visible at `GET /api/audit/public?category=K&limit=10` showing `vault.unsealed` + `vault.sealed` events.
- [ ] Vault is sealed; no plaintext shares exist on any disk.

> **The architect is the ONLY person who has seen all 5 plaintext shares.**
> No agent, no Vault server, no backup process ever touches them. The
> architect must commit to memory: Vault root token (one-time recoverable
> from `/etc/vigil/vault-init.json`, then deleted), the 5 share encrypted
> blobs (recoverable from the YubiKeys), and the distribution map.

---

## Verification status (Block-D D.2 / 2026-05-01)

**Static walk only — end-to-end verification deferred to architect-driven M0c ceremony.**

The agent cannot run `vault operator init` against a dev Vault from
the sandbox (no Vault container reachable). The architect runs the
EE walk during M0c per EXEC §43.2.

### Drift identified between this runbook and the live script

This runbook (Procedure step 2 above) describes invoking
`infra/host-bootstrap/03-vault-shamir-init.sh` with `--recipient
share1=age1yubikey1...` flags. **The live script does NOT accept
those flags.** It takes no flags; it just runs `vault operator
init -key-shares=5 -key-threshold=3 -format=json`, writes the
plaintext shares to `/run/vigil/shamir/unseal-shares.json`, and
PRINTS manual `age -R yk01-recipient.txt < ...` commands for the
operator to run by hand.

This is real drift; the runbook prose is aspirational versus what
the script does. Two paths to resolve, **architect call**:

- **(A) Match runbook to script** — simpler. Rewrite Procedure
  step 2 to describe the manual-age-encrypt operator workflow the
  script actually requires. Operator runs the script, then runs
  the printed `age -R ...` commands themselves. Lower automation
  but the script is short and audit-friendly.

- **(B) Match script to runbook** — better operational ergonomics.
  Extend `03-vault-shamir-init.sh` to accept `--recipient
share<N>=<recipient>` flags + perform the age encryption
  in-script. Plaintext shares never touch disk (encrypted directly
  to recipient's age public key). Operator runs ONE command per
  share-encryption pair. Larger change; needs an updated test.

**Default (if unspecified):** the architect picks during M0c walk-
through; documenting the drift here is the agent's deliverable.

### Other static observations

- Procedure step 5 (initial unseal test) references
  `yubikey:share$i.identity` as an age identity scheme. Verify
  `age-plugin-yubikey` v0.5+ supports this exact syntax in the
  M0c environment (release notes; pin the version in
  `infra/host-bootstrap/00-prerequisites.sh` per the failure-mode
  table's third row).
- Procedure step 7 mentions appending DECISION-013 — that decision
  ID is already in use (Post-DECISION-012 work program closure +
  Anthropic SDK bump). The next free DECISION number at the time
  of M0c will be the architect's call.
- Procedure step 6 emits `vault.unsealed` + `vault.sealed`
  audit-of-audit rows. Verify these event-types are in
  `KNOWN_EVENT_TYPES` (`packages/shared/src/schemas/audit-log.ts`)
  before the ceremony so audit-bridge accepts them.

### Architect action

- [ ] EE walk against dev Vault in M0c week 1.
- [ ] Pick (A) or (B) for the script/runbook drift; agent ships
      the chosen delta in a follow-up commit.
- [ ] Confirm DECISION-NNN reservation for the ceremony.
- [ ] Confirm `vault.unsealed` / `vault.sealed` are in
      KNOWN_EVENT_TYPES (or add them).
