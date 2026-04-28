import { Ids, type Schemas } from '@vigil/shared';

/**
 * Per-file helpers used by every PatternDef.detect() to keep pattern files
 * focused on their detection logic rather than result envelope plumbing.
 */

type Result = Schemas.PatternResult;

/** A canonical "matched=false" result builder. */
export function notMatched(patternId: Ids.PatternId, reason: string): Result {
  return {
    pattern_id: patternId,
    matched: false,
    strength: 0,
    contributing_event_ids: [],
    contributing_document_cids: [],
    rationale: reason,
  };
}

/** A canonical "matched" result builder. */
export function matched(opts: {
  pattern_id: Ids.PatternId;
  strength: number;
  contributing_event_ids?: ReadonlyArray<string>;
  contributing_document_cids?: ReadonlyArray<string>;
  rationale: string;
  matchAt?: number; // strength threshold for `matched: true`
}): Result {
  const at = opts.matchAt ?? 0.5;
  return {
    pattern_id: opts.pattern_id,
    matched: opts.strength >= at,
    strength: Math.min(1, Math.max(0, opts.strength)),
    contributing_event_ids: [...(opts.contributing_event_ids ?? [])],
    contributing_document_cids: [...(opts.contributing_document_cids ?? [])],
    rationale: opts.rationale,
  };
}

/** Convenience: convert a string to a `PatternId` once at the top of each file. */
export const PID = (s: string): Ids.PatternId => Ids.asPatternId(s);
