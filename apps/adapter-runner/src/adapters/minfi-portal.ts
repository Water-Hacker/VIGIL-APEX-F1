import {
  Adapter,
  registerAdapter,
  type AdapterRunContext,
} from '@vigil/adapters';
import type { Schemas } from '@vigil/shared';

import { pdfLinkScrape, provenance } from './_helpers.js';

/**
 * minfi-portal — Ministry of Finance portal. Mostly PDFs (budget execution,
 * payment summaries). The actual fetch + OCR happens in worker-document; this
 * adapter just enumerates the PDF links and emits one event per link.
 */
const SOURCE_ID = 'minfi-portal';
const PAGE_URL = 'https://www.minfi.gov.cm/transparence-budgetaire';

class MinfiPortalAdapter extends Adapter {
  public readonly sourceId = SOURCE_ID;
  public readonly defaultRateIntervalMs = 3_000;

  protected async execute(ctx: AdapterRunContext): Promise<{
    events: ReadonlyArray<Schemas.SourceEvent>;
    documents: ReadonlyArray<Schemas.Document>;
    fetchedPages: number;
  }> {
    const { links, status, responseSha } = await pdfLinkScrape(ctx, SOURCE_ID, PAGE_URL);
    const events: Schemas.SourceEvent[] = links.map((l) =>
      this.makeEvent({
        kind: 'budget_line',
        dedupKey: this.dedupKey([SOURCE_ID, l.href]),
        payload: { document_url: l.href, title: l.title },
        publishedAt: null,
        provenance: provenance(PAGE_URL, status, responseSha, ctx),
      }),
    );
    return { events, documents: [], fetchedPages: 1 };
  }
}

registerAdapter(new MinfiPortalAdapter());
