import {
  Adapter,
  registerAdapter,
  type AdapterRunContext,
} from '@vigil/adapters';

import { playwrightTableScrape, provenance } from './_helpers.js';

import type { Schemas } from '@vigil/shared';


/**
 * minmap-portal — Ministry of Public Procurement portal.
 * Companion to ARMP; emits tender_notice + award rows from the ministry surface.
 */
const SOURCE_ID = 'minmap-portal';
const BASE = 'https://www.minmap.cm';
const LISTINGS = ['/avis-de-passation-marches', '/decisions-attribution', '/marches-resilies'];

class MinmapPortalAdapter extends Adapter {
  public readonly sourceId = SOURCE_ID;
  public readonly defaultRateIntervalMs = 3_000;

  protected async execute(ctx: AdapterRunContext): Promise<{
    events: ReadonlyArray<Schemas.SourceEvent>;
    documents: ReadonlyArray<Schemas.Document>;
    fetchedPages: number;
  }> {
    const events: Schemas.SourceEvent[] = [];
    let pages = 0;
    for (const p of LISTINGS) {
      const url = `${BASE}${p}`;
      const { rows, status, fp, responseSha } = await playwrightTableScrape(ctx, SOURCE_ID, url);
      pages++;
      const kind: Schemas.SourceEventKind = p.includes('attribution')
        ? 'award'
        : p.includes('resili')
          ? 'cancellation'
          : 'tender_notice';
      for (const row of rows) {
        events.push(
          this.makeEvent({
            kind,
            dedupKey: this.dedupKey([SOURCE_ID, p, row.href ?? row.text.slice(0, 200)]),
            payload: { listing: p, raw_text: row.text, cells: row.cells, href: row.href },
            publishedAt: null,
            provenance: provenance(url, status, responseSha, ctx, fp.userAgent),
          }),
        );
      }
    }
    return { events, documents: [], fetchedPages: pages };
  }
}

registerAdapter(new MinmapPortalAdapter());
