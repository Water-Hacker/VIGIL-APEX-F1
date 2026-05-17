/**
 * T6 of TODO.md sweep — pin the per-function contract of L1/L2/L3 guards.
 *
 * The existing `hallucinations.test.ts` exercises the guards through the
 * corpus runner; this test pins the FUNCTION-LEVEL contract for the
 * three citation-grounded layers. A future refactor of `guards.ts` that
 * accidentally widens a rejection (false positive) or narrows it (false
 * negative) at the boundary will fire here even when the corpus row
 * doesn't.
 *
 * Per AI-SAFETY-DOCTRINE-v1, L1/L2/L3 are the foundational layers that
 * citation-required and CID-in-context guarantee the LLM's output is
 * traceable back to provided source bytes. They run on every SafeLlmRouter
 * call.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  l1SchemaCompliance,
  l2CitationRequired,
  l3CidInContext,
  type GuardContext,
} from '../src/guards.js';

const makeCtx = (overrides: Partial<GuardContext> = {}): GuardContext => ({
  providedDocumentCids: [],
  sourceTexts: new Map<string, string>(),
  responseSchema: undefined,
  task: 'test-task',
  temperatureUsed: 0,
  temperatureMax: 0.2,
  ...overrides,
});

/* -------------------------------------------------------------------------- */
/* L1 schema_compliance                                                        */
/* -------------------------------------------------------------------------- */

describe('l1SchemaCompliance — Zod parse boundary', () => {
  const schema = z.object({
    kind: z.enum(['award', 'tender']),
    confidence: z.number().min(0).max(1),
    rationale: z.string().min(1).max(500),
  });

  it('passes when content matches the declared schema', () => {
    const ctx = makeCtx({ responseSchema: schema });
    const r = l1SchemaCompliance({ kind: 'award', confidence: 0.85, rationale: 'ok' }, ctx);
    expect(r.passed).toBe(true);
    expect(r.layer).toBe('L1');
  });

  it('fails when a required field is missing', () => {
    const ctx = makeCtx({ responseSchema: schema });
    const r = l1SchemaCompliance({ kind: 'award' }, ctx);
    expect(r.passed).toBe(false);
    expect(r.layer).toBe('L1');
    expect(r.reason).toBeTruthy();
  });

  it('fails when a field has the wrong type (confidence as string)', () => {
    const ctx = makeCtx({ responseSchema: schema });
    const r = l1SchemaCompliance({ kind: 'award', confidence: 'high', rationale: 'x' }, ctx);
    expect(r.passed).toBe(false);
    expect(r.reason).toMatch(/Expected number|number, received/);
  });

  it('fails when an enum value is out-of-range', () => {
    const ctx = makeCtx({ responseSchema: schema });
    const r = l1SchemaCompliance({ kind: 'unknown_kind', confidence: 0.9, rationale: 'x' }, ctx);
    expect(r.passed).toBe(false);
  });

  it('passes when no schema is declared (skip path)', () => {
    const ctx = makeCtx({ responseSchema: undefined });
    expect(l1SchemaCompliance({ anything: 'goes' }, ctx).passed).toBe(true);
  });

  it('truncates reason to ≤ 3 Zod issues (operator-readability invariant)', () => {
    const wide = z.object({
      a: z.string(),
      b: z.string(),
      c: z.string(),
      d: z.string(),
      e: z.string(),
    });
    const ctx = makeCtx({ responseSchema: wide });
    const r = l1SchemaCompliance({}, ctx);
    expect(r.passed).toBe(false);
    expect((r.reason ?? '').split(';').length).toBeLessThanOrEqual(3);
  });
});

/* -------------------------------------------------------------------------- */
/* L2 citation_required                                                        */
/* -------------------------------------------------------------------------- */

describe('l2CitationRequired — every fact needs a document_cid or insufficient_evidence', () => {
  // Base32 CIDv1 form ("b" prefix + ≥55 base32 chars).
  const CID = 'bafybeiczsscdsbs7ffqz55asqdf3smv6klcw3gofszvwlyarci47bgf354';

  it('passes when output carries a document_cid', () => {
    const r = l2CitationRequired({
      items: [{ value: 'X', document_cid: CID, page: 1, char_span: [0, 5] }],
    });
    expect(r.passed).toBe(true);
  });

  it('passes when output is an insufficient_evidence shape', () => {
    const r = l2CitationRequired({
      status: 'insufficient_evidence',
      reason: 'no source contains the requested field',
    });
    expect(r.passed).toBe(true);
  });

  it('rejects when output has facts but zero document_cid (the hallucination case)', () => {
    const r = l2CitationRequired({
      items: [{ value: 'fabricated entity', confidence: 0.9 }],
    });
    expect(r.passed).toBe(false);
    expect(r.layer).toBe('L2');
    expect(r.reason).toContain('document_cid');
  });

  it('uses a non-global regex (no lastIndex carryover between calls)', () => {
    // Critical: this is a documented anti-pattern callout in guards.ts —
    // a /g regex would skip a match on the second call. Run the same
    // input twice; both must yield identical results.
    const input = { items: [{ value: 'X', document_cid: CID }] };
    const a = l2CitationRequired(input);
    const b = l2CitationRequired(input);
    expect(a.passed).toBe(b.passed);
    expect(a.passed).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* L3 cid_in_context                                                           */
/* -------------------------------------------------------------------------- */

describe('l3CidInContext — every cited cid was in the prompt context', () => {
  const CID_A = 'bafybeiczsscdsbs7ffqz55asqdf3smv6klcw3gofszvwlyarci47bgf354';
  const CID_B = 'bafybeih2gqu3xrqpzpr5vyi2pfqu4kxyhppkkxr2dgkbsupgkwslpz4hsy';

  it('passes when every cited cid is in providedDocumentCids', () => {
    const ctx = makeCtx({ providedDocumentCids: [CID_A, CID_B] });
    const r = l3CidInContext({ items: [{ document_cid: CID_A }] }, ctx);
    expect(r.passed).toBe(true);
  });

  it('rejects when a cited cid was never provided (the classic forge)', () => {
    const ctx = makeCtx({ providedDocumentCids: [CID_A] });
    const r = l3CidInContext({ items: [{ document_cid: CID_B }] }, ctx);
    expect(r.passed).toBe(false);
    expect(r.layer).toBe('L3');
    expect(r.reason).toContain(CID_B);
  });

  it('passes when content has no cids at all (delegates rejection to L2)', () => {
    const ctx = makeCtx({ providedDocumentCids: [] });
    expect(l3CidInContext({ items: [{ value: 'X' }] }, ctx).passed).toBe(true);
  });

  it('rejects when ANY cited cid is missing, even if others match', () => {
    const ctx = makeCtx({ providedDocumentCids: [CID_A] });
    const r = l3CidInContext({ items: [{ document_cid: CID_A }, { document_cid: CID_B }] }, ctx);
    expect(r.passed).toBe(false);
    // The cid named in the reason must be the one that was missing.
    expect(r.reason).toContain(CID_B);
  });

  it('walks all matches via the /g regex (multi-cid extraction)', () => {
    const ctx = makeCtx({ providedDocumentCids: [CID_A, CID_B] });
    // Two cids in the SAME output — both must be checked.
    const r = l3CidInContext({ items: [{ document_cid: CID_A }, { document_cid: CID_B }] }, ctx);
    expect(r.passed).toBe(true);
  });
});
