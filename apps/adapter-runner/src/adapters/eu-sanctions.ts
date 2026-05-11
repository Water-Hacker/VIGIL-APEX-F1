import { createHash } from 'node:crypto';

import { Adapter, registerAdapter, type AdapterRunContext } from '@vigil/adapters';
import { Constants, Errors, type Schemas } from '@vigil/shared';

import { boundedBodyText, boundedRequest } from './_bounded-fetch.js';
import { provenance } from './_helpers.js';

/**
 * eu-sanctions — EU consolidated list. The official feed is XML; we extract
 * per-entity blocks with a streaming-style regex (avoiding a full XML parser
 * for tiny dependency surface). Entries are normalised to the same shape as
 * worldbank-sanctions.
 */
const SOURCE_ID = 'eu-sanctions';
const URL =
  'https://webgate.ec.europa.eu/fsd/fsf/public/files/xmlFullSanctionsList_1_1/content?token=dG9rZW4tMjAxNw';

class EuSanctionsAdapter extends Adapter {
  public readonly sourceId = SOURCE_ID;
  public readonly defaultRateIntervalMs = 2_000;

  protected async execute(ctx: AdapterRunContext): Promise<{
    events: ReadonlyArray<Schemas.SourceEvent>;
    documents: ReadonlyArray<Schemas.Document>;
    fetchedPages: number;
  }> {
    const resp = await boundedRequest(URL, {
      method: 'GET',
      headers: { 'user-agent': Constants.ADAPTER_DEFAULT_USER_AGENT, accept: 'application/xml' },
    });
    if (resp.statusCode === 403 || resp.statusCode === 451) {
      throw new Errors.SourceBlockedError(SOURCE_ID, { url: URL, status: resp.statusCode });
    }
    if (resp.statusCode >= 500) {
      throw new Errors.SourceUnavailableError(SOURCE_ID, resp.statusCode, { url: URL });
    }
    const xml = await boundedBodyText(resp.body, { sourceId: SOURCE_ID, url: URL });
    const sha = createHash('sha256').update(xml).digest('hex');

    const entityRe = /<sanctionEntity[^>]*\sentityId="([^"]+)"[^>]*>([\s\S]*?)<\/sanctionEntity>/g;
    const nameRe = /<wholeName>([^<]+)<\/wholeName>/;
    const events: Schemas.SourceEvent[] = [];
    let m: RegExpExecArray | null;
    while ((m = entityRe.exec(xml)) !== null) {
      const id = m[1]!;
      const block = m[2]!;
      const name = nameRe.exec(block)?.[1]?.trim() ?? id;
      events.push(
        this.makeEvent({
          kind: 'sanction',
          dedupKey: this.dedupKey([SOURCE_ID, id]),
          payload: { name, eu_entity_id: id, sanctioning_body: 'EU' },
          publishedAt: null,
          provenance: provenance(
            URL,
            resp.statusCode,
            sha,
            ctx,
            Constants.ADAPTER_DEFAULT_USER_AGENT,
          ),
        }),
      );
    }
    if (events.length === 0) {
      throw new Errors.SourceParseError(SOURCE_ID, { url: URL, html: xml.slice(0, 100_000) });
    }
    return { events, documents: [], fetchedPages: 1 };
  }
}

registerAdapter(new EuSanctionsAdapter());
