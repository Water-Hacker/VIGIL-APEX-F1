/**
 * AUDIT-066 — MtlsManager single-flight reload contract.
 *
 * Pre-fix two concurrent reload calls (start() in flight + a
 * setInterval tick) could interleave their disk writes, leaving
 * cert/key/ca in a half-loaded state. The single-flight mutex
 * (`inflightIssue`) collapses concurrent callers onto the same
 * in-progress Promise.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let writeCount = 0;
vi.mock('node:fs/promises', () => ({
  writeFile: vi.fn(async () => {
    writeCount += 1;
  }),
}));

import { MtlsManager } from '../src/mtls.js';
import { wrapSecret } from '../src/secrets.js';

import type { VaultClient } from '../src/vault.js';

describe('AUDIT-066 — MtlsManager.requestIssue is single-flight', () => {
  let issueCount = 0;
  let releaseIssue: (() => void) | null = null;

  beforeEach(() => {
    writeCount = 0;
    issueCount = 0;
    releaseIssue = null;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function manager(): MtlsManager {
    const vault = {
      issueCertificate: vi.fn(async () => {
        issueCount += 1;
        await new Promise<void>((resolve) => {
          releaseIssue = resolve;
        });
        return {
          certificate: 'CERT',
          privateKey: wrapSecret('KEY'),
          caChain: 'CA',
        };
      }),
    } as unknown as VaultClient;
    return new MtlsManager(vault, {
      serviceName: 'test-svc',
      commonName: 'test-svc.vigil.local',
      outputDir: '/tmp/vigil-test',
    });
  }

  it('two concurrent calls share one issueCertificate round-trip + one set of writes', async () => {
    const m = manager();
    // Call requestIssue twice while the first is held open.
    const a = (m as unknown as { requestIssue: () => Promise<void> }).requestIssue();
    const b = (m as unknown as { requestIssue: () => Promise<void> }).requestIssue();
    // Release Vault once both calls are queued.
    expect(issueCount).toBe(1);
    releaseIssue?.();
    await Promise.all([a, b]);
    // Only one issueCertificate; only one full set of writes (3 files).
    expect(issueCount).toBe(1);
    expect(writeCount).toBe(3);
  });

  it('after the first call settles, a fresh requestIssue starts a new round-trip', async () => {
    const m = manager();
    const first = (m as unknown as { requestIssue: () => Promise<void> }).requestIssue();
    expect(issueCount).toBe(1);
    releaseIssue?.();
    await first;

    const second = (m as unknown as { requestIssue: () => Promise<void> }).requestIssue();
    expect(issueCount).toBe(2);
    releaseIssue?.();
    await second;
    expect(writeCount).toBe(6); // 3 + 3
  });
});
