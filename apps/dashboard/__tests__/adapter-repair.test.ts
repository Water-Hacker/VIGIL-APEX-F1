/**
 * AUDIT-006 — adapter-repair `decideProposal` must run inside a single
 * transaction with row-count validation.
 *
 * Pre-fix: two raw `db.execute` calls, no transaction, no rowCount check.
 * If the proposal id was stale or already-decided, the first UPDATE
 * affected zero rows but `decideProposal` returned successfully and the
 * (promoted) selector-registry UPDATE STILL fired — promoting a
 * non-existent or already-rejected proposal to live.
 *
 * Fix: wrap both UPDATEs in `db.transaction(...)`; the proposal UPDATE
 * uses `RETURNING id`; if zero rows came back, throw a typed
 * `ProposalNotEligibleError` (rolling back the transaction so the
 * selector registry never gets touched).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const proposalUpdateMock = vi.fn();
const registryUpdateMock = vi.fn();
const transactionMock = vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
  const tx = {
    execute: vi.fn().mockImplementation((q: unknown) => {
      const sqlText =
        typeof q === 'object' && q !== null && 'queryChunks' in q
          ? JSON.stringify((q as { queryChunks: unknown[] }).queryChunks)
          : String(q);
      if (sqlText.includes('adapter_selector_registry')) {
        return registryUpdateMock();
      }
      return proposalUpdateMock();
    }),
  };
  return cb(tx);
});

const SINGLETON_DB = {
  execute: vi.fn(),
  transaction: transactionMock,
};

vi.mock('server-only', () => ({}));

vi.mock('@vigil/db-postgres', () => ({
  getDb: vi.fn(async () => SINGLETON_DB),
}));

beforeEach(() => {
  proposalUpdateMock.mockReset();
  registryUpdateMock.mockReset();
  transactionMock.mockClear();
  // Default: proposal UPDATE matches 1 row
  proposalUpdateMock.mockResolvedValue({
    rows: [{ id: '11111111-1111-1111-1111-111111111111' }],
    rowCount: 1,
  });
  registryUpdateMock.mockResolvedValue({ rows: [], rowCount: 1 });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AUDIT-006 — decideProposal runs inside db.transaction', () => {
  it('opens a transaction (db.transaction is called)', async () => {
    const { decideProposal } = await import('../src/lib/adapter-repair.server');
    await decideProposal('11111111-1111-1111-1111-111111111111', 'promoted', 'op1', 'reason');
    expect(transactionMock).toHaveBeenCalledTimes(1);
  });

  it('rejected: only the proposal UPDATE fires (registry UPDATE is skipped)', async () => {
    const { decideProposal } = await import('../src/lib/adapter-repair.server');
    await decideProposal('11111111-1111-1111-1111-111111111111', 'rejected', 'op1');
    expect(proposalUpdateMock).toHaveBeenCalledTimes(1);
    expect(registryUpdateMock).not.toHaveBeenCalled();
  });

  it('promoted: both UPDATEs fire inside the same transaction', async () => {
    const { decideProposal } = await import('../src/lib/adapter-repair.server');
    await decideProposal('11111111-1111-1111-1111-111111111111', 'promoted', 'op1');
    expect(proposalUpdateMock).toHaveBeenCalledTimes(1);
    expect(registryUpdateMock).toHaveBeenCalledTimes(1);
  });
});

describe('AUDIT-006 — decideProposal validates row count', () => {
  it('throws ProposalNotEligibleError when the proposal UPDATE matches zero rows', async () => {
    proposalUpdateMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const mod = await import('../src/lib/adapter-repair.server');
    const { decideProposal, ProposalNotEligibleError } = mod as unknown as {
      decideProposal: (
        id: string,
        decision: 'promoted' | 'rejected',
        decidedBy: string,
        reason?: string,
      ) => Promise<void>;
      ProposalNotEligibleError: new (...args: never[]) => Error;
    };
    expect(typeof ProposalNotEligibleError).toBe('function');
    let caught: unknown;
    try {
      await decideProposal('00000000-0000-0000-0000-000000000000', 'promoted', 'op1');
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ProposalNotEligibleError);
    expect((caught as { name?: string }).name).toBe('ProposalNotEligibleError');
  });

  it('zero-row proposal UPDATE prevents the registry UPDATE from firing', async () => {
    proposalUpdateMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const { decideProposal } = await import('../src/lib/adapter-repair.server');
    await expect(
      decideProposal('00000000-0000-0000-0000-000000000000', 'promoted', 'op1'),
    ).rejects.toThrow(/ProposalNotEligibleError|not eligible|status/i);
    expect(registryUpdateMock).not.toHaveBeenCalled();
  });
});
