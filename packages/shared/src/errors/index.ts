/**
 * Domain error hierarchy.
 *
 * Every thrown error in VIGIL APEX should subclass `VigilError`. This gives
 * callers a `.code`, `.context`, and `.retryable` they can route on without
 * sniffing strings or instanceof-chains.
 *
 * Error codes are stable across versions; UI / dashboards group by code.
 */

import type { JsonObject } from '../types.js';

export type ErrorSeverity = 'info' | 'warn' | 'error' | 'fatal';

export interface VigilErrorOptions {
  readonly code: string;
  readonly message: string;
  readonly retryable?: boolean;
  readonly severity?: ErrorSeverity;
  readonly context?: JsonObject;
  readonly cause?: unknown;
}

export class VigilError extends Error {
  public readonly code: string;
  public readonly retryable: boolean;
  public readonly severity: ErrorSeverity;
  public readonly context: JsonObject;
  public override readonly cause?: unknown;

  constructor(opts: VigilErrorOptions) {
    super(opts.message);
    this.name = this.constructor.name;
    this.code = opts.code;
    this.retryable = opts.retryable ?? false;
    this.severity = opts.severity ?? 'error';
    this.context = opts.context ?? {};
    if (opts.cause !== undefined) {
      this.cause = opts.cause;
    }
    // Maintain stack trace
    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  toJSON(): JsonObject {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      severity: this.severity,
      context: this.context,
    };
  }
}

/* =============================================================================
 * Adapter / scraper errors (Ring 1)
 * ===========================================================================*/

export class AdapterError extends VigilError {}

export class SourceUnavailableError extends AdapterError {
  constructor(source: string, status: number, ctx: JsonObject = {}) {
    super({
      code: 'ADAPTER_SOURCE_UNAVAILABLE',
      message: `Source ${source} unreachable (status=${status})`,
      retryable: true,
      severity: 'warn',
      context: { source, status, ...ctx },
    });
  }
}

export class SourceParseError extends AdapterError {
  constructor(source: string, ctx: JsonObject = {}) {
    super({
      code: 'ADAPTER_PARSE_FAILURE',
      message: `Source ${source}: parser produced 0 rows. First-contact protocol triggered.`,
      retryable: false,
      severity: 'error',
      context: { source, ...ctx },
    });
  }
}

export class SourceBlockedError extends AdapterError {
  constructor(source: string, ctx: JsonObject = {}) {
    super({
      code: 'ADAPTER_SOURCE_BLOCKED',
      message: `Source ${source} returned 403/451 — possible active blocking.`,
      retryable: true,
      severity: 'warn',
      context: { source, ...ctx },
    });
  }
}

export class CaptchaBudgetExceededError extends AdapterError {
  constructor(source: string) {
    super({
      code: 'ADAPTER_CAPTCHA_BUDGET',
      message: `Source ${source}: captcha budget exhausted for the month.`,
      retryable: false,
      severity: 'error',
      context: { source },
    });
  }
}

/* =============================================================================
 * LLM errors (Ring 2)
 * ===========================================================================*/

export class LlmError extends VigilError {}

export class LlmCircuitOpenError extends LlmError {
  constructor(provider: string) {
    super({
      code: 'LLM_CIRCUIT_OPEN',
      message: `LLM circuit breaker open for provider=${provider}.`,
      retryable: true,
      severity: 'warn',
      context: { provider },
    });
  }
}

export class LlmCostCeilingError extends LlmError {
  constructor(usdSpent: number, ceiling: number) {
    super({
      code: 'LLM_COST_CEILING',
      message: `LLM daily hard cost ceiling exceeded: $${usdSpent.toFixed(2)} > $${ceiling}.`,
      retryable: false,
      severity: 'error',
      context: { usdSpent, ceiling },
    });
  }
}

/**
 * Block-A reconciliation §2.A.4 / §2.A.5 — thrown when the LLM cost
 * accounting cannot find a pricing entry for the requested model_id.
 * No default fallback is allowed: a missing entry means the
 * cost-tracker would report 0 for that call, leaving the daily and
 * monthly ceilings effectively inert.
 */
export class LlmPricingNotConfiguredError extends LlmError {
  constructor(modelId: string, provider: string) {
    super({
      code: 'LLM_PRICING_NOT_CONFIGURED',
      message: `No pricing entry for ${provider}/${modelId} in infra/llm/pricing.json. Refusing to use a fallback price; the daily and monthly ceilings would otherwise be inert.`,
      retryable: false,
      severity: 'fatal',
      context: { modelId, provider },
    });
  }
}

export class LlmHallucinationDetectedError extends LlmError {
  constructor(layer: string, ctx: JsonObject = {}) {
    super({
      code: 'LLM_HALLUCINATION_REJECTED',
      message: `Anti-hallucination layer ${layer} rejected the LLM output.`,
      retryable: false,
      severity: 'warn',
      context: { layer, ...ctx },
    });
  }
}

/* =============================================================================
 * Governance errors (Ring 5)
 * ===========================================================================*/

export class GovernanceError extends VigilError {}

export class QuorumNotMetError extends GovernanceError {
  constructor(yesVotes: number, required: number) {
    super({
      code: 'GOVERNANCE_QUORUM_NOT_MET',
      message: `Quorum not met: yes=${yesVotes} < required=${required}`,
      retryable: false,
      severity: 'info',
      context: { yesVotes, required },
    });
  }
}

export class CouncilMemberConflictError extends GovernanceError {
  constructor(memberAddress: string) {
    super({
      code: 'GOVERNANCE_COUNCIL_CONFLICT',
      message: `Council member ${memberAddress} has conflict; recusal required.`,
      retryable: false,
      severity: 'warn',
      context: { memberAddress },
    });
  }
}

/* =============================================================================
 * Audit chain errors
 * ===========================================================================*/

export class AuditChainError extends VigilError {}

export class HashChainBrokenError extends AuditChainError {
  constructor(eventId: string, expected: string, actual: string) {
    super({
      code: 'AUDIT_HASH_CHAIN_BROKEN',
      message: `Hash chain integrity violated at event ${eventId}.`,
      retryable: false,
      severity: 'fatal',
      context: { eventId, expected, actual },
    });
  }
}

/* =============================================================================
 * Validation / schema errors
 * ===========================================================================*/

export class ValidationError extends VigilError {
  constructor(message: string, ctx: JsonObject = {}) {
    super({
      code: 'VALIDATION_ERROR',
      message,
      retryable: false,
      severity: 'error',
      context: ctx,
    });
  }
}

/* =============================================================================
 * Auth / security errors
 * ===========================================================================*/

export class AuthError extends VigilError {}

export class FidoVerificationError extends AuthError {
  constructor(reason: string) {
    super({
      code: 'AUTH_FIDO_VERIFICATION_FAILED',
      message: `FIDO2/WebAuthn verification failed: ${reason}`,
      retryable: false,
      severity: 'warn',
      context: { reason },
    });
  }
}

export class VaultUnsealError extends VigilError {
  constructor(reason: string) {
    super({
      code: 'VAULT_UNSEAL_FAILURE',
      message: `Vault unseal failed: ${reason}`,
      retryable: false,
      severity: 'fatal',
      context: { reason },
    });
  }
}

/* =============================================================================
 * Phase-gate errors
 * ===========================================================================*/

export class PhaseGateError extends VigilError {
  constructor(phase: number, missing: readonly string[]) {
    super({
      code: 'PHASE_GATE_PRECONDITION',
      message: `Phase ${phase} cannot proceed: missing preconditions: ${missing.join(', ')}`,
      retryable: false,
      severity: 'error',
      context: { phase, missing: [...missing] },
    });
  }
}

/* =============================================================================
 * Helper — narrow unknown to a VigilError, wrap if necessary
 * ===========================================================================*/

export function asVigilError(e: unknown): VigilError {
  if (e instanceof VigilError) return e;
  if (e instanceof Error) {
    return new VigilError({
      code: 'UNCATEGORISED',
      message: e.message,
      severity: 'error',
      cause: e,
    });
  }
  return new VigilError({
    code: 'UNCATEGORISED',
    message: typeof e === 'string' ? e : 'Unknown error',
    severity: 'error',
    context: { value: typeof e === 'string' ? e : '<non-string>' },
  });
}
