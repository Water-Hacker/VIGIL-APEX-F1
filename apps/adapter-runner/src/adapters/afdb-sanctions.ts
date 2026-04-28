import {
  Adapter,
  registerAdapter,
  type AdapterRunContext,
} from '@vigil/adapters';
import { Constants, type Schemas } from '@vigil/shared';
import { z } from 'zod';

import { apiJsonFetch, provenance } from './_helpers.js';

/**
 * afdb-sanctions — African Development Bank debarred-entities feed.
 * Public CSV-as-JSON endpoint mirrored by the AfDB Office of Integrity.
 */
const SOURCE_ID = 'afdb-sanctions';
const URL = 'https://www.afdb.org/api/v2/sanctions';

const zEntry = z.object({
  entity_name: z.string(),
  country: z.string().nullable().optional(),
  ineligibility_from: z.string().nullable().optional(),
  ineligibility_to: z.string().nullable().optional(),
  grounds: z.string().nullable().optional(),
});
const zSchema = z.object({ data: z.array(zEntry) });

class AfdbAdapter extends Adapter {
  public readonly sourceId = SOURCE_ID;
  public readonly defaultRateIntervalMs = 1_500;

  protected async execute(ctx: AdapterRunContext): Promise<{
    events: ReadonlyArray<Schemas.SourceEvent>;
    documents: ReadonlyArray<Schemas.Document>;
    fetchedPages: number;
  }> {
    const { data, status, responseSha } = await apiJsonFetch(ctx, SOURCE_ID, URL, zSchema);
    const events: Schemas.SourceEvent[] = data.data.map((row) =>
      this.makeEvent({
        kind: 'sanction',
        dedupKey: this.dedupKey([SOURCE_ID, row.entity_name, row.country ?? '', row.ineligibility_from ?? '']),
        payload: {
          name: row.entity_name,
          country: row.country ?? null,
          from: row.ineligibility_from ?? null,
          to: row.ineligibility_to ?? null,
          grounds: row.grounds ?? null,
          sanctioning_body: 'AFDB',
        },
        publishedAt: null,
        provenance: provenance(URL, status, responseSha, ctx, Constants.ADAPTER_DEFAULT_USER_AGENT),
      }),
    );
    return { events, documents: [], fetchedPages: 1 };
  }
}

registerAdapter(new AfdbAdapter());
