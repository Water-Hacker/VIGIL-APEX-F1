import { createHash } from 'node:crypto';

import {
  Adapter,
  registerAdapter,
  pickFingerprint,
  type AdapterRunContext,
} from '@vigil/adapters';
import { Errors, type Schemas } from '@vigil/shared';
import { chromium } from 'playwright';

/**
 * rccm-search — OHADA commercial registry. Provides company filings, directors,
 * shareholders, registration metadata. Reference adapter for Cameroonian
 * business-registry style sources.
 */

const SOURCE_ID = 'rccm-search';
const BASE_URL = 'https://www.rccm.cm';

class RccmSearchAdapter extends Adapter {
  public readonly sourceId = SOURCE_ID;
  public readonly defaultRateIntervalMs = 5_000;

  protected async execute(ctx: AdapterRunContext): Promise<{
    events: ReadonlyArray<Schemas.SourceEvent>;
    documents: ReadonlyArray<Schemas.Document>;
    fetchedPages: number;
  }> {
    const fp = pickFingerprint(SOURCE_ID);
    const browser = await chromium.launch({
      headless: true,
      ...(ctx.proxy?.url ? { proxy: { server: ctx.proxy.url } } : {}),
    });
    const events: Schemas.SourceEvent[] = [];
    let pagesFetched = 0;

    try {
      const context = await browser.newContext({
        userAgent: fp.userAgent,
        viewport: fp.viewport,
        locale: 'fr-FR',
        timezoneId: fp.timezone,
      });
      const page = await context.newPage();

      // Latest-incorporations endpoint (RCCM publishes a daily feed)
      const url = `${BASE_URL}/derniers-enregistrements`;
      const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      pagesFetched++;
      if (!resp) throw new Errors.SourceUnavailableError(SOURCE_ID, 0, { url });
      const status = resp.status();
      if (status === 403 || status === 451) {
        throw new Errors.SourceBlockedError(SOURCE_ID, { url, status });
      }

      await page.waitForSelector('.liste-entreprises, table tbody tr', { timeout: 20_000 }).catch(() => null);
      const rows = await page.$$eval('table tbody tr, .liste-entreprises .item', (els) =>
        els.map((row) => ({
          text: (row.textContent ?? '').trim().replace(/\s+/g, ' '),
          cells: Array.from(row.querySelectorAll('td')).map((td) => (td.textContent ?? '').trim()),
          href: (row.querySelector('a') as HTMLAnchorElement | null)?.href ?? null,
        })),
      );
      if (rows.length === 0) {
        const html = await page.content();
        throw new Errors.SourceParseError(SOURCE_ID, { url, html: html.slice(0, 200_000) });
      }

      const respSha = createHash('sha256').update(JSON.stringify(rows)).digest('hex');

      for (const row of rows) {
        const dedup = this.dedupKey([SOURCE_ID, row.href ?? row.text.slice(0, 200)]);
        events.push(
          this.makeEvent({
            kind: 'company_filing',
            dedupKey: dedup,
            payload: {
              raw_text: row.text,
              cells: row.cells,
              href: row.href,
            },
            publishedAt: null,
            provenance: {
              url,
              http_status: status,
              response_sha256: respSha,
              fetched_via_proxy: ctx.proxy?.url ?? null,
              user_agent: fp.userAgent,
            },
          }),
        );
      }
    } finally {
      await browser.close();
    }
    return { events, documents: [], fetchedPages: pagesFetched };
  }
}

registerAdapter(new RccmSearchAdapter());
