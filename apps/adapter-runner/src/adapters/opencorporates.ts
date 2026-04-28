import {
  Adapter,
  registerAdapter,
  type AdapterRunContext,
} from '@vigil/adapters';
import { Constants, type Schemas } from '@vigil/shared';
import { z } from 'zod';

import { apiJsonFetch, provenance } from './_helpers.js';

/**
 * opencorporates — global registry. We pull the Cameroon-jurisdiction slice
 * keyed by recent updates and project director histories. API key required;
 * loaded by adapter-runner from Vault and passed via `OPENCORPORATES_API_KEY`.
 */
const SOURCE_ID = 'opencorporates';
const BASE = 'https://api.opencorporates.com/v0.4';

const zCompany = z.object({
  company_number: z.string(),
  name: z.string(),
  jurisdiction_code: z.string(),
  incorporation_date: z.string().nullable().optional(),
  current_status: z.string().nullable().optional(),
  registry_url: z.string().nullable().optional(),
});
const zResp = z.object({
  results: z.object({
    companies: z.array(z.object({ company: zCompany })),
  }),
});

class OpenCorporatesAdapter extends Adapter {
  public readonly sourceId = SOURCE_ID;
  public readonly defaultRateIntervalMs = 1_500;

  protected async execute(ctx: AdapterRunContext): Promise<{
    events: ReadonlyArray<Schemas.SourceEvent>;
    documents: ReadonlyArray<Schemas.Document>;
    fetchedPages: number;
  }> {
    const apiKey = process.env.OPENCORPORATES_API_KEY ?? '';
    const url = `${BASE}/companies/search?jurisdiction_code=cm&order=incorporation_date_desc&per_page=100&api_token=${encodeURIComponent(apiKey)}`;
    const { data, status, responseSha } = await apiJsonFetch(ctx, SOURCE_ID, url, zResp);
    const events: Schemas.SourceEvent[] = data.results.companies.map(({ company }) =>
      this.makeEvent({
        kind: 'company_filing',
        dedupKey: this.dedupKey([SOURCE_ID, company.jurisdiction_code, company.company_number]),
        payload: {
          name: company.name,
          jurisdiction: company.jurisdiction_code,
          rccm_or_company_number: company.company_number,
          incorporation_date: company.incorporation_date ?? null,
          status: company.current_status ?? null,
          registry_url: company.registry_url ?? null,
        },
        publishedAt: company.incorporation_date ?? null,
        provenance: provenance(url, status, responseSha, ctx, Constants.ADAPTER_DEFAULT_USER_AGENT),
      }),
    );
    return { events, documents: [], fetchedPages: 1 };
  }
}

registerAdapter(new OpenCorporatesAdapter());
