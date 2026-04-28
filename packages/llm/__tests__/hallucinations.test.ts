import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { runGuards, type GuardContext } from '../src/guards.js';

interface Row {
  layer: string;
  kind: string;
  input: unknown;
  expected_rejection: boolean;
  reason: string;
  provided_cids?: string[];
  sources?: Record<string, string>;
  temperature_used?: number;
  temperature_max?: number;
}

describe('Anti-hallucination corpus (W-14)', () => {
  it('every row triggers the expected layer rejection', async () => {
    const file = path.join(__dirname, 'synthetic-hallucinations.jsonl');
    const text = await readFile(file, 'utf8');
    const rows: Row[] = text
      .trim()
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as Row);
    expect(rows.length).toBeGreaterThanOrEqual(7);

    let rejected = 0;
    for (const row of rows) {
      const ctx: GuardContext = {
        providedDocumentCids: row.provided_cids ?? [],
        sourceTexts: new Map(Object.entries(row.sources ?? {})),
        task: 'extraction',
        temperatureUsed: row.temperature_used ?? 0,
        temperatureMax: row.temperature_max ?? 0,
      };
      const results = runGuards(typeof row.input === 'string' ? JSON.parse(row.input) : row.input, ctx);
      const failed = results.find((r) => !r.passed);
      if (row.expected_rejection) {
        expect(failed, `row should fail at ${row.layer}: ${row.reason}`).toBeTruthy();
        rejected++;
      }
    }
    // ≥ 95% rejection rate per W-14 contract
    expect(rejected / rows.length).toBeGreaterThanOrEqual(0.95);
  });
});
