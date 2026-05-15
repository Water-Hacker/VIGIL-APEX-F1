import type { SubjectInput } from './types.js';
import type { Schemas } from '@vigil/shared';

/**
 * Event-extraction helpers shared across patterns that compute their
 * signals from `subject.events` rather than `subject.canonical.metadata`.
 *
 * The contract:
 *   - All helpers are pure functions of (subject) — no I/O, no clock.
 *   - All helpers tolerate missing payload fields (some adapters emit
 *     thin payloads when upstream sources don't expose the field).
 *   - Helpers return both the computed value AND the list of
 *     `contributing_event_ids` + `contributing_document_cids` so
 *     patterns can attach real evidence to every `matched()` result.
 *
 * Every metadata-only pattern was rewritten to use these helpers and
 * fall back to `subject.canonical.metadata.<key>` only when the
 * upstream event channel hasn't been wired yet. This means the
 * pattern fires correctly the moment the extractor populates the
 * relevant event payload — no second migration needed.
 */

export type Event = Schemas.SourceEvent;
export type EventKind = Schemas.SourceEventKind;

/** Filter events by one or more kinds. */
export function eventsOfKind(
  subject: SubjectInput,
  kinds: ReadonlyArray<EventKind>,
): ReadonlyArray<Event> {
  const set = new Set(kinds);
  return subject.events.filter((e) => set.has(e.kind));
}

/** Helper: best-effort number coercion from event payload. */
export function num(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/** Helper: best-effort string coercion from event payload. */
export function str(value: unknown): string | null {
  if (typeof value === 'string' && value.length > 0) return value;
  return null;
}

/** Helper: best-effort boolean coercion from event payload. */
export function bool(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    return value.toLowerCase() === 'true' || value === '1';
  }
  if (typeof value === 'number') return value !== 0;
  return false;
}

/**
 * Collect contributing IDs and document CIDs from a set of events.
 * Returns the de-duplicated arrays in the shape `matched()` expects.
 */
export function evidenceFrom(events: ReadonlyArray<Event>): {
  contributing_event_ids: ReadonlyArray<string>;
  contributing_document_cids: ReadonlyArray<string>;
} {
  const eIds = new Set<string>();
  const cids = new Set<string>();
  for (const e of events) {
    eIds.add(e.id);
    for (const c of e.document_cids) cids.add(c);
  }
  return {
    contributing_event_ids: [...eIds],
    contributing_document_cids: [...cids],
  };
}

/** Read a typed metadata field from `subject.canonical.metadata`. */
export function meta(subject: SubjectInput): Record<string, unknown> {
  return (subject.canonical?.metadata ?? {}) as Record<string, unknown>;
}

/** Sum of payment_order event amounts (in XAF). */
export function sumPayments(events: ReadonlyArray<Event>): number {
  let total = 0;
  for (const e of events) {
    const v = num(e.payload['amount_xaf']);
    if (v !== null) total += v;
  }
  return total;
}

/**
 * Sliding-window count: how many events of the given kind occurred in
 * the `windowDays` immediately before `at`. Used by burst-detection
 * patterns (sudden_mass_creation, burst_then_quiet).
 */
export function countInWindow(events: ReadonlyArray<Event>, at: Date, windowDays: number): number {
  const cutoff = at.getTime() - windowDays * 86_400_000;
  return events.filter((e) => Date.parse(e.observed_at) >= cutoff).length;
}

/**
 * Earliest / latest observed_at across a set of events.
 */
export function dateRange(events: ReadonlyArray<Event>): {
  earliest: number | null;
  latest: number | null;
} {
  if (events.length === 0) return { earliest: null, latest: null };
  let earliest = Infinity;
  let latest = -Infinity;
  for (const e of events) {
    const t = Date.parse(e.observed_at);
    if (Number.isFinite(t)) {
      if (t < earliest) earliest = t;
      if (t > latest) latest = t;
    }
  }
  return {
    earliest: earliest === Infinity ? null : earliest,
    latest: latest === -Infinity ? null : latest,
  };
}

/**
 * Look up a numeric field across a list of events (used when extractors
 * emit one event per filing — we want the most recent / max value).
 *
 * Returns the numeric value AND the contributing event(s) that produced it.
 */
export function maxNumericField(
  events: ReadonlyArray<Event>,
  fieldName: string,
): { value: number | null; contributors: ReadonlyArray<Event> } {
  let best: number | null = null;
  const contributors: Event[] = [];
  for (const e of events) {
    const v = num(e.payload[fieldName]);
    if (v === null) continue;
    if (best === null || v > best) {
      best = v;
      contributors.length = 0;
      contributors.push(e);
    } else if (v === best) {
      contributors.push(e);
    }
  }
  return { value: best, contributors };
}

/** Sum a numeric field across a list of events. */
export function sumNumericField(
  events: ReadonlyArray<Event>,
  fieldName: string,
): { value: number; contributors: ReadonlyArray<Event> } {
  let total = 0;
  const contributors: Event[] = [];
  for (const e of events) {
    const v = num(e.payload[fieldName]);
    if (v === null) continue;
    total += v;
    contributors.push(e);
  }
  return { value: total, contributors };
}

/** Find at least one event payload with `field` matching the predicate. */
export function findEventByField(
  events: ReadonlyArray<Event>,
  field: string,
  predicate: (v: unknown) => boolean,
): Event | null {
  for (const e of events) {
    if (predicate(e.payload[field])) return e;
  }
  return null;
}

/**
 * Read a numeric field from event payloads with a metadata fallback.
 *
 * Searches the requested event kinds for the given field name and
 * returns the most-recent value (by observed_at) plus the contributing
 * event. If no event carries the field, falls back to
 * `subject.canonical.metadata.<fallbackMetaKey>`.
 *
 * This is the canonical bridge that lets metadata-stub patterns become
 * event-aware without rewriting their logic — most patterns only need
 * to call this helper once, then threshold-check the result.
 */
export function readNumericWithFallback(
  subject: SubjectInput,
  fieldName: string,
  fallbackMetaKey: string,
  kinds: ReadonlyArray<EventKind>,
): { value: number; contributors: ReadonlyArray<Event>; from: 'event' | 'metadata' | 'none' } {
  const events = eventsOfKind(subject, kinds);
  let bestVal: number | null = null;
  let bestEvent: Event | null = null;
  for (const e of events) {
    const v = num(e.payload[fieldName]);
    if (v === null) continue;
    if (bestEvent === null || Date.parse(e.observed_at) > Date.parse(bestEvent.observed_at)) {
      bestVal = v;
      bestEvent = e;
    }
  }
  if (bestVal !== null && bestEvent !== null) {
    return { value: bestVal, contributors: [bestEvent], from: 'event' };
  }
  const v = num(meta(subject)[fallbackMetaKey]);
  if (v !== null) return { value: v, contributors: [], from: 'metadata' };
  return { value: 0, contributors: [], from: 'none' };
}

/**
 * Same as readNumericWithFallback but for boolean flags.
 */
export function readBoolWithFallback(
  subject: SubjectInput,
  fieldName: string,
  fallbackMetaKey: string,
  kinds: ReadonlyArray<EventKind>,
): { value: boolean; contributors: ReadonlyArray<Event>; from: 'event' | 'metadata' | 'none' } {
  const events = eventsOfKind(subject, kinds);
  for (const e of events) {
    if (e.payload[fieldName] !== undefined) {
      return { value: bool(e.payload[fieldName]), contributors: [e], from: 'event' };
    }
  }
  const m = meta(subject)[fallbackMetaKey];
  if (m !== undefined) return { value: bool(m), contributors: [], from: 'metadata' };
  return { value: false, contributors: [], from: 'none' };
}
