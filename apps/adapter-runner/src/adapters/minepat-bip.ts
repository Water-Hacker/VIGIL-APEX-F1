import {
  Adapter,
  registerAdapter,
  type AdapterRunContext,
} from '@vigil/adapters';
import type { Schemas } from '@vigil/shared';

import { pdfLinkScrape, provenance } from './_helpers.js';

/**
 * minepat-bip — Public Investment Budget (Budget d'Investissement Public).
 * Annual BIP volumes published as PDF; supplemented with project lists
 * keyed by line item.
 */
const SOURCE_ID = 'minepat-bip';
const URL = 'https://www.minepat.gov.cm/bip';

class MinepatAdapter extends Adapter {
  public readonly sourceId = SOURCE_ID;
  public readonly defaultRateIntervalMs = 5_000;

  protected async execute(ctx: AdapterRunContext): Promise<{
    events: ReadonlyArray<Schemas.SourceEvent>;
    documents: ReadonlyArray<Schemas.Document>;
    fetchedPages: number;
  }> {
    const { links, status, responseSha } = await pdfLinkScrape(ctx, SOURCE_ID, URL);
    const events: Schemas.SourceEvent[] = links.map((l) =>
      this.makeEvent({
        kind: 'investment_project',
        dedupKey: this.dedupKey([SOURCE_ID, l.href]),
        payload: { document_url: l.href, title: l.title },
        publishedAt: null,
        provenance: provenance(URL, status, responseSha, ctx),
      }),
    );
    return { events, documents: [], fetchedPages: 1 };
  }
}

registerAdapter(new MinepatAdapter());
