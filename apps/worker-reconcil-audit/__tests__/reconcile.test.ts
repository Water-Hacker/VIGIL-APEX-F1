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

  // ---- Tier-19 audit closure: NULL/empty polygon_tx_hash filter ----
  //
  // Before T19: a commitment row with `polygon_tx_hash IS NULL` (i.e.
  // worker-anchor created the row but never finished broadcasting to
  // Polygon) silently counted as "covered". A wedged anchor worker
  // could leave thousands of unanchored seqs while the reconciler
  // reported `missing_polygon: 0`. T19 filters commitments to only
  // those with a non-null tx hash.

  it('treats commitment with NULL polygon_tx_hash as NOT covering its range', () => {
    const state: ReconciliationState = {
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
        // Pending commitment — created but never broadcast.
        { seq_from: '1', seq_to: '3', root_hash: hash(0xff), polygon_tx_hash: null },
      ],
    };
    const plan = computeReconciliationPlan(state);
    expect(plan.missingFromPolygon.map((m) => m.seq)).toEqual(['1', '2', '3']);
    expect(planSummary(plan).clean).toBe(false);
  });

  it('treats commitment with empty-string polygon_tx_hash as NOT covering', () => {
    // Defensive: the DB column is nullable, but a future migration
    // might land empty-string rows from a poisoned ingestor. Same
    // semantic — anything that is not an actual tx hash means
    // "not anchored on Polygon".
    const state: ReconciliationState = {
      actions: [{ seq: '5', body_hash: hash(5) }],
      fabricWitnesses: [{ seq: '5', body_hash: hash(5) }],
      anchorCommitments: [{ seq_from: '5', seq_to: '5', root_hash: hash(5), polygon_tx_hash: '' }],
    };
    const plan = computeReconciliationPlan(state);
    expect(plan.missingFromPolygon.map((m) => m.seq)).toEqual(['5']);
  });

  it('mixed NULL + valid commitments — only valid ranges grant coverage', () => {
    const state: ReconciliationState = {
      actions: [
        { seq: '1', body_hash: hash(1) },
        { seq: '2', body_hash: hash(2) },
        { seq: '3', body_hash: hash(3) },
        { seq: '4', body_hash: hash(4) },
      ],
      fabricWitnesses: [
        { seq: '1', body_hash: hash(1) },
        { seq: '2', body_hash: hash(2) },
        { seq: '3', body_hash: hash(3) },
        { seq: '4', body_hash: hash(4) },
      ],
      anchorCommitments: [
        // Real anchor — covers 1..2.
        { seq_from: '1', seq_to: '2', root_hash: hash(0xa), polygon_tx_hash: '0xreal' },
        // Pending — covers 3..4 only on paper.
        { seq_from: '3', seq_to: '4', root_hash: hash(0xb), polygon_tx_hash: null },
      ],
    };
    const plan = computeReconciliationPlan(state);
    expect(plan.missingFromPolygon.map((m) => m.seq)).toEqual(['3', '4']);
  });
});
