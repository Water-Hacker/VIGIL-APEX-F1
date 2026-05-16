/**
 * Tier-14 audit closure: `extractDocumentFetchRequests` in run-one.ts
 * is the gateway between adapter-scraped href content and worker-document's
 * fetch. URLs originating in scraped HTML are adversary-controlled; before
 * tier-14 the only check was `^https?://`, which lets `http://169.254.169.254/`,
 * `http://localhost:5432/`, etc. through.
 *
 * These tests pin that:
 *   - Public URLs pass through and are deduped + hashed correctly.
 *   - Private, loopback, and metadata URLs are filtered out.
 *   - The DOCUMENT_KIND_BY_FIELD mapping still applies after the filter.
 *   - Non-http(s) URLs are still rejected as before.
 *   - Logger receives a structured `document-url-rejected-ssrf` event.
 */

import { describe, expect, it, vi } from 'vitest';

import { extractDocumentFetchRequests } from '../src/run-one.js';

import type { Schemas } from '@vigil/shared';

function mkEvent(payload: Record<string, unknown>): Schemas.SourceEvent {
  return {
    id: 'ev_test_001',
    source_id: 'src-test',
    kind: 'document_index',
    dedup_key: 'd1',
    published_at: null,
    observed_at: new Date().toISOString(),
    payload,
    document_cids: [],
    provenance: {
      url: 'https://example.org/listing',
      http_status: 200,
      response_sha256: 'a'.repeat(64),
      fetched_via_proxy: null,
      user_agent: 'vigil-test',
    },
  } as unknown as Schemas.SourceEvent;
}

describe('extractDocumentFetchRequests — public URL pass-through', () => {
  it('extracts a public document_url', () => {
    const out = extractDocumentFetchRequests(
      mkEvent({ document_url: 'https://www.conac.cm/report.pdf' }),
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.request.document_url).toBe('https://www.conac.cm/report.pdf');
    expect(out[0]?.request.expected_kind).toBe('document');
  });

  it('extracts multiple distinct fields', () => {
    const out = extractDocumentFetchRequests(
      mkEvent({
        report_url: 'https://cour-des-comptes.cm/2024/rapport.pdf',
        award_pdf: 'https://armp.cm/awards/2024-042.pdf',
      }),
    );
    expect(out).toHaveLength(2);
    expect(out.map((o) => o.request.expected_kind).sort()).toEqual(['audit_report', 'award']);
  });

  it('deduplicates the same URL across fields', () => {
    const url = 'https://minfi.cm/portal/doc.pdf';
    const out = extractDocumentFetchRequests(mkEvent({ document_url: url, pdf_url: url }));
    expect(out).toHaveLength(1);
  });
});

describe('extractDocumentFetchRequests — SSRF rejection', () => {
  it('drops AWS-metadata URL', () => {
    const logger = { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn() };
    const out = extractDocumentFetchRequests(
      mkEvent({ document_url: 'http://169.254.169.254/latest/meta-data/iam/security-credentials' }),
      logger as never,
    );
    expect(out).toHaveLength(0);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        field: 'document_url',
        reason: expect.stringContaining('private-ipv4'),
      }),
      'document-url-rejected-ssrf',
    );
  });

  it('drops localhost URL', () => {
    const out = extractDocumentFetchRequests(mkEvent({ document_url: 'http://localhost:5432/' }));
    expect(out).toHaveLength(0);
  });

  it('drops RFC1918 10.x URL', () => {
    const out = extractDocumentFetchRequests(mkEvent({ report_url: 'http://10.0.0.5:8080/admin' }));
    expect(out).toHaveLength(0);
  });

  it('drops IPv6 loopback', () => {
    const out = extractDocumentFetchRequests(mkEvent({ document_url: 'http://[::1]/x.pdf' }));
    expect(out).toHaveLength(0);
  });

  it('drops single-label k8s service name', () => {
    const out = extractDocumentFetchRequests(
      mkEvent({ document_url: 'http://vault/v1/secret/data/x' }),
    );
    expect(out).toHaveLength(0);
  });

  it('drops *.local mDNS hostname', () => {
    const out = extractDocumentFetchRequests(
      mkEvent({ document_url: 'http://nas.local/share/doc.pdf' }),
    );
    expect(out).toHaveLength(0);
  });

  it('keeps public, drops private — mixed payload', () => {
    const out = extractDocumentFetchRequests(
      mkEvent({
        document_url: 'https://www.conac.cm/legitimate.pdf',
        report_url: 'http://169.254.169.254/meta-data',
        award_pdf: 'http://10.0.0.1/internal.pdf',
        href: 'https://opensanctions.org/entities/foo',
      }),
    );
    expect(out).toHaveLength(2);
    expect(out.map((o) => o.request.document_url).sort()).toEqual([
      'https://opensanctions.org/entities/foo',
      'https://www.conac.cm/legitimate.pdf',
    ]);
  });
});

describe('extractDocumentFetchRequests — non-http rejection (pre-existing)', () => {
  it('drops file:// URLs', () => {
    const out = extractDocumentFetchRequests(mkEvent({ document_url: 'file:///etc/passwd' }));
    expect(out).toHaveLength(0);
  });

  it('drops javascript: URLs', () => {
    const out = extractDocumentFetchRequests(mkEvent({ document_url: 'javascript:alert(1)' }));
    expect(out).toHaveLength(0);
  });

  it('drops non-string fields silently', () => {
    const out = extractDocumentFetchRequests(
      mkEvent({ document_url: { url: 'https://x.com/y.pdf' } }),
    );
    expect(out).toHaveLength(0);
  });
});
