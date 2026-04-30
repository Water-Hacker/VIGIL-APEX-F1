/**
 * AUDIT-061 — boundary, tie-break, and constants-integrity coverage for the
 * quorum module. Existing quorum.test.ts + vote-ceremony.test.ts cover the
 * happy paths; this file pins the edge cases that a future regression in
 * @vigil/shared/Constants or in quorum.ts would otherwise silently break.
 *
 * Behaviour facts asserted here (so a reviewer of a quorum.ts change can
 * grep this file before merging):
 *
 *   1. The off-chain mirror reads QUORUM_REQUIRED_ESCALATE and
 *      QUORUM_REQUIRED_PUBLIC_RELEASE from Constants. If those drift away
 *      from 3 and 4, the council vote semantics change silently. We pin
 *      the literal values here so a Constants edit forces a code-review of
 *      this file.
 *   2. decisionFor checks YES before NO, so a tied 3-YES / 3-NO ballot
 *      (impossible with 5 members but possible with future expansion to a
 *      larger council) escalates rather than dismisses.
 *   3. An all-recuse ballot is 'open' until isExpired flips to true.
 *   4. publicReleaseDecision is intentionally asymmetric with decisionFor:
 *      it ignores expiry. A public-release proposal cannot 'expire'; it
 *      sits open until the council reaches the higher 4-of-5 bar. This is
 *      the design (SRD §17.2 / EXEC §17.2): public release is a separate
 *      deliberation that follows escalation, not the same clock.
 */
import { Constants, Errors } from '@vigil/shared';
import { describe, expect, it } from 'vitest';

import {
  assertCannotDoubleVote,
  decisionFor,
  publicReleaseDecision,
  totalNonRecuseVoters,
  type VoteTally,
} from '../src/quorum.js';

const tally = (yes: number, no: number, abstain = 0, recuse = 0): VoteTally => ({
  yes,
  no,
  abstain,
  recuse,
});

describe('AUDIT-061 — Constants integrity', () => {
  it('QUORUM_REQUIRED_ESCALATE is pinned to 3 (3-of-5 council)', () => {
    expect(Constants.QUORUM_REQUIRED_ESCALATE).toBe(3);
  });

  it('QUORUM_REQUIRED_PUBLIC_RELEASE is pinned to 4 (4-of-5 super-majority)', () => {
    expect(Constants.QUORUM_REQUIRED_PUBLIC_RELEASE).toBe(4);
  });

  it('public-release bar is strictly higher than escalation bar', () => {
    expect(Constants.QUORUM_REQUIRED_PUBLIC_RELEASE).toBeGreaterThan(
      Constants.QUORUM_REQUIRED_ESCALATE,
    );
  });
});

describe('AUDIT-061 — decisionFor boundary conditions', () => {
  it('exactly QUORUM-1 YES does NOT escalate', () => {
    expect(decisionFor(tally(Constants.QUORUM_REQUIRED_ESCALATE - 1, 0), false)).toBe('open');
  });

  it('exactly QUORUM YES escalates (>= comparison, not >)', () => {
    expect(decisionFor(tally(Constants.QUORUM_REQUIRED_ESCALATE, 0), false)).toBe('escalate');
  });

  it('exactly QUORUM-1 NO does NOT dismiss', () => {
    expect(decisionFor(tally(0, Constants.QUORUM_REQUIRED_ESCALATE - 1), false)).toBe('open');
  });

  it('exactly QUORUM NO dismisses (>= comparison, not >)', () => {
    expect(decisionFor(tally(0, Constants.QUORUM_REQUIRED_ESCALATE), false)).toBe('dismiss');
  });
});

describe('AUDIT-061 — decisionFor tie-break', () => {
  it('a tied YES/NO at quorum escalates (YES is checked first)', () => {
    // Impossible with 5 voters, but future councils may be 7 or 9; pin
    // the precedence so the rule is documented in test form.
    expect(
      decisionFor(
        tally(Constants.QUORUM_REQUIRED_ESCALATE, Constants.QUORUM_REQUIRED_ESCALATE),
        false,
      ),
    ).toBe('escalate');
  });

  it('YES quorum overrides isExpired even when NO also reached quorum', () => {
    expect(
      decisionFor(
        tally(Constants.QUORUM_REQUIRED_ESCALATE, Constants.QUORUM_REQUIRED_ESCALATE),
        true,
      ),
    ).toBe('escalate');
  });
});

describe('AUDIT-061 — decisionFor all-recuse and zero-vote', () => {
  it('a fully recused council with no expiry is open', () => {
    expect(decisionFor(tally(0, 0, 0, 5), false)).toBe('open');
  });

  it('a fully recused council past expiry is expired', () => {
    expect(decisionFor(tally(0, 0, 0, 5), true)).toBe('expired');
  });

  it('zero votes pre-expiry is open', () => {
    expect(decisionFor(tally(0, 0, 0, 0), false)).toBe('open');
  });

  it('zero votes post-expiry is expired', () => {
    expect(decisionFor(tally(0, 0, 0, 0), true)).toBe('expired');
  });
});

describe('AUDIT-061 — publicReleaseDecision asymmetry', () => {
  it('public release at QUORUM_RELEASE-1 YES does NOT escalate', () => {
    expect(publicReleaseDecision(tally(Constants.QUORUM_REQUIRED_PUBLIC_RELEASE - 1, 0))).toBe(
      'open',
    );
  });

  it('public release at QUORUM_RELEASE YES escalates', () => {
    expect(publicReleaseDecision(tally(Constants.QUORUM_REQUIRED_PUBLIC_RELEASE, 0))).toBe(
      'escalate',
    );
  });

  it('public release dismisses at the lower NO threshold (QUORUM_ESCALATE NO)', () => {
    expect(publicReleaseDecision(tally(0, Constants.QUORUM_REQUIRED_ESCALATE))).toBe('dismiss');
  });

  it('public release ignores expiry by design (SRD §17.2)', () => {
    // Even for an "expired" proposal in the wider sense, public release
    // semantics return 'open' rather than 'expired' — the function does
    // not accept an isExpired param, on purpose.
    expect(publicReleaseDecision(tally(0, 0, 0, 5))).toBe('open');
    expect(publicReleaseDecision(tally(2, 1, 1, 1))).toBe('open');
  });
});

describe('AUDIT-061 — totalNonRecuseVoters invariants', () => {
  it('returns 0 when every member recused', () => {
    expect(totalNonRecuseVoters(tally(0, 0, 0, 5))).toBe(0);
  });

  it('equals the sum of YES + NO + ABSTAIN exactly (no off-by-one)', () => {
    for (let yes = 0; yes <= 5; yes++) {
      for (let no = 0; no <= 5 - yes; no++) {
        for (let abs = 0; abs <= 5 - yes - no; abs++) {
          const recuse = 5 - yes - no - abs;
          expect(totalNonRecuseVoters(tally(yes, no, abs, recuse))).toBe(yes + no + abs);
        }
      }
    }
  });
});

describe('AUDIT-061 — assertCannotDoubleVote regression cases', () => {
  it('throws GovernanceError typed instance, not a generic Error', () => {
    let caught: unknown;
    try {
      assertCannotDoubleVote(['YES', 'NO']);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Errors.GovernanceError);
    expect((caught as { code?: string }).code).toBe('GOVERNANCE_DOUBLE_VOTE');
  });

  it('error message includes the vote count for forensic logs', () => {
    expect(() => assertCannotDoubleVote(['YES', 'NO', 'ABSTAIN'])).toThrow(/voter cast 3 votes/);
  });

  it('three or more votes throw (no off-by-one above 2)', () => {
    expect(() => assertCannotDoubleVote(['YES', 'NO', 'ABSTAIN'])).toThrow();
    expect(() => assertCannotDoubleVote(['YES', 'NO', 'ABSTAIN', 'RECUSE', 'YES'])).toThrow();
  });
});
