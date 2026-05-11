import { createHash } from 'node:crypto';

import { Adapter, registerAdapter, type AdapterRunContext } from '@vigil/adapters';
import { Constants, Errors, type Schemas } from '@vigil/shared';
import { z } from 'zod';

import { boundedBodyText, boundedRequest } from './_bounded-fetch.js';

/**
 * opensanctions — aggregator API; reference adapter for the Aleph/OpenCorporates
 * pattern. We pull the Cameroon-targeted PEP/sanctions slice on a frequent
 * cadence and dedup via OpenSanctions' canonical entity IDs.
 */

const SOURCE_ID = 'opensanctions';
const API_URL = 'https://api.opensanctions.org/search/default';

const zMatch = z.object({
  id: z.string(),
  caption: z.string(),
  schema: z.string(),
  properties: z.record(z.array(z.union([z.string(), z.number(), z.boolean()]))).optional(),
  datasets: z.array(z.string()).optional(),
});
const zResponse = z.object({
  total: z.object({ value: z.number() }),
  results: z.array(zMatch),
});

class OpenSanctionsAdapter extends Adapter {
  public readonly sourceId = SOURCE_ID;
  public readonly defaultRateIntervalMs = 500;

  protected async execute(ctx: AdapterRunContext): Promise<{
    events: ReadonlyArray<Schemas.SourceEvent>;
    documents: ReadonlyArray<Schemas.Document>;
    fetchedPages: number;
  }> {
    const url = `${API_URL}?countries=cm&limit=200`;
    const resp = await boundedRequest(url, {
      method: 'GET',
      headers: { 'user-agent': Constants.ADAPTER_DEFAULT_USER_AGENT, accept: 'application/json' },
    });
    if (resp.statusCode >= 500) {
      throw new Errors.SourceUnavailableError(SOURCE_ID, resp.statusCode, { url });
    }
    const text = await boundedBodyText(resp.body, { sourceId: SOURCE_ID, url });
    const parsed = zResponse.safeParse(JSON.parse(text));
    if (!parsed.success) {
      throw new Errors.SourceParseError(SOURCE_ID, { url, html: text.slice(0, 100_000) });
    }
    const respSha = createHash('sha256').update(text).digest('hex');

    const events: Schemas.SourceEvent[] = parsed.data.results.map((m) =>
      this.makeEvent({
        kind: m.schema === 'Person' ? 'pep_match' : 'sanction',
        dedupKey: this.dedupKey([SOURCE_ID, m.id]),
        payload: {
          opensanctions_id: m.id,
          caption: m.caption,
          schema: m.schema,
          datasets: m.datasets ?? [],
          properties: m.properties ?? {},
        },
        publishedAt: null,
        provenance: {
          url,
          http_status: resp.statusCode,
          response_sha256: respSha,
          fetched_via_proxy: ctx.proxy?.url ?? null,
          user_agent: Constants.ADAPTER_DEFAULT_USER_AGENT,
        },
      }),
    );
    return { events, documents: [], fetchedPages: 1 };
  }
}

registerAdapter(new OpenSanctionsAdapter());
