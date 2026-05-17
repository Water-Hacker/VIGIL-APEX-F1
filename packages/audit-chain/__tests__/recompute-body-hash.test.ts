/**
 * T5 of TODO.md sweep — locks the recompute-body-hash contract.
 *
 * The script is the truth-test invoked by docs/runbooks/audit-chain-divergence.md
 * step 3. We pin three behaviours so that future refactors of canonical.ts
 * (e.g. v2 with length-prefixed fields) MUST update this script in lockstep
 * or the test fires.
 */
import { describe, expect, it } from 'vitest';

import { bodyHash, rowHash } from '../src/canonical.js';
import {
  parseArgs,
  recomputeForRow,
  type AuditRowForRecompute,
} from '../src/scripts/recompute-body-hash.js';

const fixtureRow = (overrides: Partial<AuditRowForRecompute> = {}): AuditRowForRecompute => {
  // Merge overrides FIRST so the stored_body_hash we compute below uses the
  // same inputs the assertion will see. (Pre-fix, overrides happened after
  // hash computation, so passing stored_prev_hash to overrides produced a
  // row whose stored_body_hash was computed with null prev — guaranteed
  // mismatch.)
  const merged = {
    seq: 1,
    action: 'finding.escalated',
    actor: 'architect@vigilapex.cm',
    subject_kind: 'finding',
    subject_id: '00000000-0000-0000-0000-000000000001',
    occurred_at: '2026-04-28T12:00:00.000Z',
    payload: { amount_xaf: 5_000_000, region: 'CE' } as Record<string, unknown>,
    stored_prev_hash: null as string | null,
    ...overrides,
  };
  const eventForHash = {
    seq: merged.seq,
    action: merged.action as never,
    actor: merged.actor,
    subject_kind: merged.subject_kind as never,
    subject_id: merged.subject_id,
    occurred_at: merged.occurred_at,
    payload: merged.payload,
  };
  const storedBody =
    overrides.stored_body_hash ?? rowHash(merged.stored_prev_hash, bodyHash(eventForHash));
  return { ...merged, stored_body_hash: storedBody };
};

describe('recomputeForRow — happy path', () => {
  it('returns match=true when stored_body_hash equals the canonical recompute', () => {
    const row = fixtureRow();
    const r = recomputeForRow(row);
    expect(r.match).toBe(true);
    expect(r.recomputed).toBe(row.stored_body_hash.toLowerCase());
    expect(r.seq).toBe(1);
  });

  it('chains via stored_prev_hash when present (rowHash(prev, body))', () => {
    const row1 = fixtureRow({ seq: 1 });
    const prevHashHex = row1.stored_body_hash;
    const row2 = fixtureRow({ seq: 2, stored_prev_hash: prevHashHex });
    expect(recomputeForRow(row2).match).toBe(true);
  });
});

describe('recomputeForRow — tamper detection', () => {
  it('detects a flipped payload byte (the canonical use case in mode-3.4)', () => {
    const row = fixtureRow();
    const tampered = {
      ...row,
      payload: { ...row.payload, amount_xaf: 5_000_001 },
    };
    const r = recomputeForRow(tampered);
    expect(r.match).toBe(false);
    expect(r.recomputed).not.toBe(row.stored_body_hash.toLowerCase());
  });

  it('detects a forged prev_hash (chain-break attempt)', () => {
    const row = fixtureRow();
    const tampered = { ...row, stored_prev_hash: 'f'.repeat(64) };
    expect(recomputeForRow(tampered).match).toBe(false);
  });

  it('detects an altered actor string', () => {
    const row = fixtureRow();
    expect(recomputeForRow({ ...row, actor: 'someone-else' }).match).toBe(false);
  });

  it('returns lowercase-hex hashes regardless of stored capitalisation', () => {
    const row = fixtureRow();
    const upper = { ...row, stored_body_hash: row.stored_body_hash.toUpperCase() };
    // The script normalises both sides to lowercase, so the comparison still
    // says match=true — operators don't see false alarms from cosmetic
    // hex-case differences emitted by a manual export.
    const r = recomputeForRow(upper);
    expect(r.match).toBe(true);
    expect(r.stored).toBe(row.stored_body_hash.toLowerCase());
  });
});

describe('parseArgs — CLI contract for the runbook invocation', () => {
  it('--seq N expands to { from: N, to: N }', () => {
    expect(parseArgs(['--seq', '1234'])).toEqual({ from: 1234, to: 1234 });
  });

  it('--from N --to M parses to a range', () => {
    expect(parseArgs(['--from', '10', '--to', '20'])).toEqual({ from: 10, to: 20 });
  });

  it('--from with no --to defaults to single-seq', () => {
    expect(parseArgs(['--from', '7'])).toEqual({ from: 7, to: 7 });
  });

  it('rejects --seq with a non-positive integer', () => {
    expect(() => parseArgs(['--seq', '0'])).toThrow(/positive integer/);
    expect(() => parseArgs(['--seq', '-1'])).toThrow(/positive integer/);
    expect(() => parseArgs(['--seq', 'abc'])).toThrow(/positive integer/);
  });

  it('rejects --to < --from (operator typo)', () => {
    expect(() => parseArgs(['--from', '20', '--to', '10'])).toThrow(/--to must be >= --from/);
  });

  it('rejects missing --seq and --from', () => {
    expect(() => parseArgs([])).toThrow(/missing --seq or --from/);
  });

  it('--help throws USAGE sentinel (handled in cliMain to print --help text)', () => {
    expect(() => parseArgs(['--help'])).toThrow(/USAGE/);
  });
});
