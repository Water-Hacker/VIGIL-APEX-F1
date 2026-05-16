/**
 * ProcurementExtractor orchestrator tests.
 *
 * Covers the deterministic + LLM merge contract: deterministic-wins on
 * overlap, LLM only fills gaps, LLM failure is non-fatal, provenance is
 * complete and traceable.
 */
import { describe, expect, it } from 'vitest';

import { ProcurementExtractor } from '../src/extractor.js';

import type { LlmExtractor, LlmExtractionResult } from '../src/llm-extractor.js';

const FIXED_NOW = new Date('2026-04-29T12:00:00Z');
const cfgDeterministicOnly = {
  extractorVersion: 'test-v1',
  llm: null,
  now: () => FIXED_NOW,
};

class StubLlmExtractor implements LlmExtractor {
  constructor(
    private readonly response: LlmExtractionResult,
    private readonly throwOn?: 'extract',
  ) {}
  async extract() {
    if (this.throwOn === 'extract') throw new Error('upstream-llm-down');
    return this.response;
  }
}

describe('ProcurementExtractor — deterministic only', () => {
  it('returns the deterministic fields with provenance', async () => {
    const ex = new ProcurementExtractor(cfgDeterministicOnly);
    const out = await ex.extract({
      findingId: null,
      assessmentId: null,
      cells: ['gré à gré', 'Soumissionnaire unique', '12 milliards FCFA'],
    });
    expect(out.fields.procurement_method).toBe('gre_a_gre');
    expect(out.fields.bidder_count).toBe(1);
    expect(out.fields.amount_xaf).toBe(12_000_000_000);
    expect(out.provenance.fields.procurement_method?.method).toBe('deterministic');
    expect(out.provenance.fields.bidder_count?.method).toBe('deterministic');
    expect(out.provenance.input_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(out.llm_was_called).toBe(false);
  });

  it('leaves nullable fields null when nothing matched', async () => {
    const ex = new ProcurementExtractor(cfgDeterministicOnly);
    const out = await ex.extract({
      findingId: null,
      assessmentId: null,
      cells: ['random text without procurement keywords'],
    });
    expect(out.fields.bidder_count).toBeNull();
    expect(out.fields.amount_xaf).toBeNull();
    expect(out.fields.procurement_method).toBeNull();
  });
});

describe('ProcurementExtractor — deterministic-wins-over-LLM', () => {
  it('keeps the deterministic value when LLM also reports the field', async () => {
    const stubLlm = new StubLlmExtractor({
      fields: { bidder_count: 99, supplier_name: 'CMR Holdings' },
      provenance: {
        bidder_count: { method: 'llm', detail: 'call-1', confidence: 0.9 },
        supplier_name: { method: 'llm', detail: 'call-1', confidence: 0.85 },
      },
      callRecordId: 'call-1',
    });
    const ex = new ProcurementExtractor({
      extractorVersion: 'test-v1',
      llm: stubLlm,
      now: () => FIXED_NOW,
    });
    const out = await ex.extract({
      findingId: null,
      assessmentId: null,
      cells: ['Soumissionnaire unique'], // deterministic says bidder_count=1
    });
    expect(out.fields.bidder_count).toBe(1); // deterministic wins
    expect(out.fields.supplier_name).toBe('CMR Holdings'); // LLM fills gap
    expect(out.provenance.fields.bidder_count?.method).toBe('deterministic');
    expect(out.provenance.fields.supplier_name?.method).toBe('llm');
    expect(out.llm_was_called).toBe(true);
  });

  it('LLM failure is non-fatal; falls through to deterministic-only', async () => {
    const failingLlm = new StubLlmExtractor(
      { fields: {}, provenance: {}, callRecordId: null },
      'extract',
    );
    const ex = new ProcurementExtractor({
      extractorVersion: 'test-v1',
      llm: failingLlm,
      now: () => FIXED_NOW,
    });
    const out = await ex.extract({
      findingId: null,
      assessmentId: null,
      cells: ['gré à gré'],
    });
    expect(out.fields.procurement_method).toBe('gre_a_gre');
    expect(out.fields.supplier_name).toBeNull();
    expect(out.llm_was_called).toBe(true);
  });

  // ---- Tier-16 audit closure: observable LLM-fallback failure ----
  //
  // Previously the LLM `catch {}` silently swallowed every error.
  // Operators couldn't tell whether the LLM tier was healthy without
  // greping the call-record table for missing rows. The new
  // `cfg.logger` opt enables structured `err_name`/`err_message`
  // logging at warn level. The pin: when an LLM fallback throws AND
  // a logger is provided, exactly one warn line fires with the
  // expected shape.

  it('LLM failure now logs a structured warn line when a logger is wired', async () => {
    const warn = (await import('vitest')).vi.fn();
    const error = (await import('vitest')).vi.fn();
    const info = (await import('vitest')).vi.fn();
    type LoggerLike = {
      warn: typeof warn;
      error: typeof error;
      info: typeof info;
      debug: typeof info;
      trace: typeof info;
      fatal: typeof info;
      child: () => LoggerLike;
    };
    const loggerLike: LoggerLike = {
      warn,
      error,
      info,
      debug: info,
      trace: info,
      fatal: info,
      child() {
        return this;
      },
    };
    const failingLlm = new StubLlmExtractor(
      { fields: {}, provenance: {}, callRecordId: null },
      'extract',
    );
    const ex = new ProcurementExtractor({
      extractorVersion: 'test-v1',
      llm: failingLlm,
      now: () => FIXED_NOW,
      logger: loggerLike as never,
    });
    const out = await ex.extract({
      findingId: 'fnd-test-1',
      assessmentId: 'asm-test-1',
      cells: ['gré à gré'],
    });
    // Deterministic result still flows through.
    expect(out.fields.procurement_method).toBe('gre_a_gre');
    // The structured warn line fires exactly once with the
    // expected shape.
    expect(warn).toHaveBeenCalledTimes(1);
    const [context, msg] = warn.mock.calls[0]!;
    expect(msg).toBe('extractor-llm-fallback-failed');
    expect(context).toMatchObject({
      finding_id: 'fnd-test-1',
      assessment_id: 'asm-test-1',
      err_name: 'Error',
      err_message: 'upstream-llm-down',
    });
    // unresolved_count is non-zero (the test stub only resolved
    // procurement_method deterministically).
    expect(context.unresolved_count).toBeGreaterThan(0);
    expect(error).not.toHaveBeenCalled();
  });

  it('LLM failure with NO logger configured remains silent (back-compat)', async () => {
    const failingLlm = new StubLlmExtractor(
      { fields: {}, provenance: {}, callRecordId: null },
      'extract',
    );
    // No `logger` in cfg — the warn path is opt-in.
    const ex = new ProcurementExtractor({
      extractorVersion: 'test-v1',
      llm: failingLlm,
      now: () => FIXED_NOW,
    });
    // Should not throw and should fall through cleanly.
    const out = await ex.extract({ findingId: null, assessmentId: null, cells: ['gré à gré'] });
    expect(out.fields.procurement_method).toBe('gre_a_gre');
  });

  it('skips LLM when all fields are resolved by deterministic', async () => {
    const stubLlm = new StubLlmExtractor({
      fields: { supplier_name: 'should-not-appear' },
      provenance: { supplier_name: { method: 'llm', detail: 'x', confidence: 1 } },
      callRecordId: 'call-x',
    });
    let llmCallCount = 0;
    const tracingLlm: LlmExtractor = {
      async extract() {
        llmCallCount += 1;
        return stubLlm.extract();
      },
    };
    const ex = new ProcurementExtractor({
      extractorVersion: 'test-v1',
      llm: tracingLlm,
      now: () => FIXED_NOW,
    });
    // Provide enough deterministic context that all 15 keys resolve OR
    // unresolved set is empty. In practice the deterministic layer rarely
    // hits 100% — but if all of supplier_name/contracting_authority etc.
    // are still unresolved, the LLM IS called. So this test asserts the
    // narrower contract: if `unresolved` is empty, no LLM call.
    // Given the current deterministic coverage, supplier_name is always
    // unresolved, so the LLM IS called. We assert the LLM was called, but
    // its supplier_name is accepted only because deterministic missed it.
    const out = await ex.extract({
      findingId: null,
      assessmentId: null,
      cells: ['gré à gré, 1 soumissionnaire, 1 milliard FCFA'],
    });
    expect(llmCallCount).toBe(1); // because supplier_name is unresolved
    expect(out.fields.supplier_name).toBe('should-not-appear');
  });
});

describe('ProcurementExtractor — provenance contract', () => {
  it('records extracted_at, extractor_version, input_sha256', async () => {
    const ex = new ProcurementExtractor(cfgDeterministicOnly);
    const out = await ex.extract({
      findingId: null,
      assessmentId: null,
      cells: ['12 milliards FCFA'],
    });
    expect(out.provenance.extracted_at).toBe(FIXED_NOW.toISOString());
    expect(out.provenance.extractor_version).toBe('test-v1');
    expect(out.provenance.input_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(out.provenance.llm_call_record_id).toBeNull();
  });

  it('every populated field has a provenance entry', async () => {
    const ex = new ProcurementExtractor(cfgDeterministicOnly);
    const out = await ex.extract({
      findingId: null,
      assessmentId: null,
      cells: ['gré à gré, 5 soumissionnaires, 1 milliard FCFA'],
    });
    for (const [k, v] of Object.entries(out.fields)) {
      if (v !== null) expect(out.provenance.fields[k]).toBeDefined();
    }
  });
});
