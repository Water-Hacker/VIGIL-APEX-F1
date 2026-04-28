import {
  Adapter,
  registerAdapter,
  type AdapterRunContext,
} from '@vigil/adapters';
import type { Schemas } from '@vigil/shared';

import { pdfLinkScrape, provenance } from './_helpers.js';

const SOURCE_ID = 'dgb-budget';
const URL = 'https://www.dgb.gov.cm/publications';

class DgbAdapter extends Adapter {
  public readonly sourceId = SOURCE_ID;
  public readonly defaultRateIntervalMs = 4_000;

  protected async execute(ctx: AdapterRunContext): Promise<{
    events: ReadonlyArray<Schemas.SourceEvent>;
    documents: ReadonlyArray<Schemas.Document>;
    fetchedPages: number;
  }> {
    const { links, status, responseSha } = await pdfLinkScrape(ctx, SOURCE_ID, URL);
    const events: Schemas.SourceEvent[] = links.map((l) =>
      this.makeEvent({
        kind: 'budget_line',
        dedupKey: this.dedupKey([SOURCE_ID, l.href]),
        payload: { document_url: l.href, title: l.title, source: 'dgb-budget' },
        publishedAt: null,
        provenance: provenance(URL, status, responseSha, ctx),
      }),
    );
    return { events, documents: [], fetchedPages: 1 };
  }
}

registerAdapter(new DgbAdapter());
