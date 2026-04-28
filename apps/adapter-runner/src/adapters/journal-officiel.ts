import {
  Adapter,
  registerAdapter,
  type AdapterRunContext,
} from '@vigil/adapters';
import type { Schemas } from '@vigil/shared';

import { playwrightTableScrape, provenance } from './_helpers.js';

/**
 * journal-officiel — Cameroonian Official Gazette (JO). Publishes presidential
 * decrees, ministerial appointments, etc. We emit `gazette_decree` for new
 * decrees and `gazette_appointment` for appointment events.
 */
const SOURCE_ID = 'journal-officiel';
const URL = 'https://www.spm.gov.cm/jo/derniers-numeros';

class JoAdapter extends Adapter {
  public readonly sourceId = SOURCE_ID;
  public readonly defaultRateIntervalMs = 5_000;

  protected async execute(ctx: AdapterRunContext): Promise<{
    events: ReadonlyArray<Schemas.SourceEvent>;
    documents: ReadonlyArray<Schemas.Document>;
    fetchedPages: number;
  }> {
    const { rows, status, fp, responseSha } = await playwrightTableScrape(ctx, SOURCE_ID, URL);
    const events: Schemas.SourceEvent[] = rows.map((row) => {
      const text = row.text.toLowerCase();
      const kind: Schemas.SourceEventKind = text.includes('nomination') || text.includes('appointment')
        ? 'gazette_appointment'
        : 'gazette_decree';
      return this.makeEvent({
        kind,
        dedupKey: this.dedupKey([SOURCE_ID, row.href ?? row.text.slice(0, 200)]),
        payload: { raw_text: row.text, cells: row.cells, href: row.href },
        publishedAt: null,
        provenance: provenance(URL, status, responseSha, ctx, fp.userAgent),
      });
    });
    return { events, documents: [], fetchedPages: 1 };
  }
}

registerAdapter(new JoAdapter());
