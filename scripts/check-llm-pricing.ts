#!/usr/bin/env tsx
/**
 * scripts/check-llm-pricing.ts — Block-A reconciliation §2.A.4 / §2.A.5.
 *
 * Asserts that every default Anthropic model_id referenced in
 * packages/llm/src/providers/anthropic.ts has a pricing entry in
 * infra/llm/pricing.json. The cost-tracker daily/monthly ceilings
 * depend on accurate per-call cost; a missing entry would surface as
 * a fatal LlmPricingNotConfiguredError at runtime, but the lint
 * surfaces it BEFORE deploy.
 *
 * The lint also verifies the pricing.json shape is well-formed and
 * every entry has the fields the cost code consumes.
 */

/// <reference types="node" />

import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const REPO_ROOT = process.cwd();
const PRICING_JSON = path.join(REPO_ROOT, 'infra', 'llm', 'pricing.json');
const ANTHROPIC_TS = path.join(REPO_ROOT, 'packages', 'llm', 'src', 'providers', 'anthropic.ts');

interface Entry {
  provider?: string;
  model_class?: string;
  input_per_mtok_usd?: number;
  output_per_mtok_usd?: number;
  cache_creation_multiplier?: number;
  cache_read_multiplier?: number;
  aws_bedrock_premium_multiplier?: number;
  effective_date?: string;
}

interface Table {
  schema_version?: number;
  generated_at?: string;
  models?: Record<string, Entry>;
}

const REQUIRED_FIELDS: (keyof Entry)[] = [
  'provider',
  'model_class',
  'input_per_mtok_usd',
  'output_per_mtok_usd',
  'cache_creation_multiplier',
  'cache_read_multiplier',
  'aws_bedrock_premium_multiplier',
  'effective_date',
];

function readDefaultModelIds(): string[] {
  const src = readFileSync(ANTHROPIC_TS, 'utf8');
  // Match `... ?? 'claude-...'` lines in the modelByClass init block.
  const re = /(?:ANTHROPIC_MODEL_(?:OPUS|SONNET|HAIKU)\s*\?\?\s*)['"]([^'"]+)['"]/g;
  const out = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) out.add(m[1]!);
  return Array.from(out).sort();
}

function main(): void {
  const t = JSON.parse(readFileSync(PRICING_JSON, 'utf8')) as Table;
  if (t.models === undefined || typeof t.models !== 'object') {
    process.stderr.write(`${PRICING_JSON}: top-level 'models' missing or invalid\n`);
    process.exit(1);
  }

  const failures: string[] = [];

  // (1) every entry has the required fields, all numeric where expected.
  for (const [id, entry] of Object.entries(t.models)) {
    for (const f of REQUIRED_FIELDS) {
      if (entry[f] === undefined || entry[f] === null) {
        failures.push(`${id}: missing field '${f}'`);
      }
    }
    const numericFields: (keyof Entry)[] = [
      'input_per_mtok_usd',
      'output_per_mtok_usd',
      'cache_creation_multiplier',
      'cache_read_multiplier',
      'aws_bedrock_premium_multiplier',
    ];
    for (const f of numericFields) {
      const v = entry[f];
      if (typeof v !== 'number' || Number.isNaN(v) || v < 0) {
        failures.push(`${id}: '${f}' must be a non-negative number (got ${String(v)})`);
      }
    }
    if (typeof entry.effective_date === 'string') {
      const ok = /^\d{4}-\d{2}-\d{2}$/.test(entry.effective_date);
      if (!ok) failures.push(`${id}: 'effective_date' must be YYYY-MM-DD`);
    }
  }

  // (2) every default model_id from anthropic.ts has an entry.
  const defaults = readDefaultModelIds();
  if (defaults.length === 0) {
    failures.push(
      `Could not extract default model_ids from ${ANTHROPIC_TS}; ` +
        `check the regex still matches the code shape.`,
    );
  }
  for (const id of defaults) {
    if (!(id in t.models)) {
      failures.push(`Default model_id '${id}' is not present in ${PRICING_JSON}`);
    }
  }

  if (failures.length > 0) {
    process.stderr.write('[llm-pricing] FAIL — pricing table is missing or malformed.\n\n');
    for (const f of failures) process.stderr.write(`  - ${f}\n`);
    process.stderr.write(
      '\n' +
        'Resolution: edit infra/llm/pricing.json so every default model_id\n' +
        'in packages/llm/src/providers/anthropic.ts has a complete entry.\n' +
        'See docs/work-program/BLOCK-A-RECONCILIATION.md §2.A.4.\n',
    );
    process.exit(1);
  }

  process.stdout.write(
    `[llm-pricing] OK — ${Object.keys(t.models).length} models, ` +
      `${defaults.length} defaults all priced.\n`,
  );
}

main();
