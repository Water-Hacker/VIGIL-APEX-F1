/**
 * Graph-metric runner integration tests — orchestrator behaviour with
 * stubbed metric outputs and stubbed sinks.
 */
import { describe, expect, it } from 'vitest';

import { runGraphMetrics } from '../src/gds/runner.js';

import type { Neo4jClient } from '../src/client.js';

const FIXED_NOW = new Date('2026-04-29T00:00:00Z');

function stubNeo4j(rows: Map<string, unknown[]>): Neo4jClient {
  return {
    async run<T>(query: string): Promise<T[]> {
      // Crude routing: match the first MATCH clause and return appropriate stub
      for (const [k, v] of rows) {
        if (query.includes(k)) return v as unknown as T[];
      }
      return [];
    },
    close: async () => undefined,
  } as unknown as Neo4jClient;
}

class SinkRecorder {
  public mergedEntities: Array<{ id: string; additions: Record<string, unknown> }> = [];
  public mergedEvents: Array<{ id: string; additions: Record<string, unknown> }> = [];

  async bulkMergeMetadata(
    updates: ReadonlyArray<{ id: string; additions: Record<string, unknown> }>,
  ): Promise<{ updated: number }> {
    this.mergedEntities.push(...updates);
    return { updated: updates.length };
  }

  async mergeEventPayload(
    id: string,
    additions: Record<string, unknown>,
  ): Promise<{ updated: boolean }> {
    this.mergedEvents.push({ id, additions });
    return { updated: true };
  }
}

describe('runGraphMetrics', () => {
  it('returns ok report for empty graph', async () => {
    const sink = new SinkRecorder();
    const report = await runGraphMetrics(stubNeo4j(new Map()), sink, sink, {
      now: () => FIXED_NOW,
    });
    expect(report.louvain.ok).toBe(true);
    expect(report.pageRank.ok).toBe(true);
    expect(report.entitiesUpdated).toBe(0);
    expect(report.tendersUpdated).toBe(0);
  });

  it('routes Louvain communities into entity metadata', async () => {
    const sink = new SinkRecorder();
    const rows = new Map<string, unknown[]>([
      [
        'RELATED_TO',
        [
          { a: 'e-1', b: 'e-2', w: 1 },
          { a: 'e-2', b: 'e-3', w: 1 },
        ],
      ],
    ]);
    await runGraphMetrics(stubNeo4j(rows), sink, sink, {
      now: () => FIXED_NOW,
      enable: {
        louvain: true,
        pageRank: false,
        roundTrip: false,
        directorRing: false,
        bidderDensity: false,
      },
    });
    expect(sink.mergedEntities.length).toBeGreaterThan(0);
    const ids = sink.mergedEntities.map((u) => u.id);
    expect(ids).toContain('e-1');
    expect(ids).toContain('e-2');
    expect(ids).toContain('e-3');
    for (const u of sink.mergedEntities) {
      expect(u.additions).toHaveProperty('communityId');
      expect(u.additions).toHaveProperty('_graph_metrics_at');
    }
  });

  it('routes round-trip detections into entity metadata as roundTripDetected', async () => {
    const sink = new SinkRecorder();
    const rows = new Map<string, unknown[]>([
      ['AWARDED_BY', [{ supplier: 's-1', authority: 'a-1', ts: '2024-01-01' }]],
      ['PAID_TO', [{ from: 's-1', to: 'p-1' }]],
      ['OFFICER_OF', [{ authority: 'a-1', person: 'p-1' }]],
    ]);
    await runGraphMetrics(stubNeo4j(rows), sink, sink, {
      now: () => FIXED_NOW,
      enable: {
        louvain: false,
        pageRank: false,
        roundTrip: true,
        directorRing: false,
        bidderDensity: false,
      },
    });
    const supplier = sink.mergedEntities.find((u) => u.id === 's-1');
    expect(supplier).toBeDefined();
    expect(supplier?.additions['roundTripDetected']).toBe(true);
    expect(supplier?.additions['roundTripHops']).toBe(1);
  });

  it('isolates failures — Louvain failure does not stop PageRank', async () => {
    const sink = new SinkRecorder();
    const failingClient: Neo4jClient = {
      async run<T>(query: string): Promise<T[]> {
        if (query.includes('coalesce')) throw new Error('Cypher syntax error');
        // PageRank query (no coalesce) returns empty
        return [] as unknown as T[];
      },
      close: async () => undefined,
    } as unknown as Neo4jClient;
    const report = await runGraphMetrics(failingClient, sink, sink, {
      now: () => FIXED_NOW,
      enable: {
        louvain: true,
        pageRank: true,
        roundTrip: false,
        directorRing: false,
        bidderDensity: false,
      },
    });
    expect(report.louvain.ok).toBe(false);
    expect(report.louvain.error).toContain('Cypher syntax error');
    expect(report.pageRank.ok).toBe(true);
  });

  it('writes bidder density to award event payloads', async () => {
    const sink = new SinkRecorder();
    const rows = new Map<string, unknown[]>([
      [
        'BID_FOR',
        [
          { tender: 't-1', bidder: 'a' },
          { tender: 't-1', bidder: 'b' },
          { tender: 't-1', bidder: 'c' },
        ],
      ],
      [
        "RELATED_TO]-(b:Entity {kind: 'company'})",
        [
          { a: 'a', b: 'b' },
          { a: 'a', b: 'c' },
          { a: 'b', b: 'c' },
        ],
      ],
    ]);
    await runGraphMetrics(stubNeo4j(rows), sink, sink, {
      now: () => FIXED_NOW,
      enable: {
        louvain: false,
        pageRank: false,
        roundTrip: false,
        directorRing: false,
        bidderDensity: true,
      },
    });
    expect(sink.mergedEvents.length).toBeGreaterThanOrEqual(1);
    const tender = sink.mergedEvents.find((e) => e.id === 't-1');
    expect(tender).toBeDefined();
    expect(tender?.additions['bidder_graph_density']).toBe(1);
  });

  it('records the run timestamp on every updated entity', async () => {
    const sink = new SinkRecorder();
    const rows = new Map<string, unknown[]>([['RELATED_TO', [{ a: 'e-1', b: 'e-2', w: 1 }]]]);
    await runGraphMetrics(stubNeo4j(rows), sink, sink, {
      now: () => FIXED_NOW,
      enable: {
        louvain: true,
        pageRank: false,
        roundTrip: false,
        directorRing: false,
        bidderDensity: false,
      },
    });
    for (const u of sink.mergedEntities) {
      expect(u.additions['_graph_metrics_at']).toBe(FIXED_NOW.toISOString());
    }
  });
});
