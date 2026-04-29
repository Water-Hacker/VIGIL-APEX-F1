import { createHash } from 'node:crypto';

import {
  Adapter,
  registerAdapter,
  pickFingerprint,
  type AdapterRunContext,
} from '@vigil/adapters';
import { Errors, Ids, type Schemas } from '@vigil/shared';
import { chromium, type BrowserContext } from 'playwright';

/**
 * armp-main — Agence de Régulation des Marchés Publics, the procurement regulator.
 *
 * Reference adapter (BUILD-V1 §11; SRD §12.3). All other Cameroonian portal
 * adapters follow this template with parameter substitution: tunnel through
 * Playwright with our honest UA, wait for the listing table, paginate to the
 * configured cap, emit one event per row.
 *
 * Selectors are EXPECTED TO DRIFT. On parse failure (0 rows), the base class
 * triggers the first-contact protocol (W-19). The selector-repair worker
 * proposes a fix via PR.
 */

const SOURCE_ID = 'armp-main';
const BASE_URL = 'https://www.armp.cm';
const LISTING_PATHS = [
  '/decisions/avis-d-attribution',
  '/decisions/marches-resilies',
  '/decisions/sanctions',
];

class ArmpMainAdapter extends Adapter {
  public readonly sourceId = SOURCE_ID;
  public readonly defaultRateIntervalMs = 2_500;

  protected async execute(ctx: AdapterRunContext): Promise<{
    events: ReadonlyArray<Schemas.SourceEvent>;
    documents: ReadonlyArray<Schemas.Document>;
    fetchedPages: number;
  }> {
    const fp = pickFingerprint(SOURCE_ID);
    const proxyArg = ctx.proxy?.url ? { server: ctx.proxy.url } : undefined;
    const browser = await chromium.launch({
      headless: true,
      ...(proxyArg && { proxy: proxyArg }),
    });
    let context: BrowserContext | null = null;
    let pagesFetched = 0;
    const events: Schemas.SourceEvent[] = [];

    try {
      context = await browser.newContext({
        userAgent: fp.userAgent,
        viewport: fp.viewport,
        locale: fp.locale,
        timezoneId: fp.timezone,
        extraHTTPHeaders: { 'Accept-Language': fp.acceptLanguage },
      });
      const page = await context.newPage();

      for (const listPath of LISTING_PATHS) {
        const url = `${BASE_URL}${listPath}`;
        const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
        pagesFetched++;
        if (!resp) throw new Errors.SourceUnavailableError(SOURCE_ID, 0, { url });
        const status = resp.status();
        if (status === 403 || status === 451) {
          throw new Errors.SourceBlockedError(SOURCE_ID, { url, status });
        }
        if (status >= 500) {
          throw new Errors.SourceUnavailableError(SOURCE_ID, status, { url });
        }

        // Wait for the canonical listing table; tolerate slow JS-renders
        await page.waitForSelector('table tbody tr, .liste-decisions, .empty-state', { timeout: 30_000 }).catch(() => null);

        const html = await page.content();
        const rows = await page.$$eval(
          'table tbody tr, .liste-decisions .item',
          (els) =>
            els.map((row) => ({
              text: (row.textContent ?? '').trim().replace(/\s+/g, ' '),
              href: (row.querySelector('a') as HTMLAnchorElement | null)?.href ?? null,
              cells: Array.from(row.querySelectorAll('td')).map((td) => (td.textContent ?? '').trim()),
            })),
        );

        if (rows.length === 0) {
          throw new Errors.SourceParseError(SOURCE_ID, { url, html: html.slice(0, 200_000) });
        }

        for (const row of rows) {
          const text = row.text;
          // Heuristic kind classification — bid-rigging if "infructueux", debarment if "exclusion", else award
          const kind: Schemas.SourceEventKind = text.toLowerCase().includes('exclusion')
            ? 'debarment'
            : text.toLowerCase().includes('résili')
              ? 'cancellation'
              : 'award';

          const responseSha = createHash('sha256').update(text).digest('hex');
          const dedup = this.dedupKey([SOURCE_ID, listPath, kind, row.href ?? text.slice(0, 200)]);
          const ev = this.makeEvent({
            kind,
            dedupKey: dedup,
            payload: {
              listing: listPath,
              raw_text: text,
              href: row.href,
              cells: row.cells,
            },
            publishedAt: null, // ARMP rarely exposes a parseable date in the listing
            documentCids: [],
            provenance: {
              url,
              http_status: status,
              response_sha256: responseSha,
              fetched_via_proxy: ctx.proxy?.url ?? null,
              user_agent: fp.userAgent,
            },
          });
          events.push(ev);
        }
      }
    } finally {
      await context?.close();
      await browser.close();
    }

    void Ids; // silence unused import for the typescript build path
    return { events, documents: [], fetchedPages: pagesFetched };
  }
}

registerAdapter(new ArmpMainAdapter());
