/**
 * Tier-24 audit closure — worker-anchor main-loop hardening.
 *
 * Source-grep regression style (precedent: contract-address-guard.test.ts).
 * The guards under test live in `main()` which is a singleton entrypoint
 * not suitable for direct testing without rewriting half the worker.
 * Pinning the contract via source-grep catches a future PR that weakens
 * the guard.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const SRC = readFileSync(join(REPO_ROOT, 'apps/worker-anchor/src/index.ts'), 'utf8');

describe('Tier-24 — anchor-loop env validation', () => {
  it('source exports a positive-int env parser used for AUDIT_ANCHOR_INTERVAL_MS', () => {
    expect(SRC).toMatch(/parsePositiveIntEnv\s*\(\s*['"]AUDIT_ANCHOR_INTERVAL_MS['"]/);
  });

  it('source exports a positive-int env parser used for AUDIT_HIGH_SIG_INTERVAL_MS', () => {
    expect(SRC).toMatch(/parsePositiveIntEnv\s*\(\s*['"]AUDIT_HIGH_SIG_INTERVAL_MS['"]/);
  });

  it('source rejects non-integer / non-finite numeric env vars (Number.isInteger + isFinite)', () => {
    expect(SRC).toMatch(/Number\.isFinite\s*\(/);
    expect(SRC).toMatch(/Number\.isInteger\s*\(/);
  });

  it('source uses a minimum-ms guard so 0 / negative values cannot busy-loop', () => {
    expect(SRC).toMatch(/n\s*<\s*minMs/);
  });
});

describe('Tier-24 — Merkle-root batch cap', () => {
  it('source pins MAX_ANCHOR_BATCH_SEQS = 100_000', () => {
    expect(SRC).toMatch(/MAX_ANCHOR_BATCH_SEQS\s*=\s*100_?000/);
  });

  it('source uses Math.min(tail.seq, fromSeq + cap - 1) to limit toSeq', () => {
    expect(SRC).toMatch(
      /Math\.min\(\s*tail\.seq\s*,\s*fromSeq\s*\+\s*MAX_ANCHOR_BATCH_SEQS\s*-\s*1\s*\)/,
    );
  });

  it('source emits a structured info log when a batch is capped', () => {
    expect(SRC).toMatch(/anchor-batch-capped/);
    expect(SRC).toMatch(/capped:\s*true/);
  });
});

describe('Tier-24 — error-log normalisation', () => {
  it('high-sig-loop-fatal catch uses err_name / err_message structured fields', () => {
    expect(SRC).toMatch(/'high-sig-loop-fatal'/);
    // The catch handler immediately above should use err_name + err_message.
    const idx = SRC.indexOf("'high-sig-loop-fatal'");
    expect(idx).toBeGreaterThan(0);
    const window = SRC.slice(Math.max(0, idx - 400), idx);
    expect(window).toMatch(/err_name/);
    expect(window).toMatch(/err_message/);
  });

  it('main().catch uses err_name / err_message structured fields', () => {
    const idx = SRC.indexOf("'fatal-startup'");
    expect(idx).toBeGreaterThan(0);
    const window = SRC.slice(Math.max(0, idx - 400), idx);
    expect(window).toMatch(/err_name/);
    expect(window).toMatch(/err_message/);
  });

  it('no surviving `err: e` patterns in the source', () => {
    expect(SRC).not.toMatch(/\{\s*err:\s*e\s*\}/);
  });
});
