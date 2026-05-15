import { featureFlagState } from './metrics.js';

/**
 * Hardening mode 6.9 — feature-flag boot audit.
 *
 * Pre-closure, env-var-driven feature flags (AWS_BEDROCK_ENABLED,
 * LOCAL_LLM_ENABLED, VIGIL_DEV_ALLOW_UNSIGNED_DOSSIER, etc.) could
 * silently toggle between deployments and operators had no record of
 * when/why a flag changed. The deployment manifest captures the
 * change; the running platform did not. An incident weeks later
 * couldn't be correlated to "when did Bedrock fallback get disabled?"
 *
 * Closure:
 *   1. A canonical list of audited flags (extended via constructor
 *      arg for service-specific flags).
 *   2. `auditFeatureFlagsAtBoot(emit, env?)` reads each flag's
 *      current value, emits one `feature.toggled` audit event per
 *      flag, AND sets the `vigil_feature_flag_state{name,service}`
 *      Prometheus gauge.
 *   3. Workers call this in main() during boot.
 *
 * The audit-chain emit takes a callback parameter (the worker's
 * existing audit-emit primitive) rather than coupling this module to
 * @vigil/audit-log. Keeps the dep graph minimal; workers wire their
 * own emit.
 */

/**
 * The canonical list of env-var-driven feature flags that MUST be
 * audited at boot. Adding to the list is cheap; removing requires
 * architect sign-off.
 */
export const AUDITED_FEATURE_FLAGS: ReadonlyArray<string> = [
  // LLM tier toggles.
  'AWS_BEDROCK_ENABLED',
  'LOCAL_LLM_ENABLED',
  'ANTHROPIC_DISABLED',
  'EXTRACTOR_LLM_ENABLED',

  // Dev-only substitutes (must be FALSE in production).
  'NEXT_PUBLIC_VIGIL_DEV_MODE',
  'NEXT_PUBLIC_VIGIL_FABRIC_MOCK',
  'NEXT_PUBLIC_VIGIL_LLM_OFFLINE',
  'VIGIL_DEV_ALLOW_UNSIGNED_DOSSIER',

  // Backup + key management.
  'VAULT_BACKUP_TOKEN_PRESENT', // synthetic — set in code per readEnv
  'POSTGRES_REQUIRE_INSECURE_OK',

  // Quality gates.
  'AUDIT_SALT_COLLISION_CHECK_ENABLED',

  // Mode 4.3 — the auth-proof signing key, audited as a "is configured" flag.
  'VIGIL_AUTH_PROOF_KEY_PRESENT', // synthetic
];

/** Truthy test consistent with how worker env-var reads interpret a flag. */
export function isTruthy(value: string | undefined): boolean {
  if (value === undefined) return false;
  const v = value.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

export interface FeatureFlagSnapshot {
  readonly name: string;
  readonly enabled: boolean;
  /** Source of the resolution. Currently always 'env' but reserved for
   *  future Vault/runtime sources. */
  readonly source: 'env';
}

/**
 * Read every audited flag's current value. Returns a snapshot array.
 * Pure function (no I/O beyond the env read).
 */
export function readFeatureFlagSnapshot(
  env: Record<string, string | undefined> = process.env,
  flags: ReadonlyArray<string> = AUDITED_FEATURE_FLAGS,
): ReadonlyArray<FeatureFlagSnapshot> {
  return flags.map((name) => {
    // Synthetic flags ending in _PRESENT report whether the underlying
    // env var has any value (not just truthy).
    if (name.endsWith('_PRESENT')) {
      const underlying = name.replace(/_PRESENT$/, '');
      const value = env[underlying];
      return { name, enabled: value !== undefined && value !== '', source: 'env' as const };
    }
    return { name, enabled: isTruthy(env[name]), source: 'env' as const };
  });
}

/**
 * Type of the audit-emit callback. The caller (a worker) wires its
 * own implementation; the shape matches the existing audit-log
 * `chain.append(...)` contract.
 */
export type FeatureFlagAuditEmit = (event: {
  readonly action: 'feature.toggled';
  readonly actor: string;
  readonly subject_kind: 'feature_flag';
  readonly subject_id: string;
  readonly payload: Record<string, unknown>;
}) => Promise<void>;

/**
 * Audit every flag in the canonical list at boot time:
 *   1. Read its value (env).
 *   2. Set the Prometheus gauge with the current state.
 *   3. Emit a `feature.toggled` audit row recording the value.
 *
 * Callers pass the service name (so the gauge labels group by
 * worker) and a wired audit-emit callback.
 *
 * Failures in `emit` are surfaced — the worker can decide whether to
 * halt boot (audit-emit-unavailable is a doctrine §"No dark periods"
 * issue) or continue.
 */
export async function auditFeatureFlagsAtBoot(opts: {
  readonly service: string;
  readonly emit: FeatureFlagAuditEmit;
  readonly env?: Record<string, string | undefined>;
  readonly flags?: ReadonlyArray<string>;
}): Promise<void> {
  const snapshot = readFeatureFlagSnapshot(opts.env, opts.flags);
  for (const f of snapshot) {
    // Gauge first so even if emit fails, the metric exists.
    featureFlagState.set({ name: f.name, service: opts.service }, f.enabled ? 1 : 0);
    await opts.emit({
      action: 'feature.toggled',
      actor: `system:boot:${opts.service}`,
      subject_kind: 'feature_flag',
      subject_id: f.name,
      payload: {
        enabled: f.enabled,
        source: f.source,
        service: opts.service,
      },
    });
  }
}
