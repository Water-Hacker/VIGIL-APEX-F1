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
 * un-sanctions — UN Security Council Consolidated List (XML).
 */
const SOURCE_ID = 'un-sanctions';
const URL = 'https://scsanctions.un.org/resources/xml/en/consolidated.xml';

class UnSanctionsAdapter extends Adapter {
  public readonly sourceId = SOURCE_ID;
  public readonly defaultRateIntervalMs = 1_000;

  protected async execute(ctx: AdapterRunContext): Promise<{
    events: ReadonlyArray<Schemas.SourceEvent>;
    documents: ReadonlyArray<Schemas.Document>;
    fetchedPages: number;
  }> {
    const resp = await request(URL, {
      method: 'GET',
      headers: { 'user-agent': Constants.ADAPTER_DEFAULT_USER_AGENT, accept: 'application/xml' },
    });
    if (resp.statusCode === 403 || resp.statusCode === 451) {
      throw new Errors.SourceBlockedError(SOURCE_ID, { url: URL, status: resp.statusCode });
    }
    if (resp.statusCode >= 500) {
      throw new Errors.SourceUnavailableError(SOURCE_ID, resp.statusCode, { url: URL });
    }
    const xml = await resp.body.text();
    const sha = createHash('sha256').update(xml).digest('hex');

    const entryRe = /<(?:INDIVIDUAL|ENTITY)>([\s\S]*?)<\/(?:INDIVIDUAL|ENTITY)>/g;
    const dataidRe = /<DATAID>([^<]+)<\/DATAID>/;
    const firstRe = /<FIRST_NAME>([^<]+)<\/FIRST_NAME>/;
    const secondRe = /<SECOND_NAME>([^<]+)<\/SECOND_NAME>/;
    const entityNameRe = /<FIRST_NAME>([^<]+)<\/FIRST_NAME>/;

    const events: Schemas.SourceEvent[] = [];
    let m: RegExpExecArray | null;
    while ((m = entryRe.exec(xml)) !== null) {
      const block = m[1]!;
      const id = dataidRe.exec(block)?.[1] ?? null;
      const f = firstRe.exec(block)?.[1]?.trim();
      const s = secondRe.exec(block)?.[1]?.trim();
      const e = entityNameRe.exec(block)?.[1]?.trim();
      const name = [f, s].filter(Boolean).join(' ').trim() || (e ?? `UN#${id ?? '?'}`);
      events.push(
        this.makeEvent({
          kind: 'sanction',
          dedupKey: this.dedupKey([SOURCE_ID, id ?? name]),
          payload: { name, un_data_id: id, sanctioning_body: 'UN' },
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

registerAdapter(new UnSanctionsAdapter());
