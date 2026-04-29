/**
 * Council vote ceremony — end-to-end exercise (D1 in the work program).
 *
 * Simulates the canonical SRD §23 / DECISION-008 flow:
 *
 *   1. proposal.opened by an operator
 *   2. five council members each cast exactly one signed vote
 *   3. quorum logic resolves 3-of-5 YES → escalate
 *   4. attempting to re-vote throws GOVERNANCE_DOUBLE_VOTE
 *   5. recused members do not count toward the affirmative quorum
 *   6. expiry without quorum → 'expired' (no decision)
 *
 * The on-chain side is exercised separately (contracts/test); this test
 * covers the off-chain quorum mirror + the assert-double-vote contract
 * the dashboard uses for fast feedback.
 */
import { describe, expect, it } from 'vitest';

import {
  assertCannotDoubleVote,
  decisionFor,
  publicReleaseDecision,
  totalNonRecuseVoters,
} from '../src/quorum.js';

type Choice = 'YES' | 'NO' | 'ABSTAIN' | 'RECUSE';

interface Vote {
  member: string;
  choice: Choice;
}

function tally(votes: ReadonlyArray<Vote>) {
  return {
    yes: votes.filter((v) => v.choice === 'YES').length,
    no: votes.filter((v) => v.choice === 'NO').length,
    abstain: votes.filter((v) => v.choice === 'ABSTAIN').length,
    recuse: votes.filter((v) => v.choice === 'RECUSE').length,
  };
}

describe('council vote ceremony — end-to-end', () => {
  it('3-of-5 YES escalates the proposal', () => {
    const votes: Vote[] = [
      { member: 'governance', choice: 'YES' },
      { member: 'judicial', choice: 'YES' },
      { member: 'civil-society', choice: 'YES' },
      { member: 'audit', choice: 'NO' },
      { member: 'technical', choice: 'ABSTAIN' },
    ];
    expect(decisionFor(tally(votes), false)).toBe('escalate');
    expect(totalNonRecuseVoters(tally(votes))).toBe(5);
  });

  it('3-of-5 NO dismisses the proposal', () => {
    const votes: Vote[] = [
      { member: 'governance', choice: 'NO' },
      { member: 'judicial', choice: 'NO' },
      { member: 'civil-society', choice: 'YES' },
      { member: 'audit', choice: 'NO' },
      { member: 'technical', choice: 'ABSTAIN' },
    ];
    expect(decisionFor(tally(votes), false)).toBe('dismiss');
  });

  it('public release requires 4-of-5 YES (escalation alone is insufficient)', () => {
    const escalateOnly: Vote[] = [
      { member: 'governance', choice: 'YES' },
      { member: 'judicial', choice: 'YES' },
      { member: 'civil-society', choice: 'YES' },
      { member: 'audit', choice: 'NO' },
      { member: 'technical', choice: 'ABSTAIN' },
    ];
    expect(decisionFor(tally(escalateOnly), false)).toBe('escalate');
    expect(publicReleaseDecision(tally(escalateOnly))).toBe('open');

    const publicRelease: Vote[] = [
      { member: 'governance', choice: 'YES' },
      { member: 'judicial', choice: 'YES' },
      { member: 'civil-society', choice: 'YES' },
      { member: 'audit', choice: 'YES' },
      { member: 'technical', choice: 'NO' },
    ];
    expect(publicReleaseDecision(tally(publicRelease))).toBe('escalate');
  });

  it('recused members are excluded from the active vote count', () => {
    const votes: Vote[] = [
      { member: 'governance', choice: 'YES' },
      { member: 'judicial', choice: 'YES' },
      { member: 'civil-society', choice: 'RECUSE' },
      { member: 'audit', choice: 'YES' },
      { member: 'technical', choice: 'NO' },
    ];
    const t = tally(votes);
    expect(t.recuse).toBe(1);
    expect(totalNonRecuseVoters(t)).toBe(4);
    // Still 3 YES → still escalates (recusal doesn't block escalation).
    expect(decisionFor(t, false)).toBe('escalate');
  });

  it('a single member voting twice triggers GOVERNANCE_DOUBLE_VOTE', () => {
    expect(() => assertCannotDoubleVote(['YES', 'NO'])).toThrow(/voter cast 2 votes/);
    expect(() => assertCannotDoubleVote(['YES', 'YES'])).toThrow(/voter cast 2 votes/);
    expect(() => assertCannotDoubleVote(['ABSTAIN', 'RECUSE'])).toThrow(/voter cast 2 votes/);
  });

  it('a single vote per member passes the assertion', () => {
    expect(() => assertCannotDoubleVote([])).not.toThrow();
    expect(() => assertCannotDoubleVote(['YES'])).not.toThrow();
    expect(() => assertCannotDoubleVote(['NO'])).not.toThrow();
    expect(() => assertCannotDoubleVote(['ABSTAIN'])).not.toThrow();
    expect(() => assertCannotDoubleVote(['RECUSE'])).not.toThrow();
  });

  it('expiry without quorum produces a decision of expired', () => {
    const tooFew: Vote[] = [
      { member: 'governance', choice: 'YES' },
      { member: 'judicial', choice: 'NO' },
    ];
    expect(decisionFor(tally(tooFew), true)).toBe('expired');
  });

  it('5-of-5 YES escalates and unlocks public release', () => {
    const votes: Vote[] = [
      { member: 'governance', choice: 'YES' },
      { member: 'judicial', choice: 'YES' },
      { member: 'civil-society', choice: 'YES' },
      { member: 'audit', choice: 'YES' },
      { member: 'technical', choice: 'YES' },
    ];
    expect(decisionFor(tally(votes), false)).toBe('escalate');
    expect(publicReleaseDecision(tally(votes))).toBe('escalate');
  });

  it('order of votes does not affect the decision', () => {
    const ordered: Vote[] = [
      { member: 'a', choice: 'YES' },
      { member: 'b', choice: 'YES' },
      { member: 'c', choice: 'YES' },
      { member: 'd', choice: 'NO' },
      { member: 'e', choice: 'ABSTAIN' },
    ];
    const reversed = [...ordered].reverse();
    expect(decisionFor(tally(ordered), false)).toBe(decisionFor(tally(reversed), false));
  });
});
