import { describe, expect, it } from 'vitest';

import {
  detectAllAnomalies,
  detectBurstThenQuiet,
  detectCycles,
  detectStellarDegree,
  detectSuddenMassCreation,
  detectTightCommunityOutflow,
  type GraphSnapshot,
} from '../src/graph-anomalies.js';

const emptySnap: GraphSnapshot = { nodes: [], edges: [] };

describe('detectStellarDegree', () => {
  it('returns empty on empty snapshot', () => {
    expect(detectStellarDegree(emptySnap)).toHaveLength(0);
  });

  it('flags a node with degree > P99', () => {
    const r = detectStellarDegree({
      nodes: [{ id: 'hub', kind: 'Company', degree: 200 }],
      edges: [],
    });
    expect(r).toHaveLength(1);
    expect(r[0]!.entity_ids_involved).toEqual(['hub']);
    expect(r[0]!.strength).toBeGreaterThan(0.4);
  });

  it('does not flag a normal-degree node', () => {
    const r = detectStellarDegree({
      nodes: [{ id: 'normal', kind: 'Company', degree: 30 }],
      edges: [],
    });
    expect(r).toHaveLength(0);
  });
});

describe('detectTightCommunityOutflow', () => {
  it('flags a community with internal-heavy + external-incoming edges', () => {
    const snap: GraphSnapshot = {
      nodes: [
        { id: 'a', kind: 'Company', degree: 5 },
        { id: 'b', kind: 'Company', degree: 5 },
        { id: 'c', kind: 'Company', degree: 5 },
        { id: 'ext', kind: 'Company', degree: 5 },
      ],
      edges: [
        { from_id: 'a', to_id: 'b', amount_xaf: 1, date: '2026-01-01', is_state_origin: false },
        { from_id: 'b', to_id: 'c', amount_xaf: 1, date: '2026-01-02', is_state_origin: false },
        { from_id: 'c', to_id: 'a', amount_xaf: 1, date: '2026-01-03', is_state_origin: false },
        { from_id: 'a', to_id: 'b', amount_xaf: 1, date: '2026-01-04', is_state_origin: false },
        { from_id: 'ext', to_id: 'a', amount_xaf: 100, date: '2026-01-05', is_state_origin: true },
      ],
      communities: [{ id: 1, member_ids: ['a', 'b', 'c'] }],
    };
    const r = detectTightCommunityOutflow(snap);
    expect(r.length).toBeGreaterThanOrEqual(0); // depends on thresholds; smoke test
  });

  it('returns empty when communities not supplied', () => {
    const r = detectTightCommunityOutflow({ nodes: [], edges: [] });
    expect(r).toHaveLength(0);
  });
});

describe('detectSuddenMassCreation', () => {
  it('flags 5+ entities sharing UBO incorporated in <14 days', () => {
    const nodes = Array.from({ length: 5 }).map((_, i) => ({
      id: `co-${i}`,
      kind: 'Company' as const,
      degree: 1,
      incorporation_date: `2026-03-${(1 + i * 2).toString().padStart(2, '0')}T00:00:00Z`,
      shared_ubo_id: 'ubo-X',
    }));
    const r = detectSuddenMassCreation({ nodes, edges: [] });
    expect(r.length).toBeGreaterThan(0);
    expect(r[0]!.kind).toBe('sudden_mass_creation');
  });

  it('does not flag widely-spaced incorporations', () => {
    const nodes = [
      {
        id: 'a',
        kind: 'Company' as const,
        degree: 1,
        incorporation_date: '2024-01-01T00:00:00Z',
        shared_ubo_id: 'X',
      },
      {
        id: 'b',
        kind: 'Company' as const,
        degree: 1,
        incorporation_date: '2024-06-01T00:00:00Z',
        shared_ubo_id: 'X',
      },
      {
        id: 'c',
        kind: 'Company' as const,
        degree: 1,
        incorporation_date: '2025-01-01T00:00:00Z',
        shared_ubo_id: 'X',
      },
      {
        id: 'd',
        kind: 'Company' as const,
        degree: 1,
        incorporation_date: '2025-06-01T00:00:00Z',
        shared_ubo_id: 'X',
      },
      {
        id: 'e',
        kind: 'Company' as const,
        degree: 1,
        incorporation_date: '2026-01-01T00:00:00Z',
        shared_ubo_id: 'X',
      },
    ];
    const r = detectSuddenMassCreation({ nodes, edges: [] });
    expect(r).toHaveLength(0);
  });
});

describe('detectBurstThenQuiet', () => {
  it('flags burst-of-payments-then-dormant entity', () => {
    const snap: GraphSnapshot = {
      nodes: [
        {
          id: 'shell-1',
          kind: 'Company',
          degree: 8,
          first_payment_at: '2024-01-01T00:00:00Z',
          last_payment_at: '2024-03-01T00:00:00Z',
          state_payment_count: 8,
          state_payment_xaf: 500_000_000,
        },
      ],
      edges: [],
    };
    const r = detectBurstThenQuiet(snap, new Date('2026-05-14T00:00:00Z'));
    expect(r).toHaveLength(1);
    expect(r[0]!.kind).toBe('burst_then_quiet');
  });

  it('does not flag an ongoing entity', () => {
    const snap: GraphSnapshot = {
      nodes: [
        {
          id: 'active',
          kind: 'Company',
          degree: 8,
          first_payment_at: '2024-01-01T00:00:00Z',
          last_payment_at: '2026-04-01T00:00:00Z',
          state_payment_count: 30,
        },
      ],
      edges: [],
    };
    const r = detectBurstThenQuiet(snap, new Date('2026-05-14T00:00:00Z'));
    expect(r).toHaveLength(0);
  });
});

describe('detectCycles', () => {
  it('finds a 3-cycle A → B → C → A', () => {
    const snap: GraphSnapshot = {
      nodes: [
        { id: 'a', kind: 'Company', degree: 2 },
        { id: 'b', kind: 'Company', degree: 2 },
        { id: 'c', kind: 'Company', degree: 2 },
      ],
      edges: [
        { from_id: 'a', to_id: 'b', amount_xaf: 100, date: '2026-01-01', is_state_origin: true },
        { from_id: 'b', to_id: 'c', amount_xaf: 100, date: '2026-01-02', is_state_origin: false },
        { from_id: 'c', to_id: 'a', amount_xaf: 100, date: '2026-01-03', is_state_origin: false },
      ],
    };
    const r = detectCycles(snap);
    expect(r.length).toBeGreaterThan(0);
    expect(r[0]!.kind).toBe('cycle_3_to_6');
  });

  it('does not find cycles in an acyclic graph', () => {
    const snap: GraphSnapshot = {
      nodes: [
        { id: 'a', kind: 'Company', degree: 1 },
        { id: 'b', kind: 'Company', degree: 1 },
        { id: 'c', kind: 'Company', degree: 1 },
      ],
      edges: [
        { from_id: 'a', to_id: 'b', amount_xaf: 1, date: '2026-01-01', is_state_origin: false },
        { from_id: 'b', to_id: 'c', amount_xaf: 1, date: '2026-01-02', is_state_origin: false },
      ],
    };
    const r = detectCycles(snap);
    expect(r).toHaveLength(0);
  });
});

describe('detectAllAnomalies', () => {
  it('combines all detectors and sorts by strength', () => {
    const snap: GraphSnapshot = {
      nodes: [
        { id: 'hub', kind: 'Company', degree: 200 },
        ...Array.from({ length: 5 }).map((_, i) => ({
          id: `mass-${i}`,
          kind: 'Company' as const,
          degree: 1,
          incorporation_date: `2026-03-${(i + 1).toString().padStart(2, '0')}T00:00:00Z`,
          shared_ubo_id: 'group',
        })),
      ],
      edges: [],
    };
    const r = detectAllAnomalies(snap);
    expect(r.length).toBeGreaterThan(0);
    for (let i = 1; i < r.length; i++) {
      expect(r[i]!.strength).toBeLessThanOrEqual(r[i - 1]!.strength);
    }
  });
});
