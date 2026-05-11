import { createHash } from 'node:crypto';

import { Adapter, registerAdapter, pickFingerprint, type AdapterRunContext } from '@vigil/adapters';
import { Errors, type Schemas } from '@vigil/shared';

import { boundedBodyText, boundedRequest } from './_bounded-fetch.js';
import { provenance } from './_helpers.js';

/**
 * dgi-attestations — Tax-compliance certificates (attestations de
 * non-redevance). The DGI surfaces a public verifier; we emit a snapshot of
 * the visible "recent issuances" page.
 */
const SOURCE_ID = 'dgi-attestations';
const URL = 'https://www.impots.cm/verification-attestations';

class DgiAdapter extends Adapter {
  public readonly sourceId = SOURCE_ID;
  public readonly defaultRateIntervalMs = 3_000;

  protected async execute(ctx: AdapterRunContext): Promise<{
    events: ReadonlyArray<Schemas.SourceEvent>;
    documents: ReadonlyArray<Schemas.Document>;
    fetchedPages: number;
  }> {
    const fp = pickFingerprint(SOURCE_ID);
    const resp = await boundedRequest(URL, {
      method: 'GET',
      headers: { 'user-agent': fp.userAgent },
    });
    if (resp.statusCode === 403 || resp.statusCode === 451) {
      throw new Errors.SourceBlockedError(SOURCE_ID, { url: URL, status: resp.statusCode });
    }
    if (resp.statusCode >= 500) {
      throw new Errors.SourceUnavailableError(SOURCE_ID, resp.statusCode, { url: URL });
    }
    const html = await boundedBodyText(resp.body, { sourceId: SOURCE_ID, url: URL });
    const sha = createHash('sha256').update(html).digest('hex');

    // Heuristic extraction — recent NIU + status pairs from the verifier page
    const re =
      /NIU\s*:?\s*([A-Z0-9]{6,20}).{1,80}?(\b(?:à jour|en règle|non[- ]?à[- ]?jour|défaillant)\b)/gi;
    const events: Schemas.SourceEvent[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) {
      const niu = m[1]!;
      const status = m[2]!.toLowerCase();
      events.push(
        this.makeEvent({
          kind: 'company_filing',
          dedupKey: this.dedupKey([SOURCE_ID, niu, status]),
          payload: { niu, tax_compliance_status: status },
          publishedAt: null,
          provenance: provenance(URL, resp.statusCode, sha, ctx, fp.userAgent),
        }),
      );
    }
    if (events.length === 0) {
      throw new Errors.SourceParseError(SOURCE_ID, { url: URL, html: html.slice(0, 100_000) });
    }
    return { events, documents: [], fetchedPages: 1 };
  }
}

registerAdapter(new DgiAdapter());
