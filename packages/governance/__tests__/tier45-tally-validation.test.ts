/**
 * Tier-45 audit closure — tally shape validation in the off-chain
 * quorum mirror.
 *
 * The mirror is the dashboard's prediction layer; the contract is the
 * source of truth. Pre-fix, `decisionFor` and `publicReleaseDecision`
 * accepted any input shape — including NaN, Infinity, negative, and
 * non-integer vote counts — and silently returned a wrong-but-
 * plausible Decision. Specifically:
 *
 *   - `yes: NaN` → `NaN >= 3` is `false`, so the YES branch is skipped;
 *     the NO branch may also skip; result falls through to 'open'.
 *     The operator's dashboard then renders "no decision yet" on a
 *     vote that may already have escalated on-chain.
 *
 *   - `yes: -1` → similarly false on the gate; same silent fall-through.
 *
 *   - `yes: 3.5` (fractional, from a bad indexer cast) → passes the
 *     `>= 3` gate AND returns 'escalate', but the projection is
 *     structurally broken upstream and should be surfaced.
 *
 * Post-fix, both functions throw `GovernanceError(GOVERNANCE_TALLY_MALFORMED)`
 * with the offending field name in `context`, so an operator routing on
 * `err.code` can page the indexer maintainer instead of acting on a
 * misleading prediction.
 *
 * What we deliberately DO NOT validate: the total of yes+no+abstain+
 * recuse against QUORUM_SIZE. The existing quorum-edge-cases tests
 * pin precedence rules using ties that are impossible with 5 members
 * but documented for a future 7- or 9-member council. Pinning the
 * total would over-couple to today's size.
 */
import { Errors } from '@vigil/shared';
import { describe, expect, it } from 'vitest';

import { decisionFor, publicReleaseDecision, type VoteTally } from '../src/quorum.js';

const mk = (overrides: Partial<VoteTally>): VoteTally => ({
  yes: 0,
  no: 0,
  abstain: 0,
  recuse: 0,
  ...overrides,
});

describe('Tier-45 — decisionFor rejects structurally malformed tally', () => {
  const INVALID: ReadonlyArray<{ field: keyof VoteTally; value: number; label: string }> = [
    { field: 'yes', value: Number.NaN, label: 'yes=NaN' },
    { field: 'no', value: Number.NaN, label: 'no=NaN' },
    { field: 'yes', value: Number.POSITIVE_INFINITY, label: 'yes=Infinity' },
    { field: 'no', value: Number.NEGATIVE_INFINITY, label: 'no=-Infinity' },
    { field: 'yes', value: -1, label: 'yes=-1' },
    { field: 'no', value: -5, label: 'no=-5' },
    { field: 'yes', value: 3.5, label: 'yes=3.5 (fractional)' },
    { field: 'abstain', value: 0.1, label: 'abstain=0.1 (fractional)' },
    { field: 'recuse', value: -0.5, label: 'recuse=-0.5 (fractional negative)' },
  ];

  for (const { field, value, label } of INVALID) {
    it(`rejects ${label} with GOVERNANCE_TALLY_MALFORMED`, () => {
      let caught: unknown;
      try {
        decisionFor(mk({ [field]: value }), false);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(Errors.GovernanceError);
      const err = caught as { code?: string; context?: { field?: string; value?: number } };
      expect(err.code).toBe('GOVERNANCE_TALLY_MALFORMED');
      expect(err.context?.field).toBe(field);
      // Note: Number.isNaN(NaN) is true but NaN !== NaN, so we can't
      // round-trip an exact-equality assertion on a NaN context value.
      // Just assert the field name was captured.
    });
  }

  it('rejects an all-NaN tally and surfaces the FIRST malformed field (yes)', () => {
    let caught: unknown;
    try {
      decisionFor(
        { yes: Number.NaN, no: Number.NaN, abstain: Number.NaN, recuse: Number.NaN },
        false,
      );
    } catch (e) {
      caught = e;
    }
    const err = caught as { context?: { field?: string } };
    expect(err.context?.field).toBe('yes');
  });

  it('still accepts well-formed counts that match existing precedence semantics', () => {
    expect(decisionFor(mk({ yes: 3 }), false)).toBe('escalate');
    expect(decisionFor(mk({ no: 3 }), false)).toBe('dismiss');
    expect(decisionFor(mk({ yes: 2, no: 2 }), false)).toBe('open');
    expect(decisionFor(mk({ yes: 0, no: 0 }), true)).toBe('expired');
  });
});

describe('Tier-45 — publicReleaseDecision shares the same validation', () => {
  it('rejects yes=NaN with GOVERNANCE_TALLY_MALFORMED', () => {
    let caught: unknown;
    try {
      publicReleaseDecision(mk({ yes: Number.NaN }));
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Errors.GovernanceError);
    expect((caught as { code?: string }).code).toBe('GOVERNANCE_TALLY_MALFORMED');
  });

  it('still escalates at the 4-of-5 supermajority bar', () => {
    expect(publicReleaseDecision(mk({ yes: 4 }))).toBe('escalate');
    expect(publicReleaseDecision(mk({ yes: 3 }))).toBe('open');
  });

  it('still dismisses at the lower NO bar (3)', () => {
    expect(publicReleaseDecision(mk({ no: 3 }))).toBe('dismiss');
  });
});
