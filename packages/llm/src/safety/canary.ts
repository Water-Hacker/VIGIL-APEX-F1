import { createHash } from 'node:crypto';

/**
 * Daily-rotated canary phrase for prompt-injection detection
 * (AI-SAFETY-DOCTRINE-v1 Failure Mode 4).
 *
 * The system prompt instructs Claude never to repeat the canary phrase. If
 * Claude ever emits the canary in its output, the system prompt has been
 * compromised by injected instructions and the response is quarantined.
 *
 * Determinism: the phrase is the SHA-256 of (date_utc + secret_seed),
 * truncated to a 12-character base32 token. Same date + same seed → same
 * phrase, so worker restarts within a single UTC day produce a stable
 * canary; the next UTC midnight rotates it.
 */

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function canaryFor(opts: { date?: Date; seed?: string } = {}): string {
  const date = opts.date ?? new Date();
  const ymd = date.toISOString().slice(0, 10);
  const seed = opts.seed ?? process.env.VIGIL_CANARY_SEED ?? 'vigil-default-canary-seed';
  const digest = createHash('sha256').update(`${ymd}|${seed}`).digest();
  let s = '';
  for (let i = 0; i < 12; i++) {
    s += BASE32[digest[i]! % 32];
  }
  return `VIGIL-CANARY-${s}`;
}

/** Detects whether a Claude output contains the daily canary — meaning the
 *  system prompt's "never reveal this phrase" instruction has been bypassed
 *  by injected adversarial content. */
export function canaryTriggered(output: string, date?: Date): boolean {
  return output.includes(canaryFor(date !== undefined ? { date } : {}));
}
