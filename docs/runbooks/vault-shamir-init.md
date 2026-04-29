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
