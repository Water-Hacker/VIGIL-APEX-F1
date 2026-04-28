# IR-05 — Architect incapacitated

**Severity:** critical. **Roles needed:** backup architect, lawyer
(per EXEC §34.5 envelope), 3 of 5 council members.

The architect is unreachable for > 7 days, deceased, detained, or has
formally resigned and the system is not yet in Phase 2 multi-region
operation. Per EXEC §34 and §35, the system MUST continue operating
under the council's stewardship; this playbook is the executor.

## Day 0 — Recognition

1. **Confirm incapacity.** Three independent signals:
   - No commits, no Vault audit-log entry from the architect's
     identity for > 7 days
   - No response to lawyer's confidential channel
   - No response to council civil-society pillar's emergency contact

2. **Lawyer opens the unsealed envelope** held per EXEC §34.5.
   Contents: instructions for backup-architect handover, jurisdictional
   contacts, list of physical locations of cold-storage YubiKey copies
   and Shamir shares.

## Day 0–1 — Stabilise

3. **Backup architect signs the handover** affidavit (template in the
   envelope). The 3-of-5 council quorum acknowledges the handover
   on-chain via:
   ```js
   await VIGILGovernance.acknowledgeArchitectHandover(
     newArchitectAddress, handoverDigest
   )
   ```
4. **Re-mint Vault credentials.** Backup architect's YubiKey assumes
   the architect Vault policy:
   ```sh
   sudo /usr/local/bin/vigil-vault-unseal --interactive
   sudo /usr/local/bin/vigil-key-rotation architect-handover
   ```

## Day 1–7 — Continuity

5. **Resume normal operations** under the backup architect. Adapter
   runs, pattern detection, council voting all continue. The CONAC
   delivery pipeline is paused 24 h while the GPG-signing identity
   updates from architect → backup-architect (worker-dossier reads
   `GPG_FINGERPRINT` from env; rotate the secret).

6. **Communicate with the Republic.** Letter under backup-architect's
   signature to CONAC + MINFI per the v5.1 commercial agreement
   §11. Template in `docs/communiques/architect-handover-template.md`.

## Day 7+ — Phase 2 acceleration

7. **Decide whether to accelerate Phase 2** (multi-region, 10 nodes
   per ROADMAP). Council vote at the next regular session. If
   accelerated, the F11 multi-region failover script runs against
   the Hetzner replica.

## Worst case — total loss of architect AND backup architect

8. **Council assumes the architect role** by 4-of-5 vote
   (`VIGILGovernance.acceptArchitectRoleAsCouncil`). The system
   continues under collective stewardship. v5.1 commercial agreement
   §13 specifies this contingency.

## What this playbook is NOT

- Not for routine vacation. The architect rotates duties to the
  backup architect by writing a `architect_oot_until` row in
  `audit.actions` before departure (EXEC §34.2).
- Not for "the architect won't take a meeting" — that's a council
  matter, not an incapacity.
