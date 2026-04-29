import {
  Adapter,
  registerAdapter,
  type AdapterRunContext,
} from '@vigil/adapters';

import { playwrightTableScrape, provenance } from './_helpers.js';

import type { Schemas } from '@vigil/shared';


/**
 * coleps-tenders — e-Procurement platform (subject to Cloudflare challenges
 * during peak hours; layered egress + ScraperAPI fallback per W-13).
 */
const SOURCE_ID = 'coleps-tenders';
const BASE = 'https://coleps.armp.cm';

class ColepsAdapter extends Adapter {
  public readonly sourceId = SOURCE_ID;
  public readonly defaultRateIntervalMs = 3_000;

  protected async execute(ctx: AdapterRunContext): Promise<{
    events: ReadonlyArray<Schemas.SourceEvent>;
    documents: ReadonlyArray<Schemas.Document>;
    fetchedPages: number;
  }> {
    const events: Schemas.SourceEvent[] = [];
    let pages = 0;
    for (const p of ['/tenders', '/awards', '/contractors']) {
      const url = `${BASE}${p}`;
      const { rows, status, fp, responseSha } = await playwrightTableScrape(ctx, SOURCE_ID, url);
      pages++;
      const kind: Schemas.SourceEventKind = p === '/tenders' ? 'tender_notice' : p === '/awards' ? 'award' : 'company_filing';
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

registerAdapter(new ColepsAdapter());
