import { createHash } from 'node:crypto';

import {
  Adapter,
  registerAdapter,
  type AdapterRunContext,
} from '@vigil/adapters';
import { Constants, Errors, type Schemas } from '@vigil/shared';
import { request } from 'undici';

import { provenance } from './_helpers.js';

/**
 * ofac-sdn — US Treasury OFAC Specially Designated Nationals list (SDN).
 * Public XML; we extract per-record blocks with streaming regex.
 */
const SOURCE_ID = 'ofac-sdn';
const URL = 'https://www.treasury.gov/ofac/downloads/sdn.xml';

class OfacAdapter extends Adapter {
  public readonly sourceId = SOURCE_ID;
  public readonly defaultRateIntervalMs = 1_500;

  protected async execute(ctx: AdapterRunContext): Promise<{
    events: ReadonlyArray<Schemas.SourceEvent>;
    documents: ReadonlyArray<Schemas.Document>;
    fetchedPages: number;
  }> {
    const resp = await request(URL, {
      method: 'GET',
      headers: { 'user-agent': Constants.ADAPTER_DEFAULT_USER_AGENT, accept: 'application/xml' },
      maxRedirections: 5,
    });
    if (resp.statusCode === 403 || resp.statusCode === 451) {
      throw new Errors.SourceBlockedError(SOURCE_ID, { url: URL, status: resp.statusCode });
    }
    if (resp.statusCode >= 500) {
      throw new Errors.SourceUnavailableError(SOURCE_ID, resp.statusCode, { url: URL });
    }
    const xml = await resp.body.text();
    const sha = createHash('sha256').update(xml).digest('hex');

    const entryRe =
      /<sdnEntry>([\s\S]*?)<\/sdnEntry>/g;
    const uidRe = /<uid>(\d+)<\/uid>/;
    const firstNameRe = /<firstName>([^<]+)<\/firstName>/;
    const lastNameRe = /<lastName>([^<]+)<\/lastName>/;
    const sdnTypeRe = /<sdnType>([^<]+)<\/sdnType>/;

    const events: Schemas.SourceEvent[] = [];
    let m: RegExpExecArray | null;
    while ((m = entryRe.exec(xml)) !== null) {
      const block = m[1]!;
      const uid = uidRe.exec(block)?.[1] ?? null;
      const first = firstNameRe.exec(block)?.[1]?.trim();
      const last = lastNameRe.exec(block)?.[1]?.trim() ?? '';
      const type = sdnTypeRe.exec(block)?.[1]?.trim() ?? 'unknown';
      const name = [first, last].filter(Boolean).join(' ').trim() || `OFAC#${uid ?? '?'}`;
      events.push(
        this.makeEvent({
          kind: 'sanction',
          dedupKey: this.dedupKey([SOURCE_ID, uid ?? name]),
          payload: { name, ofac_uid: uid, sdn_type: type, sanctioning_body: 'OFAC' },
          publishedAt: null,
          provenance: provenance(URL, resp.statusCode, sha, ctx, Constants.ADAPTER_DEFAULT_USER_AGENT),
        }),
      );
    }
    if (events.length === 0) {
      throw new Errors.SourceParseError(SOURCE_ID, { url: URL, html: xml.slice(0, 100_000) });
    }
    return { events, documents: [], fetchedPages: 1 };
  }
}

registerAdapter(new OfacAdapter());
