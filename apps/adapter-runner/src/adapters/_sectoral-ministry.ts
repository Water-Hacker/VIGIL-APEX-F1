import {
  Adapter,
  registerAdapter,
  type AdapterRunContext,
} from '@vigil/adapters';
import type { Schemas } from '@vigil/shared';

import { playwrightTableScrape, provenance } from './_helpers.js';

/**
 * Sectoral-ministry adapter factory.
 *
 * The 6 sectoral ministries (mintp, minee, minsante, minedub, minesec, minhdu)
 * publish procurement notices on near-identical Joomla / Drupal portals. They
 * share enough structure that a parameterised adapter — URL + listing path —
 * is preferable to 6 near-duplicate files.
 */
export interface SectoralConfig {
  readonly sourceId: string;
  readonly baseUrl: string;
  readonly listingPaths: readonly string[];
  readonly defaultRateMs?: number;
}

export function makeSectoralAdapter(cfg: SectoralConfig): Adapter {
  class SectoralAdapter extends Adapter {
    public readonly sourceId = cfg.sourceId;
    public readonly defaultRateIntervalMs = cfg.defaultRateMs ?? 4_000;

    protected async execute(ctx: AdapterRunContext): Promise<{
      events: ReadonlyArray<Schemas.SourceEvent>;
      documents: ReadonlyArray<Schemas.Document>;
      fetchedPages: number;
    }> {
      const events: Schemas.SourceEvent[] = [];
      let pages = 0;
      for (const p of cfg.listingPaths) {
        const url = `${cfg.baseUrl}${p}`;
        const { rows, status, fp, responseSha } = await playwrightTableScrape(ctx, cfg.sourceId, url);
        pages++;
        for (const row of rows) {
          events.push(
            this.makeEvent({
              kind: 'tender_notice',
              dedupKey: this.dedupKey([cfg.sourceId, p, row.href ?? row.text.slice(0, 200)]),
              payload: {
                listing: p,
                raw_text: row.text,
                cells: row.cells,
                href: row.href,
              },
              publishedAt: null,
              provenance: provenance(url, status, responseSha, ctx, fp.userAgent),
            }),
          );
        }
      }
      return { events, documents: [], fetchedPages: pages };
    }
  }
  const a = new SectoralAdapter();
  registerAdapter(a);
  return a;
}
