import { createHash } from 'node:crypto';

import { Adapter, registerAdapter, type AdapterRunContext } from '@vigil/adapters';
import { Constants, Errors, type Schemas } from '@vigil/shared';
import { z } from 'zod';

import { boundedBodyText, boundedRequest } from './_bounded-fetch.js';

/**
 * beac-payments — Banque des États de l'Afrique Centrale, payment-system
 * bridge (Phase-2-prep placeholder).
 *
 * BEAC operates the SYSTAC/SYGMA real-time gross-settlement systems for
 * the CEMAC region. Under a Phase-2 MOU we receive a daily delta of:
 *   - cross-border XAF→USD/EUR transfers ≥ a threshold the MOU sets
 *   - any payment with a beneficiary in a FATF-grey-listed jurisdiction
 *   - any payment whose ordering-customer or beneficiary appears on the
 *     BEAC-internal sanctions register
 *
 * We do NOT receive every transaction — that would be a privacy/scope
 * violation and is not in the v5.1 commercial agreement. The BEAC team
 * pre-filters on their side and delivers a digest.
 *
 * Auth: OAuth2 client_credentials with a BEAC-issued tenant client.
 * Token endpoint and tenant id come from `secret/vigil/beac/*`.
 *
 * Switching from placeholder → live at MOU-day:
 *   1. Provision Vault paths under `secret/vigil/beac/{client_id,client_secret,tenant_id}`
 *   2. Set `BEAC_BASE_URL` and `BEAC_TOKEN_URL`
 *   3. Set `BEAC_ENABLED=1`
 *   4. Re-run host-bootstrap/05-secret-materialisation.sh
 */
const SOURCE_ID = 'beac-payments';
const DEFAULT_BASE_URL = 'https://api.beac.int/payments/v1';
const DEFAULT_TOKEN_URL = 'https://auth.beac.int/oauth2/token';

const zBeacPayment = z.object({
  beac_reference: z.string(),
  payment_date: z.string(),
  ordering_customer: z.object({
    name: z.string(),
    country: z.string().length(2),
    account_suffix: z.string().optional(),
  }),
  beneficiary: z.object({
    name: z.string(),
    country: z.string().length(2),
    account_suffix: z.string().optional(),
  }),
  amount_xaf_equivalent: z.number().int(),
  currency: z.string().length(3),
  flags: z.array(
    z.enum(['cross_border', 'sanctioned_jurisdiction', 'sanctions_match', 'fatf_greylist']),
  ),
});
const zBeacDigest = z.object({
  generated_at: z.string(),
  payments: z.array(zBeacPayment).max(10_000),
});
const zBeacToken = z.object({
  access_token: z.string(),
  token_type: z.literal('Bearer'),
  expires_in: z.number().int().positive(),
});

class BeacPaymentsAdapter extends Adapter {
  public readonly sourceId = SOURCE_ID;
  // BEAC publishes a daily digest at 04:00 Africa/Douala; we pull at 06:00.
  public readonly defaultRateIntervalMs = 24 * 3600_000;

  private cachedToken: { token: string; expiresAt: number } | null = null;

  protected async execute(ctx: AdapterRunContext): Promise<{
    events: ReadonlyArray<Schemas.SourceEvent>;
    documents: ReadonlyArray<Schemas.Document>;
    fetchedPages: number;
  }> {
    if (process.env.BEAC_ENABLED !== '1') {
      this.logger.info('beac-payments disabled (MOU pending) — no events emitted');
      return { events: [], documents: [], fetchedPages: 0 };
    }
    // AUDIT-002 — same shape as AUDIT-001: refuse the run when ENABLED was
    // flipped without the MOU countersignature, instead of silently passing
    // through to a downstream API that will reject every unsigned request.
    if (process.env.BEAC_MOU_ACK !== '1') {
      throw new Error(
        'beac-payments: BEAC_ENABLED=1 but BEAC_MOU_ACK is not "1"; refusing to run before the MOU is countersigned',
      );
    }

    const baseUrl = process.env.BEAC_BASE_URL ?? DEFAULT_BASE_URL;
    const token = await this.getAccessToken();
    const url = `${baseUrl}/digest/latest`;
    const r = await boundedRequest(url, {
      method: 'GET',
      headers: {
        authorization: `Bearer ${token}`,
        'user-agent': Constants.ADAPTER_DEFAULT_USER_AGENT,
        accept: 'application/json',
      },
    });

    if (r.statusCode === 401) {
      // Token may be stale; force a refresh next call.
      this.cachedToken = null;
      throw new Errors.SourceBlockedError(SOURCE_ID, { url, status: r.statusCode });
    }
    if (r.statusCode >= 500) {
      throw new Errors.SourceUnavailableError(SOURCE_ID, r.statusCode, { url });
    }

    const text = await boundedBodyText(r.body, { sourceId: SOURCE_ID, url });
    const responseSha = createHash('sha256').update(text).digest('hex');
    const parsed = zBeacDigest.safeParse(JSON.parse(text));
    if (!parsed.success) {
      throw new Errors.SourceParseError(SOURCE_ID, {
        url,
        html: text.slice(0, 100_000),
        issues: JSON.stringify(parsed.error.issues.slice(0, 5)),
      });
    }

    const events: Schemas.SourceEvent[] = parsed.data.payments.map((p) => {
      // BEAC's `payment_order` kind aligns with the existing pattern set
      // (P-E-003, P-C-005). Sanctions-flagged rows additionally produce
      // a `sanction` event so worker-pattern P-E-001/P-E-002 fire reliably.
      const isSanctions = p.flags.includes('sanctions_match');
      const kind: Schemas.SourceEventKind = isSanctions ? 'sanction' : 'payment_order';
      return this.makeEvent({
        kind,
        dedupKey: this.dedupKey([SOURCE_ID, p.beac_reference]),
        payload: {
          beac_reference: p.beac_reference,
          ordering_customer_country: p.ordering_customer.country,
          ordering_customer_name: p.ordering_customer.name,
          beneficiary_country: p.beneficiary.country,
          beneficiary_bank_country: p.beneficiary.country,
          beneficiary_name: p.beneficiary.name,
          amount_xaf: p.amount_xaf_equivalent,
          currency: p.currency,
          flags: p.flags,
        },
        publishedAt: p.payment_date,
        provenance: {
          url,
          http_status: r.statusCode,
          response_sha256: responseSha,
          fetched_via_proxy: ctx.proxy?.url ?? null,
          user_agent: Constants.ADAPTER_DEFAULT_USER_AGENT,
        },
      });
    });

    this.logger.info({ events: events.length }, 'beac-payments-run-complete');
    return { events, documents: [], fetchedPages: 1 };
  }

  /**
   * OAuth2 client_credentials. BEAC's tenant id, client id, and secret
   * arrive from Vault via the secret-init B1 pipeline. Tokens are cached
   * in-process until 60 s before expiry.
   */
  private async getAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.cachedToken && this.cachedToken.expiresAt > now + 60_000) {
      return this.cachedToken.token;
    }
    const tokenUrl = process.env.BEAC_TOKEN_URL ?? DEFAULT_TOKEN_URL;
    const clientId = process.env.BEAC_CLIENT_ID ?? readSecretFile('/run/secrets/beac_client_id');
    const clientSecret =
      process.env.BEAC_CLIENT_SECRET ?? readSecretFile('/run/secrets/beac_client_secret');
    if (!clientId || !clientSecret) {
      throw new Errors.SourceBlockedError(SOURCE_ID, {
        url: tokenUrl,
        status: 0,
        reason: 'beac credentials not provisioned',
      });
    }
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
      scope: 'payments.read sanctions.read',
    });
    const resp = await boundedRequest(tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    if (resp.statusCode !== 200) {
      throw new Errors.SourceBlockedError(SOURCE_ID, { url: tokenUrl, status: resp.statusCode });
    }
    const tokenText = await boundedBodyText(resp.body, { sourceId: SOURCE_ID, url: tokenUrl });
    const parsed = zBeacToken.parse(JSON.parse(tokenText));
    this.cachedToken = {
      token: parsed.access_token,
      expiresAt: now + parsed.expires_in * 1000,
    };
    return parsed.access_token;
  }
}

function readSecretFile(path: string): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('node:fs') as typeof import('node:fs');
    return fs.readFileSync(path, 'utf8').trim();
  } catch {
    return null;
  }
}

registerAdapter(new BeacPaymentsAdapter());
