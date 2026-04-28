import { createHash } from 'node:crypto';

import {
  Adapter,
  registerAdapter,
  pickFingerprint,
  type AdapterRunContext,
} from '@vigil/adapters';
import { Errors, type Schemas } from '@vigil/shared';
import { request } from 'undici';

/**
 * cour-des-comptes — Cameroon's audit court. Annual public reports + observations.
 * Reference adapter for PDF-heavy sources: enumerate report listing, follow
 * each PDF link, emit `audit_observation` events; document worker takes over
 * the actual fetch/OCR.
 */

const SOURCE_ID = 'cour-des-comptes';
const BASE_URL = 'https://www.cdc.cm';

class CourDesComptesAdapter extends Adapter {
  public readonly sourceId = SOURCE_ID;
  public readonly defaultRateIntervalMs = 5_000;

  protected async execute(ctx: AdapterRunContext): Promise<{
    events: ReadonlyArray<Schemas.SourceEvent>;
    documents: ReadonlyArray<Schemas.Document>;
    fetchedPages: number;
  }> {
    const fp = pickFingerprint(SOURCE_ID);
    const url = `${BASE_URL}/rapports-publics`;
    const resp = await request(url, {
      method: 'GET',
      headers: {
        'user-agent': fp.userAgent,
        'accept-language': fp.acceptLanguage,
      },
    });
    if (resp.statusCode === 403 || resp.statusCode === 451) {
      throw new Errors.SourceBlockedError(SOURCE_ID, { url, status: resp.statusCode });
    }
    if (resp.statusCode >= 500) {
      throw new Errors.SourceUnavailableError(SOURCE_ID, resp.statusCode, { url });
    }
    const html = await resp.body.text();
    const respSha = createHash('sha256').update(html).digest('hex');

    // Extract PDF links — naive but resilient regex; first-contact triggers if 0 hits
    const links: { href: string; title: string }[] = [];
    const re = /<a[^>]+href="([^"]+\.pdf)"[^>]*>([^<]+)<\/a>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) {
      const href = m[1]!.startsWith('http') ? m[1]! : `${BASE_URL}${m[1]}`;
      links.push({ href, title: m[2]!.trim() });
    }
    if (links.length === 0) {
      throw new Errors.SourceParseError(SOURCE_ID, { url, html: html.slice(0, 200_000) });
    }

    const events: Schemas.SourceEvent[] = links.map((l) =>
      this.makeEvent({
        kind: 'audit_observation',
        dedupKey: this.dedupKey([SOURCE_ID, l.href]),
        payload: {
          report_url: l.href,
          title: l.title,
        },
        publishedAt: null,
        provenance: {
          url,
          http_status: resp.statusCode,
          response_sha256: respSha,
          fetched_via_proxy: ctx.proxy?.url ?? null,
          user_agent: fp.userAgent,
        },
      }),
    );

    return { events, documents: [], fetchedPages: 1 };
  }
}

registerAdapter(new CourDesComptesAdapter());
