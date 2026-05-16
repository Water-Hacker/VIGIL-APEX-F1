/**
 * Tier-30 audit closure — worker-score signal-scan cap + strength bounds warn.
 *
 * Source-grep regression style (precedent: worker-anchor anchor-batch-cap.test.ts).
 * The handle() method runs inside a WorkerBase that needs a real
 * Postgres + Redis to exercise end-to-end; pinning the contract via
 * grep catches a future PR that weakens the guard.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const SRC = readFileSync(join(REPO_ROOT, 'apps/worker-score/src/index.ts'), 'utf8');

describe('Tier-30 — SIGNAL_SCAN_CAP', () => {
  it('declares SIGNAL_SCAN_CAP = 1000', () => {
    expect(SRC).toMatch(/SIGNAL_SCAN_CAP\s*=\s*1000/);
  });

  it('SELECT issues LIMIT ${SIGNAL_SCAN_CAP + 1} for truncation detection', () => {
    expect(SRC).toMatch(/LIMIT\s*\$\{?SIGNAL_SCAN_CAP\s*\+\s*1\s*\}?/);
  });

  it('SELECT carries ORDER BY contributed_at ASC for deterministic truncation', () => {
    expect(SRC).toMatch(/ORDER BY contributed_at ASC/);
  });

  it('logs a truncation warning when scan exceeds cap', () => {
    expect(SRC).toMatch(/'signal-scan-truncated/);
  });
});

describe('Tier-30 — strength out-of-range warn', () => {
  it('counts out-of-range strength rows BEFORE clamping', () => {
    expect(SRC).toMatch(/outOfRangeCount\s*\+=\s*1/);
  });

  it('emits a signal-strength-out-of-range warn with sample', () => {
    expect(SRC).toMatch(/'signal-strength-out-of-range/);
    expect(SRC).toMatch(/clamped to \[0,1\]/);
  });

  it('bounds the sample at 5 entries to avoid log spam', () => {
    expect(SRC).toMatch(/outOfRangeSample\.length\s*<\s*5/);
  });
});

describe('Tier-30 — main().catch normalisation', () => {
  it('uses err_name / err_message structured fields', () => {
    const idx = SRC.indexOf("'fatal-startup'");
    expect(idx).toBeGreaterThan(0);
    const window = SRC.slice(Math.max(0, idx - 400), idx);
    expect(window).toMatch(/err_name/);
    expect(window).toMatch(/err_message/);
  });

  it('no surviving `{ err: e }` patterns in worker-score', () => {
    expect(SRC).not.toMatch(/\{\s*err:\s*e\s*\}/);
  });
});
