/**
 * Tier-23 audit closure — pattern-worker payload caps.
 *
 * Pre-T23 the `related_ids` and `event_ids` arrays were unbounded.
 * A malicious or buggy upstream emitting an envelope with 10k uuids
 * would issue a single `IN (...)` query with 10k bindings against
 * entity.canonical / source.events. These tests pin the new
 * 256-id ceiling per payload.
 */
import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  MAX_EVENT_IDS_PER_PAYLOAD,
  MAX_RELATED_IDS_PER_PAYLOAD,
  zEntitySubject,
} from '../src/index.js';

function uuidArray(n: number): string[] {
  return Array.from({ length: n }, () => randomUUID());
}

describe('zEntitySubject payload caps (Tier-23)', () => {
  it('accepts a payload with the maximum allowed related_ids', () => {
    const parsed = zEntitySubject.safeParse({
      subject_kind: 'Company',
      canonical_id: randomUUID(),
      related_ids: uuidArray(MAX_RELATED_IDS_PER_PAYLOAD),
      event_ids: [],
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects a payload with one more related_id than the cap', () => {
    const parsed = zEntitySubject.safeParse({
      subject_kind: 'Company',
      canonical_id: randomUUID(),
      related_ids: uuidArray(MAX_RELATED_IDS_PER_PAYLOAD + 1),
      event_ids: [],
    });
    expect(parsed.success).toBe(false);
  });

  it('accepts a payload with the maximum allowed event_ids', () => {
    const parsed = zEntitySubject.safeParse({
      subject_kind: 'Company',
      canonical_id: randomUUID(),
      related_ids: [],
      event_ids: uuidArray(MAX_EVENT_IDS_PER_PAYLOAD),
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects a payload with one more event_id than the cap', () => {
    const parsed = zEntitySubject.safeParse({
      subject_kind: 'Company',
      canonical_id: randomUUID(),
      related_ids: [],
      event_ids: uuidArray(MAX_EVENT_IDS_PER_PAYLOAD + 1),
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects a payload with 10k related_ids (DoS-via-IN-clause vector)', () => {
    const parsed = zEntitySubject.safeParse({
      subject_kind: 'Company',
      canonical_id: randomUUID(),
      related_ids: uuidArray(10_000),
      event_ids: [],
    });
    expect(parsed.success).toBe(false);
  });

  it('keeps both caps at 256 — pinning the value so a future bump is intentional', () => {
    // If you change either constant, ALSO update the rationale in
    // apps/worker-pattern/src/index.ts and confirm the IN-clause sizing
    // against entity.canonical / source.events is still safe.
    expect(MAX_RELATED_IDS_PER_PAYLOAD).toBe(256);
    expect(MAX_EVENT_IDS_PER_PAYLOAD).toBe(256);
  });
});
