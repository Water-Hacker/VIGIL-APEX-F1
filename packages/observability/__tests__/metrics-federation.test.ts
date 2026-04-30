/**
 * AUDIT-056 / AUDIT-058 — federation + Vault metric contract.
 *
 * Pin the names + label sets so a downstream Prometheus scrape config
 * doesn't silently break under a rename. The metrics live in the shared
 * registry; we read them by name and assert label sets and types.
 */
import { describe, expect, it } from 'vitest';

import {
  federationFlushLagMs,
  federationPendingEnvelopes,
  registry,
  vaultTokenRenewFailedTotal,
} from '../src/metrics.js';

describe('AUDIT-056 — federation client metrics are registered', () => {
  it('vigil_federation_flush_lag_seconds is a histogram with [region] label', async () => {
    federationFlushLagMs.labels({ region: 'CMR-CE' }).observe(0.05);
    const all = await registry.getMetricsAsJSON();
    const m = all.find((x) => x.name === 'vigil_federation_flush_lag_seconds');
    expect(m).toBeDefined();
    expect(m!.type).toBe('histogram');
  });

  it('vigil_federation_pending_envelopes is a gauge with [region] label', async () => {
    federationPendingEnvelopes.labels({ region: 'CMR-CE' }).set(7);
    const all = await registry.getMetricsAsJSON();
    const m = all.find((x) => x.name === 'vigil_federation_pending_envelopes');
    expect(m).toBeDefined();
    expect(m!.type).toBe('gauge');
  });
});

describe('AUDIT-058 — vault token renewal counter is registered', () => {
  it('vigil_vault_token_renew_failed_total is a counter with [service] label', async () => {
    vaultTokenRenewFailedTotal.labels({ service: 'worker-test' }).inc();
    const all = await registry.getMetricsAsJSON();
    const m = all.find((x) => x.name === 'vigil_vault_token_renew_failed_total');
    expect(m).toBeDefined();
    expect(m!.type).toBe('counter');
  });
});
