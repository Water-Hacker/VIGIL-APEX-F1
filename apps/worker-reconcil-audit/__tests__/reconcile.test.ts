import { describe, expect, it } from 'vitest';

import {
  computeReconciliationPlan,
  planSummary,
  type ReconciliationState,
} from '../src/reconcile.js';

function hash(n: number): string {
  return n.toString(16).padStart(64, '0');
}

const cleanState: ReconciliationState = {
  actions: [
    { seq: '1', body_hash: hash(1) },
    { seq: '2', body_hash: hash(2) },
    { seq: '3', body_hash: hash(3) },
  ],
  fabricWitnesses: [
    { seq: '1', body_hash: hash(1) },
    { seq: '2', body_hash: hash(2) },
    { seq: '3', body_hash: hash(3) },
  ],
  anchorCommitments: [
    { seq_from: '1', seq_to: '3', root_hash: hash(0xff), polygon_tx_hash: '0xabc' },
  ],
};

describe('computeReconciliationPlan (FIND-005)', () => {
  it('reports a fully reconciled chain as clean', () => {
    const plan = computeReconciliationPlan(cleanState);
    expect(plan.totalChecked).toBe(3);
    expect(plan.missingFromFabric).toEqual([]);
    expect(plan.missingFromPolygon).toEqual([]);
    expect(plan.divergent).toEqual([]);
    expect(planSummary(plan).clean).toBe(true);
  });

  it('flags Postgres rows missing from Fabric', () => {
    const state: ReconciliationState = {
      ...cleanState,
      fabricWitnesses: [
        { seq: '1', body_hash: hash(1) },
        // seq 2 missing
        { seq: '3', body_hash: hash(3) },
      ],
    };
    const plan = computeReconciliationPlan(state);
    expect(plan.missingFromFabric).toHaveLength(1);
    expect(plan.missingFromFabric[0]!.seq).toBe('2');
    expect(plan.missingFromFabric[0]!.body_hash).toBe(hash(2));
    expect(plan.divergent).toEqual([]);
  });

  it('flags hash divergence between Postgres and Fabric (non-recoverable)', () => {
    const state: ReconciliationState = {
      ...cleanState,
      fabricWitnesses: [
        { seq: '1', body_hash: hash(1) },
        { seq: '2', body_hash: hash(0xdead) }, // diverged
        { seq: '3', body_hash: hash(3) },
      ],
    };
    const plan = computeReconciliationPlan(state);
    expect(plan.divergent).toHaveLength(1);
    expect(plan.divergent[0]).toEqual({
      seq: '2',
      pgBodyHash: hash(2),
      fabricBodyHash: hash(0xdead),
    });
    expect(plan.missingFromFabric).toEqual([]);
  });

  it('flags Postgres rows outside any Polygon anchor commitment range', () => {
    const state: ReconciliationState = {
      ...cleanState,
      anchorCommitments: [
        { seq_from: '1', seq_to: '2', root_hash: hash(0xff), polygon_tx_hash: '0xabc' },
        // seq 3 NOT covered
      ],
    };
    const plan = computeReconciliationPlan(state);
    expect(plan.missingFromPolygon).toHaveLength(1);
    expect(plan.missingFromPolygon[0]!.seq).toBe('3');
  });

  it('treats single-row anchor commitments (high-sig fast-lane) as valid coverage', () => {
    const state: ReconciliationState = {
      ...cleanState,
      anchorCommitments: [
        { seq_from: '1', seq_to: '1', root_hash: hash(1), polygon_tx_hash: '0x01' },
        { seq_from: '2', seq_to: '2', root_hash: hash(2), polygon_tx_hash: '0x02' },
        { seq_from: '3', seq_to: '3', root_hash: hash(3), polygon_tx_hash: '0x03' },
      ],
    };
    const plan = computeReconciliationPlan(state);
    expect(plan.missingFromPolygon).toEqual([]);
  });

  it('handles all three failure modes simultaneously', () => {
    const state: ReconciliationState = {
      actions: [
        { seq: '1', body_hash: hash(1) }, // missing from Fabric AND Polygon
        { seq: '2', body_hash: hash(2) }, // diverged
        { seq: '3', body_hash: hash(3) }, // missing Polygon
      ],
      fabricWitnesses: [
        // seq 1 missing
        { seq: '2', body_hash: hash(0xbeef) }, // diverged
        { seq: '3', body_hash: hash(3) },
      ],
      anchorCommitments: [
        // none — nothing anchored
      ],
    };
    const plan = computeReconciliationPlan(state);
    expect(plan.missingFromFabric.map((m) => m.seq)).toEqual(['1']);
    expect(plan.divergent.map((d) => d.seq)).toEqual(['2']);
    expect(plan.missingFromPolygon.map((m) => m.seq)).toEqual(['1', '2', '3']);
    expect(planSummary(plan).clean).toBe(false);
  });

  it('handles 64-bit seq values without precision loss (BigInt path)', () => {
    const big = '9007199254740995'; // > Number.MAX_SAFE_INTEGER
    const state: ReconciliationState = {
      actions: [{ seq: big, body_hash: hash(1) }],
      fabricWitnesses: [{ seq: big, body_hash: hash(1) }],
      anchorCommitments: [
        {
          seq_from: '9007199254740990',
          seq_to: '9007199254741000',
          root_hash: hash(0xff),
          polygon_tx_hash: '0xabc',
        },
      ],
    };
    const plan = computeReconciliationPlan(state);
    expect(plan.missingFromPolygon).toEqual([]);
    expect(plan.missingFromFabric).toEqual([]);
  });

  it('handles upper-case hex inputs by normalising', () => {
    const upper = hash(2).toUpperCase();
    const state: ReconciliationState = {
      actions: [{ seq: '2', body_hash: upper }],
      fabricWitnesses: [{ seq: '2', body_hash: hash(2) }],
      anchorCommitments: [
        { seq_from: '2', seq_to: '2', root_hash: hash(2), polygon_tx_hash: '0xab' },
      ],
    };
    const plan = computeReconciliationPlan(state);
    expect(plan.divergent).toEqual([]); // case-insensitive match
  });
});
