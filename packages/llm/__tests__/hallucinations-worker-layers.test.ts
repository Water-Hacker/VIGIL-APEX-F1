/**
 * Worker-layer corpus runner — DECISION-015 closure.
 *
 * The original W-14 hallucinations test (hallucinations.test.ts) filters
 * out `worker_layer: true` rows because L8/L9/L10/L12 used to be
 * package-level no-ops, with the real logic deferred to the worker
 * extract pipeline.
 *
 * As of DECISION-015 those layers are real at the package level. This
 * test asserts the deferred corpus rows now reject at their declared
 * layer when run through `runGuards` directly.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { runGuards, type GuardContext } from '../src/guards.js';

interface Row {
  id: string;
  layer: string;
  kind: string;
  input: unknown;
  expected_reject_layer: string;
  reason: string;
  worker_layer?: boolean;
  sources?: Record<string, string>;
}

describe('Worker-layer hallucination corpus (L8/L9/L10/L12)', () => {
  it('every worker-layer row is now rejected by the package-level guards', async () => {
    const file = path.join(__dirname, 'synthetic-hallucinations.jsonl');
    const text = await readFile(file, 'utf8');
    const rows: Row[] = text
      .trim()
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as Row);

    const workerRows = rows.filter((r) => r.worker_layer);
    expect(workerRows.length).toBeGreaterThanOrEqual(8); // ≥2 per L8/L9/L10/L12

    const perLayer = new Map<string, { tried: number; hit: number; rejected: number }>();
    const passedRows: Row[] = [];

    for (const row of workerRows) {
      // Build the cid set: any cid in `sources` AND any document_cid the row's
      // input declares. That keeps L3 from rejecting L9 corpus rows first
      // (those declare a cid but supply no source body — intentional).
      const cidSet = new Set<string>(Object.keys(row.sources ?? {}));
      const inp = (typeof row.input === 'string' ? JSON.parse(row.input) : row.input) as Record<
        string,
        unknown
      >;
      if (typeof inp['document_cid'] === 'string') {
        cidSet.add(inp['document_cid'] as string);
      }
      const ctx: GuardContext = {
        providedDocumentCids: [...cidSet],
        sourceTexts: new Map(Object.entries(row.sources ?? {})),
        responseSchema: undefined,
        task: 'extraction',
        temperatureUsed: 0,
        temperatureMax: 0,
      };
      const results = runGuards(inp, ctx);
      const failed = results.find((r) => !r.passed);

      const bucket = perLayer.get(row.expected_reject_layer) ?? {
        tried: 0,
        hit: 0,
        rejected: 0,
      };
      bucket.tried += 1;
      if (failed) {
        bucket.rejected += 1;
        if (failed.layer === row.expected_reject_layer) bucket.hit += 1;
      } else {
        passedRows.push(row);
      }
      perLayer.set(row.expected_reject_layer, bucket);
    }

    // Every worker-layer row must be rejected SOMEWHERE in the chain.
    // (Cascading through earlier layers — e.g. L2/L3 — is acceptable as
    // long as the row doesn't pass the full chain.)
    if (passedRows.length > 0) {
      // eslint-disable-next-line no-console
      console.error(
        'Worker-layer rows that passed the whole chain:',
        passedRows.map((r) => ({ id: r.id, layer: r.layer, reason: r.reason })),
      );
    }
    expect(passedRows).toEqual([]);

    // Each of L8 / L9 / L10 / L12 has at least one corpus row that REJECTS
    // AT THE EXACT DECLARED LAYER — that's the contract this test enforces.
    for (const layer of ['L8', 'L9', 'L10', 'L12']) {
      const b = perLayer.get(layer);
      expect(b, `worker-layer corpus missing ${layer}`).toBeTruthy();
      expect(b!.tried, `${layer} corpus undersized`).toBeGreaterThanOrEqual(2);
      expect(b!.hit, `${layer} no exact-layer hits`).toBeGreaterThanOrEqual(1);
    }
  });
});
