/**
 * Halt-on-failure plumbing — TAL-PA doctrine §"No dark periods".
 *
 * `withHaltOnFailure` wraps any async handler so that if `emitAudit`
 * throws, the handler's caller receives a 503-equivalent error. The
 * Next.js dashboard middleware uses this to refuse traffic when the
 * audit emitter is unhealthy; workers use it to dead-letter the message
 * rather than complete the operation silently.
 */

export class AuditEmitterUnavailableError extends Error {
  public readonly emitterCause: unknown;
  constructor(cause: unknown) {
    super(
      'TAL-PA emitter unavailable — refusing to complete the operation. ' +
        'No platform action is performed when the audit-log subsystem is down ' +
        '(per TAL-PA doctrine §"No dark periods"). Restore the emitter to resume.',
    );
    this.name = 'AuditEmitterUnavailableError';
    this.emitterCause = cause;
  }
}

export async function withHaltOnFailure<T>(
  emit: () => Promise<unknown>,
  thenDo: () => Promise<T>,
): Promise<T> {
  try {
    await emit();
  } catch (err) {
    throw new AuditEmitterUnavailableError(err);
  }
  return thenDo();
}
