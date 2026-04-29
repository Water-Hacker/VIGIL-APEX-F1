import { describe, expect, it } from 'vitest';

import {
  canaryFor,
  canaryTriggered,
  globalPromptRegistry,
  PromptRegistry,
  renderClosedContext,
  validateVerbatimGrounding,
  type CitedExtraction,
  type SourceRecordIndex,
} from '../src/safety/index.js';

const FIXED_DATE = new Date('2026-04-29T00:00:00Z');

describe('canaryFor', () => {
  it('is deterministic for the same UTC date', () => {
    expect(canaryFor({ date: FIXED_DATE })).toEqual(canaryFor({ date: FIXED_DATE }));
  });
  it('rotates between UTC dates', () => {
    const a = canaryFor({ date: new Date('2026-04-29T00:00:00Z') });
    const b = canaryFor({ date: new Date('2026-04-30T00:00:00Z') });
    expect(a).not.toEqual(b);
  });
  it('starts with VIGIL-CANARY- and matches a fixed shape', () => {
    expect(canaryFor({ date: FIXED_DATE })).toMatch(/^VIGIL-CANARY-[A-Z2-7]{12}$/);
  });
});

describe('canaryTriggered', () => {
  it('detects the canary in output', () => {
    const phrase = canaryFor({ date: FIXED_DATE });
    expect(canaryTriggered(`hello ${phrase} world`, FIXED_DATE)).toBe(true);
  });
  it('does not falsely trigger on benign output', () => {
    expect(canaryTriggered('benign output', FIXED_DATE)).toBe(false);
  });
});

describe('renderClosedContext', () => {
  it('wraps each source in <source_document> markers and includes the canary in the system preamble', () => {
    const r = renderClosedContext({
      task: 'Extract awarded contractor names.',
      sources: [
        { id: 'rec-1', label: 'ARMP listing', text: 'Contractor: Acme SARL.' },
        { id: 'rec-2', text: 'RCCM #12345 — Acme SARL incorporated 2024-12-01.' },
      ],
      date: FIXED_DATE,
    });
    expect(r.systemPreamble).toContain(canaryFor({ date: FIXED_DATE }));
    expect(r.userMessage).toContain('<source_document id="rec-1" label="ARMP listing">');
    expect(r.userMessage).toContain('<source_document id="rec-2">');
    expect(r.userMessage).toContain('Acme SARL');
    expect(r.canary).toEqual(canaryFor({ date: FIXED_DATE }));
  });
  it('escapes attribute-unsafe characters in ids and labels', () => {
    const r = renderClosedContext({
      task: 't',
      sources: [{ id: 'a"b', label: '<bad>&', text: 'x' }],
      date: FIXED_DATE,
    });
    expect(r.userMessage).toContain('id="a&quot;b"');
    expect(r.userMessage).toContain('label="&lt;bad&gt;&amp;"');
  });
});

describe('validateVerbatimGrounding', () => {
  const sources: SourceRecordIndex = {
    fieldText(recordId, field) {
      if (recordId === 'rec-1' && field === 'body') {
        return 'Contractor Acme SARL was awarded contract VA-2026-0001 on 2026-03-15.';
      }
      return null;
    },
  };

  it('keeps a claim whose verbatim quote appears in the cited field', () => {
    const extraction: CitedExtraction = {
      status: 'ok',
      claims: [
        {
          claim: 'Acme SARL was the awarded contractor',
          source_record_id: 'rec-1',
          source_field: 'body',
          verbatim_quote: 'Acme SARL was awarded',
        },
      ],
    };
    const r = validateVerbatimGrounding(extraction, sources);
    expect(r.grounded).toHaveLength(1);
    expect(r.rejected).toHaveLength(0);
  });

  it('rejects a claim whose verbatim quote is not in the source', () => {
    const extraction: CitedExtraction = {
      status: 'ok',
      claims: [
        {
          claim: 'Acme SARL is debarred by AfDB',
          source_record_id: 'rec-1',
          source_field: 'body',
          verbatim_quote: 'AfDB debarment 2024',
        },
      ],
    };
    const r = validateVerbatimGrounding(extraction, sources);
    expect(r.grounded).toHaveLength(0);
    expect(r.rejected).toHaveLength(1);
    expect(r.rejected[0]?.reason).toBe('quote-not-in-source-field');
  });

  it('rejects when the source record/field is unknown', () => {
    const extraction: CitedExtraction = {
      status: 'ok',
      claims: [
        {
          claim: 'fictional fact',
          source_record_id: 'rec-99',
          source_field: 'body',
          verbatim_quote: 'anything',
        },
      ],
    };
    const r = validateVerbatimGrounding(extraction, sources);
    expect(r.rejected[0]?.reason).toBe('source-record-or-field-not-found');
  });

  it('normalises whitespace + unicode so cosmetic differences do not cause false rejections', () => {
    const extraction: CitedExtraction = {
      status: 'ok',
      claims: [
        {
          claim: 'awarded date',
          source_record_id: 'rec-1',
          source_field: 'body',
          verbatim_quote: '  acme  sarl   was  AWARDED  ',
        },
      ],
    };
    const r = validateVerbatimGrounding(extraction, sources);
    expect(r.grounded).toHaveLength(1);
  });
});

describe('PromptRegistry', () => {
  it('rejects malformed versions', () => {
    const r = new PromptRegistry();
    expect(() =>
      r.register({
        name: 't',
        version: '1.0',
        description: 'x',
        render: () => ({ system: 's', user: 'u' }),
      }),
    ).toThrow();
  });

  it('returns latest by registration order', () => {
    const r = new PromptRegistry();
    r.register({
      name: 'extract.armp',
      version: 'v1.0.0',
      description: 'first',
      render: () => ({ system: 's1', user: 'u1' }),
    });
    r.register({
      name: 'extract.armp',
      version: 'v1.1.0',
      description: 'second',
      render: () => ({ system: 's2', user: 'u2' }),
    });
    expect(r.latest('extract.armp')?.version).toBe('v1.1.0');
    expect(r.byVersion('extract.armp', 'v1.0.0')?.description).toBe('first');
  });

  it('produces a stable snapshot hash that changes when a template changes', () => {
    const r1 = new PromptRegistry();
    r1.register({
      name: 't',
      version: 'v1.0.0',
      description: 'a',
      render: () => ({ system: 's', user: 'u' }),
    });
    const r2 = new PromptRegistry();
    r2.register({
      name: 't',
      version: 'v1.0.0',
      description: 'a',
      render: () => ({ system: 's', user: 'u' }),
    });
    expect(r1.registrySnapshotHash()).toEqual(r2.registrySnapshotHash());
    const r3 = new PromptRegistry();
    r3.register({
      name: 't',
      version: 'v1.0.0',
      description: 'different',
      render: () => ({ system: 's', user: 'u' }),
    });
    expect(r1.registrySnapshotHash()).not.toEqual(r3.registrySnapshotHash());
  });

  it('exposes a singleton that workers register into', () => {
    expect(globalPromptRegistry).toBeInstanceOf(PromptRegistry);
  });
});
