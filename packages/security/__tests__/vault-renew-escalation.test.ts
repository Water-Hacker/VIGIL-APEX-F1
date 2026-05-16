/**
 * Tier-25 audit closure — VaultClient token-renewal escalation.
 *
 * Pre-T25, `renewToken()` swallowed every failure with `{ err: e }`
 * unstructured log + a metric increment. A wedged Vault left the
 * worker silently holding an expired token until the next read 403'd.
 *
 * Source-grep regression style (precedent: worker-anchor
 * contract-address-guard.test.ts). The renewal path lives inside an
 * unref'd setInterval that needs a real Vault connection to spin up;
 * pinning the contract via source-grep catches a future PR that
 * weakens the escalation.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const SRC = readFileSync(join(REPO_ROOT, 'packages/security/src/vault.ts'), 'utf8');

describe('Tier-25 — VaultClient consecutive-renewal escalation', () => {
  it('declares a MAX_CONSECUTIVE_RENEW_FAILURES threshold', () => {
    expect(SRC).toMatch(/MAX_CONSECUTIVE_RENEW_FAILURES\s*=\s*5/);
  });

  it('renewToken increments consecutiveRenewFailures on failure', () => {
    expect(SRC).toMatch(/this\.consecutiveRenewFailures\s*\+=\s*1/);
  });

  it('renewToken resets consecutiveRenewFailures on success', () => {
    expect(SRC).toMatch(/this\.consecutiveRenewFailures\s*=\s*0/);
  });

  it('emits a fatal log when the threshold is hit', () => {
    expect(SRC).toMatch(/'vault-token-renew-exhausted/);
    expect(SRC).toMatch(/logger\.fatal\(/);
  });
});

describe('Tier-25 — error-log normalisation', () => {
  it('vault-read-failed uses err_name / err_message', () => {
    const idx = SRC.indexOf("'vault-read-failed'");
    expect(idx).toBeGreaterThan(0);
    const window = SRC.slice(Math.max(0, idx - 400), idx);
    expect(window).toMatch(/err_name/);
    expect(window).toMatch(/err_message/);
  });

  it('vault-token-lookup-failed uses err_name / err_message', () => {
    const idx = SRC.indexOf("'vault-token-lookup-failed'");
    expect(idx).toBeGreaterThan(0);
    const window = SRC.slice(Math.max(0, idx - 400), idx);
    expect(window).toMatch(/err_name/);
    expect(window).toMatch(/err_message/);
  });

  it('vault-token-renew-failed uses err_name / err_message', () => {
    const idx = SRC.indexOf("'vault-token-renew-failed'");
    expect(idx).toBeGreaterThan(0);
    const window = SRC.slice(Math.max(0, idx - 400), idx);
    expect(window).toMatch(/err_name/);
    expect(window).toMatch(/err_message/);
  });

  it('no surviving `{ err: e }` patterns in vault.ts', () => {
    expect(SRC).not.toMatch(/\{\s*err:\s*e\s*\}/);
  });
});
