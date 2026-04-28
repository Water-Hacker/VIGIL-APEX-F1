import {
  Adapter,
  registerAdapter,
  type AdapterRunContext,
} from '@vigil/adapters';
import { Constants, type Schemas } from '@vigil/shared';
import { z } from 'zod';

import { apiJsonFetch, provenance } from './_helpers.js';

/**
 * occrp-aleph — corroboration source for documents and entities. Free for
 * qualifying anti-corruption bodies; key in Vault. We query the recent feed
 * filtered by Cameroon and emit one event per result.
 */
const SOURCE_ID = 'occrp-aleph';
const BASE = 'https://aleph.occrp.org/api/2';

const zResult = z.object({
  id: z.string(),
  schema: z.string(),
  caption: z.string(),
  countries: z.array(z.string()).optional(),
  properties: z.record(z.unknown()).optional(),
});
const zResp = z.object({
  results: z.array(zResult),
  total: z.number(),
});

class AlephAdapter extends Adapter {
  public readonly sourceId = SOURCE_ID;
  public readonly defaultRateIntervalMs = 2_000;

  protected async execute(ctx: AdapterRunContext): Promise<{
    events: ReadonlyArray<Schemas.SourceEvent>;
    documents: ReadonlyArray<Schemas.Document>;
    fetchedPages: number;
  }> {
    const url = `${BASE}/entities?filter:countries=cm&limit=200`;
    const headers: Record<string, string> = {};
    const key = process.env.ALEPH_API_KEY;
    if (key) headers['authorization'] = `ApiKey ${key}`;
    const { data, status, responseSha } = await apiJsonFetch(ctx, SOURCE_ID, url, zResp, headers);
    const events: Schemas.SourceEvent[] = data.results.map((r) =>
      this.makeEvent({
        kind: 'company_filing',
        dedupKey: this.dedupKey([SOURCE_ID, r.id]),
        payload: {
          aleph_id: r.id,
          caption: r.caption,
          schema: r.schema,
          countries: r.countries ?? [],
          properties: r.properties ?? {},
        },
        publishedAt: null,
        provenance: provenance(url, status, responseSha, ctx, Constants.ADAPTER_DEFAULT_USER_AGENT),
      }),
    );
    return { events, documents: [], fetchedPages: 1 };
  }
}

registerAdapter(new AlephAdapter());
