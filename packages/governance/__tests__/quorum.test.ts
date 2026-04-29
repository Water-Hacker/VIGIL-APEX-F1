import { describe, expect, it } from 'vitest';

import {
  decisionFor,
  publicReleaseDecision,
  totalNonRecuseVoters,
  assertCannotDoubleVote,
} from '../src/quorum.js';

const open = (yes: number, no: number, abstain = 0, recuse = 0) => ({
  yes,
  no,
  abstain,
  recuse,
});

describe('decisionFor', () => {
  it('3-of-5 YES escalates regardless of NO/ABSTAIN', () => {
    expect(decisionFor(open(3, 0), false)).toBe('escalate');
    expect(decisionFor(open(3, 1), false)).toBe('escalate');
    expect(decisionFor(open(3, 2), false)).toBe('escalate');
  });

  it('3-of-5 NO dismisses', () => {
    expect(decisionFor(open(0, 3), false)).toBe('dismiss');
    expect(decisionFor(open(1, 3), false)).toBe('dismiss');
  });

  it('1-of-5 YES leaves the proposal open until expiry', () => {
    expect(decisionFor(open(1, 0), false)).toBe('open');
    expect(decisionFor(open(2, 2), false)).toBe('open');
  });

  it('expiry without quorum collapses to inconclusive', () => {
    expect(decisionFor(open(0, 0, 0, 5), true)).toBe('expired');
    expect(decisionFor(open(2, 1, 1, 0), true)).toBe('expired');
  });

  it('YES quorum overrides expired flag', () => {
    expect(decisionFor(open(3, 0), true)).toBe('escalate');
  });
});

describe('publicReleaseDecision', () => {
  it('requires 4-of-5 YES for public release', () => {
    expect(publicReleaseDecision(open(3, 0))).toBe('open');
    expect(publicReleaseDecision(open(4, 0))).toBe('escalate');
    expect(publicReleaseDecision(open(4, 1))).toBe('escalate');
  });

  it('still dismisses on 3-of-5 NO', () => {
    expect(publicReleaseDecision(open(0, 3))).toBe('dismiss');
  });
});

describe('totalNonRecuseVoters', () => {
  it('sums YES + NO + ABSTAIN, excludes RECUSE', () => {
    expect(totalNonRecuseVoters(open(2, 1, 1, 1))).toBe(4);
    expect(totalNonRecuseVoters(open(0, 0, 0, 5))).toBe(0);
  });
});

describe('assertCannotDoubleVote', () => {
  it('passes for zero or one prior choice', () => {
    expect(() => assertCannotDoubleVote([])).not.toThrow();
    expect(() => assertCannotDoubleVote(['YES'])).not.toThrow();
  });
  it('throws for two or more prior choices', () => {
    expect(() => assertCannotDoubleVote(['YES', 'NO'])).toThrow(/double/i);
  });
});
