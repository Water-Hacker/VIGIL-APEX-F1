import {
  Adapter,
  registerAdapter,
  type AdapterRunContext,
} from '@vigil/adapters';
import type { Schemas } from '@vigil/shared';

import { pdfLinkScrape, provenance } from './_helpers.js';

/**
 * dgtcfm-treasury — Public Treasury. Combines treasury disbursement summaries
 * with bons-du-trésor announcements; we emit `treasury_disbursement` for both
 * and let downstream classification distinguish.
 */
const SOURCE_ID = 'dgtcfm-treasury';
const URLS = ['https://www.dgtcfm.gov.cm/etat-execution-budget', 'https://www.dgtcfm.gov.cm/bons-tresor'];

class DgtcfmAdapter extends Adapter {
  public readonly sourceId = SOURCE_ID;
  public readonly defaultRateIntervalMs = 4_000;

  protected async execute(ctx: AdapterRunContext): Promise<{
    events: ReadonlyArray<Schemas.SourceEvent>;
    documents: ReadonlyArray<Schemas.Document>;
    fetchedPages: number;
  }> {
    const events: Schemas.SourceEvent[] = [];
    let pages = 0;
    for (const url of URLS) {
      const { links, status, responseSha } = await pdfLinkScrape(ctx, SOURCE_ID, url);
      pages++;
      for (const l of links) {
        events.push(
          this.makeEvent({
            kind: 'treasury_disbursement',
            dedupKey: this.dedupKey([SOURCE_ID, l.href]),
            payload: { document_url: l.href, title: l.title, listing: url },
            publishedAt: null,
            provenance: provenance(url, status, responseSha, ctx),
          }),
        );
      }
    }
    return { events, documents: [], fetchedPages: pages };
  }
}

registerAdapter(new DgtcfmAdapter());
