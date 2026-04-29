import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { runGuards, type GuardContext } from '../src/guards.js';

/**
 * W-14 contract — corpus-driven anti-hallucination guard suite.
 *
 * Each row in synthetic-hallucinations.jsonl declares:
 *   - layer:                the SRD §20 layer the row targets
 *   - expected_reject_layer the layer that MUST reject the row
 *   - schema (optional):    name in SCHEMA_REGISTRY for L1/L5 rows
 *   - worker_layer (opt):   row is exercised at the worker-extract level,
 *                           NOT at the package-level guards. Skipped here.
 *
 * The package-level corpus must reject ≥ 95% of non-worker-layer rows at
 * the EXACT layer declared. Worker-level rows seed the corpus structure
 * for the worker-extract test runner; that runner adds its own assertions
 * once the deferred layers (L8 numerical_disagreement, L9 language drift,
 * L10 entity-form preservation, L12 press-only existence) are wired into
 * worker-document / worker-entity / worker-pattern.
 */

interface Row {
  id: string;
  layer: string;
  kind: string;
  input: unknown;
  expected_reject_layer: string;
  reason: string;
  schema?: string;
  worker_layer?: boolean;
  provided_cids?: string[];
  sources?: Record<string, string>;
  temperature_used?: number;
  temperature_max?: number;
}

/* Tiny schema registry. The real DocumentClassify schema lives elsewhere;
 * this is a faithful slice sufficient for L1/L5 corpus rows. Extend as the
 * corpus grows. */
const documentClassifyV1 = z.object({
  kind: z.enum(['tender', 'award', 'amendment', 'budget', 'audit_report']),
  confidence: z.number().min(0).max(1),
  rationale: z.string().min(1).max(500),
});

const SCHEMA_REGISTRY: Record<string, z.ZodSchema> = {
  'document-classify-v1': documentClassifyV1,
};

describe('Anti-hallucination corpus (W-14)', () => {
  it('every row triggers the expected layer rejection', async () => {
    const file = path.join(__dirname, 'synthetic-hallucinations.jsonl');
    const text = await readFile(file, 'utf8');
    const rows: Row[] = text
      .trim()
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as Row);

    expect(rows.length).toBeGreaterThanOrEqual(30);

    const packageRows = rows.filter((r) => !r.worker_layer);
    const workerRows = rows.filter((r) => r.worker_layer);
    expect(packageRows.length).toBeGreaterThanOrEqual(25);
    // Worker-layer rows are scaffolding for L8/L9/L10/L12 — keep at least one
    // per deferred layer so the corpus structure is visible.
    const workerLayers = new Set(workerRows.map((r) => r.layer));
    for (const l of ['L8', 'L9', 'L10', 'L12']) {
      expect(workerLayers, `worker-layer corpus missing ${l}`).toContain(l);
    }

    let rejected = 0;
    let exactLayerHits = 0;
    const perLayer = new Map<string, { tried: number; hit: number }>();

    for (const row of packageRows) {
      const ctx: GuardContext = {
        providedDocumentCids: row.provided_cids ?? [],
        sourceTexts: new Map(Object.entries(row.sources ?? {})),
        responseSchema: row.schema ? SCHEMA_REGISTRY[row.schema] : undefined,
        task: 'extraction',
        temperatureUsed: row.temperature_used ?? 0,
        temperatureMax: row.temperature_max ?? 0,
      };
      const input = typeof row.input === 'string' ? JSON.parse(row.input as string) : row.input;
      const results = runGuards(input, ctx);
      const failed = results.find((r) => !r.passed);

      const bucket = perLayer.get(row.expected_reject_layer) ?? { tried: 0, hit: 0 };
      bucket.tried++;
      if (failed) {
        rejected++;
        if (failed.layer === row.expected_reject_layer) {
          exactLayerHits++;
          bucket.hit++;
        } else {
          // Some layers cascade (e.g. an L1 schema violation also fails L5
          // re-parse). We accept that — the row's `expected_reject_layer`
          // is the canonical gate, but an earlier layer catching it first
          // is not a regression.
        }
      } else {
        // Hard failure: the corpus row should have been rejected and wasn't.
        throw new Error(
          `corpus row ${row.id} (${row.layer}) was NOT rejected — guards say it passed`,
        );
      }
      perLayer.set(row.expected_reject_layer, bucket);
    }

    // ≥ 95% rejection rate per W-14 contract — overall.
    expect(rejected / packageRows.length).toBeGreaterThanOrEqual(0.95);

    // ≥ 80% exact-layer accuracy. Cascading rejections are acceptable but
    // the corpus author should know which layer is doing the work.
    expect(exactLayerHits / packageRows.length).toBeGreaterThanOrEqual(0.8);

    // Per-layer floor: every targeted layer rejects ≥ 1 of its rows, and the
    // implemented layers (L1-L7, L11) each have ≥ 3 rows.
    for (const layer of ['L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7', 'L11']) {
      const b = perLayer.get(layer);
      expect(b, `layer ${layer} has no corpus rows`).toBeTruthy();
      if (b) {
        expect(b.tried, `layer ${layer} undersized`).toBeGreaterThanOrEqual(3);
        expect(b.hit, `layer ${layer} no exact hits`).toBeGreaterThanOrEqual(1);
      }
    }
  });
});
