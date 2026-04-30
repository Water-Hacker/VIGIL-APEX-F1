/**
 * Parse and normalise the WEBAUTHN_RP_ORIGIN env var (AUDIT-038 fix).
 *
 * The variable is comma-separated. Each entry is normalised via
 * `new URL(...).origin` so that operationally-equivalent values
 * (`https://vigil.cm`, `https://vigil.cm/`, `https://vigil.cm:443`)
 * collapse to the same string the @simplewebauthn/server `verifyAuthentication`
 * call expects. Otherwise a deployment that happens to set
 * `WEBAUTHN_RP_ORIGIN=https://vigil.cm/` would reject every assertion
 * with origin-mismatch — a UX regression with no security benefit.
 *
 * Throws a typed error with a useful diagnostic on the first malformed
 * entry. The caller is expected to surface the error (request handler
 * → 500; module load → process exit).
 */

export class InvalidWebauthnOriginError extends Error {
  override readonly name = 'InvalidWebauthnOriginError';
  constructor(
    readonly bad: string,
    cause: unknown,
  ) {
    super(
      `WEBAUTHN_RP_ORIGIN entry "${bad}" is not a parseable URL: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
}

export function parseAllowedWebauthnOrigins(
  raw: string | undefined,
  fallbackRpId: string,
): string[] {
  if (!raw || raw.trim() === '') {
    return [`https://${fallbackRpId}`];
  }
  const out: string[] = [];
  for (const part of raw.split(',')) {
    const trimmed = part.trim();
    if (trimmed === '') continue;
    let origin: string;
    try {
      origin = new URL(trimmed).origin;
    } catch (e) {
      throw new InvalidWebauthnOriginError(trimmed, e);
    }
    if (!out.includes(origin)) out.push(origin);
  }
  if (out.length === 0) return [`https://${fallbackRpId}`];
  return out;
}
