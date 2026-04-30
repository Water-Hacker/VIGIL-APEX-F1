/**
 * Pattern dispatch — the single chokepoint every pattern detection passes
 * through, providing the elite-grade safety properties:
 *
 *   1. **No-throw guarantee.** A pattern's detect() that throws is caught,
 *      converted to a `notMatched` result, and the exception is surfaced
 *      via `failures[]` for the caller's observability. One pattern's bug
 *      cannot poison the rest of the dispatch.
 *
 *   2. **Per-pattern resource budget.** Every detect() runs with a hard
 *      `timeoutMs` budget (default 2000 ms). A pattern that exceeds it is
 *      cancelled (best-effort — JS doesn't expose true preemption — but
 *      the Promise.race guarantees the dispatch loop continues).
 *
 *   3. **Bounded fan-out.** No more than `maxConcurrent` patterns run in
 *      parallel for a given subject. Default 8 — matches typical worker
 *      concurrency without overwhelming the Postgres connection pool.
 *
 *   4. **Subject-kind gate.** Patterns whose `subjectKinds` don't include
 *      the subject's kind are short-circuited without entering detect().
 *
 *   5. **Status gate.** Only `live` patterns return into the public
 *      result set. `shadow` patterns still run (so we observe them) but
 *      their results land under `shadowResults[]` and are not promoted
 *      into findings.
 *
 *   6. **Provenance stamping.** Every PatternResult is annotated with
 *      `dispatch_timing_ms` and `dispatch_pattern_status` so downstream
 *      audit can verify which pattern set actually ran.
 *
 *   7. **Deterministic ordering.** Results are sorted by pattern_id so
 *      the audit hash chain stays stable across re-runs of the same
 *      input.
 */

import { PatternRegistry } from './registry.js';

import type { PatternContext, PatternDef, PatternStatus, SubjectInput } from './types.js';
import type { Schemas } from '@vigil/shared';

export interface PatternDispatchOptions {
  /** Max wall-clock time per pattern in milliseconds. Default 2000. */
  readonly timeoutMs?: number;
  /** Max patterns running in parallel per subject. Default 8. */
  readonly maxConcurrent?: number;
  /** Set to false to skip patterns with `status: 'shadow'`. Default true. */
  readonly includeShadow?: boolean;
  /** Override the source of patterns. Defaults to the global PatternRegistry.
   *  Tests inject an in-memory list to avoid singleton coupling. */
  readonly patterns?: ReadonlyArray<PatternDef>;
}

export interface PatternDispatchResult {
  /** Live + matched=true|false results from `live`-status patterns. */
  readonly results: ReadonlyArray<Schemas.PatternResult & DispatchAnnotation>;
  /** Results from patterns whose status is `shadow` — surfaced for audit
   *  but NOT folded into findings. */
  readonly shadowResults: ReadonlyArray<Schemas.PatternResult & DispatchAnnotation>;
  /** Patterns that threw OR exceeded their timeout. */
  readonly failures: ReadonlyArray<{
    readonly patternId: string;
    readonly reason: 'threw' | 'timeout' | 'invalid-result';
    readonly detail: string;
  }>;
  /** Total wall-clock the dispatch took. */
  readonly totalMs: number;
}

export interface DispatchAnnotation {
  readonly dispatch_timing_ms: number;
  readonly dispatch_pattern_status: PatternStatus;
}

const DEFAULT_TIMEOUT_MS = 2000;
const DEFAULT_MAX_CONCURRENT = 8;

/**
 * Dispatch every applicable pattern against a subject. Returns the full
 * result set including failures, partitioned by `live` / `shadow` status.
 *
 * Caller (worker-pattern) typically just consumes `results`; `shadowResults`
 * goes to a separate audit stream; `failures[]` is logged + alerted on.
 */
export async function dispatchPatterns(
  subject: SubjectInput,
  ctx: PatternContext,
  opts: PatternDispatchOptions = {},
): Promise<PatternDispatchResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxConcurrent = opts.maxConcurrent ?? DEFAULT_MAX_CONCURRENT;
  const includeShadow = opts.includeShadow ?? true;

  const candidates =
    opts.patterns !== undefined
      ? opts.patterns.filter(
          (p) => p.subjectKinds.includes(subject.kind) && p.status !== 'deprecated',
        )
      : PatternRegistry.applicableTo(subject.kind);
  const filtered = candidates.filter((p) => includeShadow || p.status !== 'shadow');
  // Deterministic order by id so audit chain hash is stable.
  const ordered = [...filtered].sort((a, b) => a.id.localeCompare(b.id));

  const start = Date.now();
  const results: Array<Schemas.PatternResult & DispatchAnnotation> = [];
  const shadowResults: Array<Schemas.PatternResult & DispatchAnnotation> = [];
  const failures: Array<{
    patternId: string;
    reason: 'threw' | 'timeout' | 'invalid-result';
    detail: string;
  }> = [];

  // Bounded concurrency loop
  for (let i = 0; i < ordered.length; i += maxConcurrent) {
    const batch = ordered.slice(i, i + maxConcurrent);
    const settled = await Promise.all(batch.map((def) => runOne(def, subject, ctx, timeoutMs)));
    for (const s of settled) {
      if (s.kind === 'failure') {
        failures.push({ patternId: s.patternId, reason: s.reason, detail: s.detail });
        continue;
      }
      const annotated = {
        ...s.result,
        dispatch_timing_ms: s.elapsedMs,
        dispatch_pattern_status: s.status,
      };
      if (s.status === 'shadow') {
        shadowResults.push(annotated);
      } else if (s.status === 'live') {
        results.push(annotated);
      }
      // 'deprecated' patterns are silently dropped from both result sets
    }
  }

  return {
    results,
    shadowResults,
    failures,
    totalMs: Date.now() - start,
  };
}

interface RunSuccess {
  kind: 'success';
  patternId: string;
  status: PatternStatus;
  result: Schemas.PatternResult;
  elapsedMs: number;
}

interface RunFailure {
  kind: 'failure';
  patternId: string;
  reason: 'threw' | 'timeout' | 'invalid-result';
  detail: string;
}

async function runOne(
  def: PatternDef,
  subject: SubjectInput,
  ctx: PatternContext,
  timeoutMs: number,
): Promise<RunSuccess | RunFailure> {
  const start = Date.now();
  try {
    const result = await Promise.race([
      def.detect(subject, ctx),
      timeoutPromise(timeoutMs, def.id),
    ]);
    const elapsedMs = Date.now() - start;
    if (!isValidPatternResult(result, def.id)) {
      return {
        kind: 'failure',
        patternId: def.id,
        reason: 'invalid-result',
        detail: `pattern returned ${typeof result}; expected PatternResult`,
      };
    }
    return { kind: 'success', patternId: def.id, status: def.status, result, elapsedMs };
  } catch (err) {
    const elapsed = Date.now() - start;
    if (err instanceof TimeoutError) {
      return {
        kind: 'failure',
        patternId: def.id,
        reason: 'timeout',
        detail: `exceeded ${timeoutMs}ms (took ≥${elapsed}ms)`,
      };
    }
    return {
      kind: 'failure',
      patternId: def.id,
      reason: 'threw',
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

class TimeoutError extends Error {
  constructor(public readonly patternId: string) {
    super(`pattern ${patternId} timed out`);
  }
}

function timeoutPromise(ms: number, patternId: string): Promise<never> {
  return new Promise((_, reject) => setTimeout(() => reject(new TimeoutError(patternId)), ms));
}

/**
 * Run-time validation of the result shape. Type-system trust is great in
 * the abstract; in practice a buggy pattern can return undefined or a
 * partial object. We refuse to propagate those.
 */
function isValidPatternResult(r: unknown, patternId: string): r is Schemas.PatternResult {
  if (typeof r !== 'object' || r === null) return false;
  const x = r as Partial<Schemas.PatternResult> & Record<string, unknown>;
  if (x.pattern_id !== patternId) return false;
  if (typeof x.matched !== 'boolean') return false;
  if (typeof x.strength !== 'number' || !Number.isFinite(x.strength)) return false;
  if (x.strength < 0 || x.strength > 1) return false;
  if (!Array.isArray(x.contributing_event_ids)) return false;
  if (!Array.isArray(x.contributing_document_cids)) return false;
  if (typeof x.rationale !== 'string') return false;
  return true;
}

/**
 * Type-safe accessor for `event.payload[key]` — every pattern that reads
 * a structured field should use this rather than indexing the payload
 * directly. Returns null when the key is missing OR the value is null
 * OR the value's type doesn't match the requested narrowing.
 *
 * Usage:
 *   const bidderCount = readNumber(event.payload, 'bidder_count');
 *   const method = readString(event.payload, 'procurement_method');
 *
 * Provides defense-in-depth against payload corruption / adapter bugs.
 */
export function readNumber(payload: Record<string, unknown>, key: string): number | null {
  const v = payload[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export function readString(payload: Record<string, unknown>, key: string): string | null {
  const v = payload[key];
  return typeof v === 'string' && v.length > 0 ? v : null;
}

export function readBoolean(payload: Record<string, unknown>, key: string): boolean | null {
  const v = payload[key];
  return typeof v === 'boolean' ? v : null;
}

export function readStringArray(
  payload: Record<string, unknown>,
  key: string,
): ReadonlyArray<string> | null {
  const v = payload[key];
  if (!Array.isArray(v)) return null;
  const out: string[] = [];
  for (const item of v) {
    if (typeof item === 'string' && item.length > 0) out.push(item);
  }
  return out.length > 0 ? out : null;
}

/** Type-safe entity-metadata accessors with the same contract. */
export function readMetadataNumber(
  meta: Record<string, unknown> | undefined,
  key: string,
): number | null {
  if (!meta) return null;
  return readNumber(meta, key);
}

export function readMetadataBoolean(
  meta: Record<string, unknown> | undefined,
  key: string,
): boolean | null {
  if (!meta) return null;
  return readBoolean(meta, key);
}
