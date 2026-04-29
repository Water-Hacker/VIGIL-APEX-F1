import {
  Adapter,
  registerAdapter,
  type AdapterRunContext,
} from '@vigil/adapters';

import { pdfLinkScrape, provenance } from './_helpers.js';

import type { Schemas } from '@vigil/shared';


/**
 * anif-pep — National Financial Investigation Agency (ANIF). Publishes annual
 * reports + advisories as PDF. We treat new bulletins as `pep_match` candidates;
 * worker-document OCR + entity-resolution pulls names from the bulletins.
 */
const SOURCE_ID = 'anif-pep';
const URL = 'https://www.anif.cm/bulletins-rapports';

class AnifAdapter extends Adapter {
  public readonly sourceId = SOURCE_ID;
  public readonly defaultRateIntervalMs = 6_000;

  protected async execute(ctx: AdapterRunContext): Promise<{
    events: ReadonlyArray<Schemas.SourceEvent>;
    documents: ReadonlyArray<Schemas.Document>;
    fetchedPages: number;
  }> {
    const { links, status, responseSha } = await pdfLinkScrape(ctx, SOURCE_ID, URL);
    const events: Schemas.SourceEvent[] = links.map((l) =>
      this.makeEvent({
        kind: 'pep_match',
        dedupKey: this.dedupKey([SOURCE_ID, l.href]),
        payload: { document_url: l.href, title: l.title, source: 'anif' },
        publishedAt: null,
        provenance: provenance(URL, status, responseSha, ctx),
      }),
    );
    return { events, documents: [], fetchedPages: 1 };
  }
}

registerAdapter(new AnifAdapter());
