import { createHash } from 'node:crypto';

import { Adapter, registerAdapter, type AdapterRunContext } from '@vigil/adapters';
import { Constants, Errors, type Schemas } from '@vigil/shared';
import { z } from 'zod';

import { boundedBodyText, boundedRequest } from './_bounded-fetch.js';

/**
 * worldbank-sanctions — World Bank Group debarred-firms list (open API).
 * Reference adapter for sanctions tier (also covers AfDB/EU/OFAC/UN Sanctions
 * with parameter substitution).
 */

const SOURCE_ID = 'worldbank-sanctions';
const API_URL =
  'https://apigwext.worldbank.org/dvsvc/v1.0/json/APPLICATION/ADOBE_EXPRNCE_MGR/FIRM/SANCTIONED_FIRM';

const zRow = z.object({
  FIRM_NAME: z.string(),
  COUNTRY: z.string().nullable().optional(),
  INELIGIBILITY_FROM: z.string().nullable().optional(),
  INELIGIBILITY_TO: z.string().nullable().optional(),
  GROUNDS: z.string().nullable().optional(),
});
const zPayload = z.object({
  data: z.object({
    response: z.object({
      ZPROCSUPP: z.array(zRow),
    }),
  }),
});

class WorldBankSanctionsAdapter extends Adapter {
  public readonly sourceId = SOURCE_ID;
  public readonly defaultRateIntervalMs = 1_000;

  protected async execute(ctx: AdapterRunContext): Promise<{
    events: ReadonlyArray<Schemas.SourceEvent>;
    documents: ReadonlyArray<Schemas.Document>;
    fetchedPages: number;
  }> {
    const resp = await boundedRequest(API_URL, {
      method: 'GET',
      headers: { 'user-agent': Constants.ADAPTER_DEFAULT_USER_AGENT, accept: 'application/json' },
    });
    if (resp.statusCode >= 500) {
      throw new Errors.SourceUnavailableError(SOURCE_ID, resp.statusCode, { url: API_URL });
    }
    const text = await boundedBodyText(resp.body, { sourceId: SOURCE_ID, url: API_URL });
    const parsed = zPayload.safeParse(JSON.parse(text));
    if (!parsed.success) {
      throw new Errors.SourceParseError(SOURCE_ID, { url: API_URL, html: text.slice(0, 100_000) });
    }
    const respSha = createHash('sha256').update(text).digest('hex');
    const events: Schemas.SourceEvent[] = parsed.data.data.response.ZPROCSUPP.map((row) =>
      this.makeEvent({
        kind: 'sanction',
        dedupKey: this.dedupKey([
          SOURCE_ID,
          row.FIRM_NAME,
          row.COUNTRY ?? '',
          row.INELIGIBILITY_FROM ?? '',
        ]),
        payload: {
          name: row.FIRM_NAME,
          country: row.COUNTRY ?? null,
          from: row.INELIGIBILITY_FROM ?? null,
          to: row.INELIGIBILITY_TO ?? null,
          grounds: row.GROUNDS ?? null,
          sanctioning_body: 'WORLD_BANK',
        },
        publishedAt: null,
        provenance: {
          url: API_URL,
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

registerAdapter(new WorldBankSanctionsAdapter());
