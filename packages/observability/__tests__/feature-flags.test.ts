import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AUDITED_FEATURE_FLAGS,
  auditFeatureFlagsAtBoot,
  isTruthy,
  readFeatureFlagSnapshot,
} from '../src/feature-flags.js';
import { featureFlagState } from '../src/metrics.js';

/**
 * Mode 6.9 — feature-flag boot audit.
 *
 * Tests the three exported helpers:
 *   - isTruthy: env-string → boolean coercion.
 *   - readFeatureFlagSnapshot: pure flag-state reader.
 *   - auditFeatureFlagsAtBoot: emit + gauge wiring.
 */

describe('isTruthy', () => {
  it.each([
    ['1', true],
    ['true', true],
    ['TRUE', true],
    ['yes', true],
    ['YES', true],
    ['on', true],
    ['ON', true],
    [' true ', true], // trimmed
  ])('truthy: %s -> %s', (input, expected) => {
    expect(isTruthy(input)).toBe(expected);
  });

  it.each([
    [undefined, false],
    ['', false],
    ['0', false],
    ['false', false],
    ['no', false],
    ['off', false],
    ['anything-else', false],
    [' 0 ', false],
  ])('falsy: %s -> %s', (input, expected) => {
    expect(isTruthy(input)).toBe(expected);
  });
});

describe('readFeatureFlagSnapshot', () => {
  it('reads every audited flag from the env map', () => {
    const env: Record<string, string | undefined> = {
      AWS_BEDROCK_ENABLED: 'true',
      LOCAL_LLM_ENABLED: 'false',
      EXTRACTOR_LLM_ENABLED: '1',
    };
    const snap = readFeatureFlagSnapshot(env);
    const byName = Object.fromEntries(snap.map((f) => [f.name, f.enabled]));
    expect(byName.AWS_BEDROCK_ENABLED).toBe(true);
    expect(byName.LOCAL_LLM_ENABLED).toBe(false);
    expect(byName.EXTRACTOR_LLM_ENABLED).toBe(true);
    // Unset flags read as false.
    expect(byName.NEXT_PUBLIC_VIGIL_DEV_MODE).toBe(false);
  });

  it('treats synthetic _PRESENT flags as "is the underlying env var defined?"', () => {
    const env: Record<string, string | undefined> = {
      VAULT_BACKUP_TOKEN: 'hvs.abcdef',
      // VIGIL_AUTH_PROOF_KEY undefined.
    };
    const snap = readFeatureFlagSnapshot(env);
    const byName = Object.fromEntries(snap.map((f) => [f.name, f.enabled]));
    expect(byName.VAULT_BACKUP_TOKEN_PRESENT).toBe(true);
    expect(byName.VIGIL_AUTH_PROOF_KEY_PRESENT).toBe(false);
  });

  it('honours an explicit flags-list override (service-specific flags)', () => {
    const env: Record<string, string | undefined> = {
      FOO_FLAG: '1',
      BAR_FLAG: '0',
    };
    const snap = readFeatureFlagSnapshot(env, ['FOO_FLAG', 'BAR_FLAG']);
    expect(snap).toHaveLength(2);
    expect(snap[0]).toEqual({ name: 'FOO_FLAG', enabled: true, source: 'env' });
    expect(snap[1]).toEqual({ name: 'BAR_FLAG', enabled: false, source: 'env' });
  });

  it('returns the canonical AUDITED_FEATURE_FLAGS list when no override is passed', () => {
    const snap = readFeatureFlagSnapshot({});
    expect(snap.map((f) => f.name)).toEqual(AUDITED_FEATURE_FLAGS);
  });
});

describe('auditFeatureFlagsAtBoot', () => {
  beforeEach(() => {
    featureFlagState.reset();
  });

  it('emits one audit event per flag with the expected shape', async () => {
    const emit = vi.fn().mockResolvedValue(undefined);
    await auditFeatureFlagsAtBoot({
      service: 'test-worker',
      emit,
      env: { AWS_BEDROCK_ENABLED: 'true' },
      flags: ['AWS_BEDROCK_ENABLED', 'LOCAL_LLM_ENABLED'],
    });

    expect(emit).toHaveBeenCalledTimes(2);
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'feature.toggled',
        actor: 'system:boot:test-worker',
        subject_kind: 'feature_flag',
        subject_id: 'AWS_BEDROCK_ENABLED',
        payload: expect.objectContaining({
          enabled: true,
          source: 'env',
          service: 'test-worker',
        }),
      }),
    );
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        subject_id: 'LOCAL_LLM_ENABLED',
        payload: expect.objectContaining({ enabled: false }),
      }),
    );
  });

  it('sets the Prometheus gauge for each flag', async () => {
    const emit = vi.fn().mockResolvedValue(undefined);
    await auditFeatureFlagsAtBoot({
      service: 'svc-x',
      emit,
      env: { AWS_BEDROCK_ENABLED: 'on' },
      flags: ['AWS_BEDROCK_ENABLED'],
    });

    const gauge = await featureFlagState.get();
    const v = gauge.values.find(
      (x) => x.labels.name === 'AWS_BEDROCK_ENABLED' && x.labels.service === 'svc-x',
    );
    expect(v?.value).toBe(1);
  });

  it('propagates an emit failure (audit-emitter-unavailable should halt boot)', async () => {
    const emit = vi.fn().mockRejectedValue(new Error('audit chain down'));
    await expect(
      auditFeatureFlagsAtBoot({
        service: 'svc',
        emit,
        env: {},
        flags: ['AWS_BEDROCK_ENABLED'],
      }),
    ).rejects.toThrow(/audit chain down/);

    // But the gauge IS set BEFORE the emit, so the metric exists even
    // if the audit chain is unreachable. Operators see "this worker
    // tried to boot with these flag values" via Prometheus even when
    // the audit chain is degraded.
    const gauge = await featureFlagState.get();
    expect(gauge.values.some((x) => x.labels.name === 'AWS_BEDROCK_ENABLED')).toBe(true);
  });
});
