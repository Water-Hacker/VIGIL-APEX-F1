import { describe, expect, it, vi } from 'vitest';

import {
  candidateDedupKey,
  runDiscoveryCycle,
  type DiscoveryCycleContext,
} from '../src/discovery-loop.js';

import type { DiscoveryCandidate, GraphSnapshot } from '../src/graph-anomalies.js';

const silentLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
  fatal: vi.fn(),
  child: () => silentLogger,
} as unknown as DiscoveryCycleContext['logger'];

const emptySnapshot = (): GraphSnapshot => ({ nodes: [], edges: [] });

describe('candidateDedupKey', () => {
  it('is deterministic for the same content', () => {
    const c: DiscoveryCandidate = {
      kind: 'cycle_3_to_6',
      evidence: { cycle_len: 3 },
      strength: 0.5,
      entity_ids_involved: ['c', 'a', 'b'],
      rationale: '3-cycle detected',
    };
    expect(candidateDedupKey(c)).toBe(candidateDedupKey(c));
  });

  it('sorts entity ids — same set in different order ⇒ same key', () => {
    const a = candidateDedupKey({
      kind: 'cycle_3_to_6',
      evidence: {},
      strength: 0.5,
      entity_ids_involved: ['c', 'a', 'b'],
      rationale: 'r',
    });
    const b = candidateDedupKey({
      kind: 'cycle_3_to_6',
      evidence: {},
      strength: 0.5,
      entity_ids_involved: ['a', 'b', 'c'],
      rationale: 'r',
    });
    expect(a).toBe(b);
  });

  it('differs across kinds even with same entities', () => {
    const a = candidateDedupKey({
      kind: 'cycle_3_to_6',
      evidence: {},
      strength: 0.5,
      entity_ids_involved: ['a'],
      rationale: 'r',
    });
    const b = candidateDedupKey({
      kind: 'stellar_degree',
      evidence: {},
      strength: 0.5,
      entity_ids_involved: ['a'],
      rationale: 'r',
    });
    expect(a).not.toBe(b);
  });
});

describe('runDiscoveryCycle', () => {
  it('zero-candidate snapshot yields zero inserts and no chain rows', async () => {
    const repo = { upsertCandidate: vi.fn() };
    const chain = { append: vi.fn() };
    const result = await runDiscoveryCycle({
      repo: repo as never,
      chain: chain as never,
      logger: silentLogger,
      loadSnapshot: async () => emptySnapshot(),
    });
    expect(result).toEqual({
      anomalies_detected: 0,
      candidates_persisted: 0,
      candidates_already_seen: 0,
    });
    expect(repo.upsertCandidate).not.toHaveBeenCalled();
    expect(chain.append).not.toHaveBeenCalled();
  });

  it('upserts every detected candidate and emits one chain row per candidate', async () => {
    // Snapshot crafted to fire stellar_degree: one node with degree
    // far above the population median. (The actual thresholds live in
    // graph-anomalies.ts; we just need to ensure at least one detector
    // fires on the way through.)
    const nodes = Array.from({ length: 12 }, (_, i) => ({
      id: `n-${i}`,
      kind: 'Company' as const,
      degree: i === 0 ? 200 : 1,
    }));
    const snapshot: GraphSnapshot = { nodes, edges: [] };

    const repo = {
      upsertCandidate: vi.fn().mockResolvedValue({ inserted: true }),
    };
    const chain = { append: vi.fn().mockResolvedValue(undefined) };

    const result = await runDiscoveryCycle({
      repo: repo as never,
      chain: chain as never,
      logger: silentLogger,
      loadSnapshot: async () => snapshot,
    });

    expect(result.anomalies_detected).toBeGreaterThan(0);
    expect(result.candidates_persisted).toBe(result.anomalies_detected);
    expect(repo.upsertCandidate).toHaveBeenCalledTimes(result.anomalies_detected);
    expect(chain.append).toHaveBeenCalledTimes(result.anomalies_detected);
    const calls = (chain.append as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0]![0].action).toBe('audit.pattern_anomaly_detected');
  });

  it('counts recurring candidates as already_seen (repo returns inserted:false)', async () => {
    const nodes = Array.from({ length: 12 }, (_, i) => ({
      id: `n-${i}`,
      kind: 'Company' as const,
      degree: i === 0 ? 200 : 1,
    }));
    const snapshot: GraphSnapshot = { nodes, edges: [] };
    const repo = {
      upsertCandidate: vi.fn().mockResolvedValue({ inserted: false }),
    };
    const chain = { append: vi.fn().mockResolvedValue(undefined) };

    const result = await runDiscoveryCycle({
      repo: repo as never,
      chain: chain as never,
      logger: silentLogger,
      loadSnapshot: async () => snapshot,
    });

    expect(result.candidates_persisted).toBe(0);
    expect(result.candidates_already_seen).toBe(result.anomalies_detected);
    // Recurring rows still emit a chain row (with `reused: true`).
    const lastCallPayload = (chain.append as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0];
    expect(lastCallPayload.payload.reused).toBe(true);
  });
});
