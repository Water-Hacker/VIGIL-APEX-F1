# IR-04 — Council deadlock or quorum loss

**Severity:** warning. **Roles needed:** architect, all available
council members, civil-society pillar (lead).

A vote is open but cannot reach 3-of-5 because:
- 2 or more council members are unreachable (illness, travel, refusal)
- 2 members have already recused, leaving fewer than 3 active
- The vote window expires without a quorum

## Triage (24 h)
1. **Confirm quorum gap.** On-chain check:
   ```js
   await VIGILGovernance.activeMemberCount()  // should be ≥ 3
   ```
2. **Reach unreachable members.** Phone, Signal, in-person if local.
   Civil-society pillar typically has the broadest contact network.

## Containment
3. **Extend the vote window** if the gap is short-term:
   ```js
   await VIGILGovernance.extendVoteWindow(proposalIndex, 7 /* days */)
   ```
   The architect can extend up to 30 days total before EXEC §22.7
   requires escalation.

## Eradication

4. **Replace an inactive member.** If a member has missed ≥ 3
   consecutive votes, the architect proposes a replacement per
   EXEC §10.4 worksheet. The replacement is enrolled at the next
   YubiKey ceremony (`docs/source/HSK-v1.md` §07).

## Recovery

5. **Re-open the proposal** with the new member roster:
   ```js
   await VIGILGovernance.commitProposal(commitment)  // wait REVEAL_DELAY
   await VIGILGovernance.openProposal(findingHash, uri, salt)
   ```

## Special case: deliberate refusal

6. If a member refuses to vote (silent abstention) on multiple
   findings, the technical pillar opens a council-conduct review per
   EXEC §10.6. Persistent refusal is a removable offense.

## Postmortem

7. Open if deadlock blocks > 1 finding from escalation in a quarter.
   Include whether the 5-pillar structure is appropriate or needs
   reform (a Phase 2 governance change, signed by 4 of 5 council
   members + the architect).
