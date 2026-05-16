/**
 * Tier-0 audit — input gate at HashChain.append boundary.
 *
 * The collision attack we're defending against:
 *   canonical(event) = `<seq>|<action>|<actor>|<subject_kind>|<subject_id>|<occurred_at>|<json>`
 * A crafted actor like "alice|fake-kind|fake-id" can shift the |-separated
 * field layout to produce the same canonical string as a different logical
 * event with actor="alice", subject_kind="fake-kind", subject_id="fake-id".
 * Same canonical → same body_hash → forgery undetectable by hash check.
 *
 * The collision-proof fix would be a v2 canonicalisation (length-prefixed
 * or JSON-object hash). That breaks every already-recorded row and the
 * offline-verify CSV format. The write-side input gate is equivalently
 * effective AND compatibility-preserving: reject any input that COULD
 * trigger a collision, before it ever enters the chain.
 *
 * These tests pin the gate behaviour as a pure function — no Postgres
 * connection required. The HashChain.append() integration is exercised
 * by the existing repos integration suite once Postgres is available.
 */

import { describe, expect, it } from 'vitest';

import { FORBIDDEN_IN_AUDIT_FIELD, gateAuditField } from '../src/hash-chain.js';

describe('gateAuditField — Tier-0 collision defence', () => {
  it('accepts a clean actor unchanged', () => {
    expect(gateAuditField('actor', 'worker-pattern')).toBe('worker-pattern');
  });

  it('accepts a UUID-shaped subject_id unchanged', () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000';
    expect(gateAuditField('subject_id', uuid)).toBe(uuid);
  });

  it('rejects an actor containing `|` (the canonical separator)', () => {
    expect(() => gateAuditField('actor', 'alice|fake-kind|fake-id')).toThrow(
      /forbidden canonical-separator/,
    );
  });

  it('rejects a subject_id containing `|` (same defence on the other field)', () => {
    expect(() => gateAuditField('subject_id', 'id|injection')).toThrow(
      /forbidden canonical-separator/,
    );
  });

  it('rejects a NUL byte (Postgres text columns reject these too — be explicit)', () => {
    expect(() => gateAuditField('actor', 'alice\x00bob')).toThrow(/forbidden canonical-separator/);
  });

  it('throws an AuditChainError with the structured code AUDIT_FORBIDDEN_FIELD_CHAR', () => {
    let caught: unknown;
    try {
      gateAuditField('actor', 'a|b');
    } catch (e) {
      caught = e;
    }
    expect((caught as { code?: string }).code).toBe('AUDIT_FORBIDDEN_FIELD_CHAR');
  });

  it('normalises NFC: a precomposed string is unchanged', () => {
    // "café" precomposed — single code point U+00E9 for é.
    const precomposed = 'café';
    expect(gateAuditField('actor', precomposed)).toBe(precomposed);
  });

  it('normalises NFC: a decomposed string is converted to precomposed', () => {
    // "café" decomposed — e + combining acute U+0301.
    const decomposed = 'café';
    const result = gateAuditField('actor', decomposed);
    // Result is NFC-normalised to the precomposed form.
    expect(result).toBe('café');
    // Same bytes as the precomposed reference.
    expect(result.normalize('NFC')).toBe(result);
  });

  it('allows newline characters (not separators, may appear in legitimate strings)', () => {
    // The forbidden regex is just `|` and NUL; \n is allowed.
    expect(gateAuditField('actor', 'multi\nline')).toBe('multi\nline');
  });

  it('allows tabs (same rationale)', () => {
    expect(gateAuditField('actor', 'with\ttab')).toBe('with\ttab');
  });
});

describe('FORBIDDEN_IN_AUDIT_FIELD regex shape', () => {
  it('matches the pipe character', () => {
    expect(FORBIDDEN_IN_AUDIT_FIELD.test('a|b')).toBe(true);
  });

  it('matches the NUL byte', () => {
    expect(FORBIDDEN_IN_AUDIT_FIELD.test('a\x00b')).toBe(true);
  });

  it('does not match the empty string', () => {
    expect(FORBIDDEN_IN_AUDIT_FIELD.test('')).toBe(false);
  });

  it('does not match other separator-shaped chars (defence is targeted, not over-broad)', () => {
    expect(FORBIDDEN_IN_AUDIT_FIELD.test(':')).toBe(false);
    expect(FORBIDDEN_IN_AUDIT_FIELD.test(';')).toBe(false);
    expect(FORBIDDEN_IN_AUDIT_FIELD.test(' ')).toBe(false);
    expect(FORBIDDEN_IN_AUDIT_FIELD.test('\n')).toBe(false);
    expect(FORBIDDEN_IN_AUDIT_FIELD.test('\t')).toBe(false);
  });
});
