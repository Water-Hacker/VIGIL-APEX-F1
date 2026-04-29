import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import {
  Adapter,
  registerAdapter,
  type AdapterRunContext,
} from '@vigil/adapters';
import { Constants, Errors, type Schemas } from '@vigil/shared';
import { Agent, request } from 'undici';
import { z } from 'zod';

/**
 * minfi-bis — MINFI Budget Information System (Phase-2-prep placeholder).
 *
 * MOU-gated direct API adapter that supersedes the SFTP / portal scrape
 * (`minfi-portal`) once the MINFI MOU is signed. The credentials and the
 * exact endpoint shape will be fixed by the MOU; until then this adapter
 * is wired against the documented SchemaBis v3 OpenAPI contract that the
 * MINFI/DGTCFM team published in their 2024 transparency consultation.
 *
 * Switching from placeholder → live at MOU-day:
 *   1. Provision Vault paths under `secret/vigil/minfi-bis/*`
 *   2. Set `MINFI_BIS_BASE_URL` env on the adapter-runner container
 *   3. Set `MINFI_BIS_ENABLED=1`
 *   4. Restart the adapter-runner; nothing else changes
 *
 * Authentication: mTLS client certificate issued by the MINFI internal CA
 * AT the MOU ceremony; the cert + key materialise at
 * `/run/secrets/minfi_bis_client_{cert,key}` via the B1 secret-init pipeline.
 *
 * For pre-MOU runs the adapter no-ops (returns zero events) but stays in
 * the registry so the worker pool is uniform across environments and the
 * eventual flip is a single env-var change.
 */
const SOURCE_ID = 'minfi-bis';
const DEFAULT_BASE_URL = 'https://bis.minfi.cm/api/v3';

// Paginated payment list — mirrors the documented MINFI BIS contract.
const zMinfiPayment = z.object({
  payment_id: z.string(),
  authorization_reference: z.string().optional(),
  contract_reference: z.string().optional(),
  recipient: z.object({
    rccm: z.string().optional(),
    niu: z.string().optional(),
    name: z.string(),
  }),
  amount_xaf: z.number().int(),
  payment_date: z.string(), // ISO date
  beneficiary_bank_country: z.string().length(2).optional(),
  beneficiary_iban: z.string().optional(),
});
const zMinfiPaymentPage = z.object({
  data: z.array(zMinfiPayment).max(500),
  page: z.number().int(),
  has_next: z.boolean(),
  next_cursor: z.string().nullable(),
});

class MinfiBisAdapter extends Adapter {
  public readonly sourceId = SOURCE_ID;
  // Daily pull during pilot; ramp up once volume is known.
  public readonly defaultRateIntervalMs = 5 * 60_000;

  protected async execute(ctx: AdapterRunContext): Promise<{
    events: ReadonlyArray<Schemas.SourceEvent>;
    documents: ReadonlyArray<Schemas.Document>;
    fetchedPages: number;
  }> {
    if (process.env.MINFI_BIS_ENABLED !== '1') {
      // Pre-MOU no-op: emit nothing, log once per run, surface in adapter_health
      // so operations can see the placeholder is reachable.
      this.logger.info('minfi-bis disabled (MOU pending) — no events emitted');
      return { events: [], documents: [], fetchedPages: 0 };
    }

    const baseUrl = process.env.MINFI_BIS_BASE_URL ?? DEFAULT_BASE_URL;
    const cert = readMtlsMaterial('MINFI_BIS_CLIENT_CERT', '/run/secrets/minfi_bis_client_cert');
    const key = readMtlsMaterial('MINFI_BIS_CLIENT_KEY', '/run/secrets/minfi_bis_client_key');
    const ca = readMtlsMaterial('MINFI_BIS_CA_CERT', '/run/secrets/minfi_bis_ca_cert');

    // Tier 3 hardening — wire the mTLS material into a real undici Agent so
    // the request actually presents the client certificate. The previous
    // shape only loaded the bytes and `void`-ed them; that worked at the
    // header level but never authenticated the TLS handshake.
    const dispatcher = new Agent({
      connect: {
        rejectUnauthorized: true,
        ...(cert !== null && { cert }),
        ...(key !== null && { key }),
        ...(ca !== null && { ca }),
      },
    });

    const since = process.env.MINFI_BIS_LOOKBACK_HOURS
      ? `?since=${new Date(Date.now() - Number(process.env.MINFI_BIS_LOOKBACK_HOURS) * 3600_000).toISOString()}`
      : '?since=' + new Date(Date.now() - 25 * 3600_000).toISOString(); // 25h covers daily cron + slack

    const events: Schemas.SourceEvent[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const url: string = `${baseUrl}/payments${cursor ? `?cursor=${cursor}` : since}`;
      const r = await request(url, {
        method: 'GET',
        headers: {
          'user-agent': Constants.getAdapterUserAgent(),
          accept: 'application/json',
        },
        dispatcher,
      });

      if (r.statusCode === 401 || r.statusCode === 403) {
        throw new Errors.SourceBlockedError(SOURCE_ID, { url, status: r.statusCode });
      }
      if (r.statusCode >= 500) {
        throw new Errors.SourceUnavailableError(SOURCE_ID, r.statusCode, { url });
      }

      const text = await r.body.text();
      const responseSha = createHash('sha256').update(text).digest('hex');
      const parsed = zMinfiPaymentPage.safeParse(JSON.parse(text));
      if (!parsed.success) {
        throw new Errors.SourceParseError(SOURCE_ID, {
          url,
          html: text.slice(0, 100_000),
          issues: JSON.stringify(parsed.error.issues.slice(0, 5)),
        });
      }
      pages += 1;
      for (const p of parsed.data.data) {
        events.push(
          this.makeEvent({
            // BIS payments map to `payment_order`; `treasury_disbursement` is
            // reserved for the DGTCFM treasury feed (Phase 2 entry as well).
            kind: 'payment_order',
            dedupKey: this.dedupKey([SOURCE_ID, p.payment_id]),
            payload: {
              payment_id: p.payment_id,
              authorization_reference: p.authorization_reference,
              contract_reference: p.contract_reference,
              amount_xaf: p.amount_xaf,
              recipient_rccm: p.recipient.rccm ?? null,
              recipient_niu: p.recipient.niu ?? null,
              recipient_name: p.recipient.name,
              beneficiary_bank_country: p.beneficiary_bank_country ?? null,
              beneficiary_iban_suffix: p.beneficiary_iban?.slice(-4) ?? null,
            },
            publishedAt: p.payment_date,
            provenance: {
              url,
              http_status: r.statusCode,
              response_sha256: responseSha,
              fetched_via_proxy: ctx.proxy?.url ?? null,
              user_agent: Constants.ADAPTER_DEFAULT_USER_AGENT,
            },
          }),
        );
      }
      cursor = parsed.data.has_next ? parsed.data.next_cursor : null;
      // Hard cap pagination to avoid infinite loops on bad upstream data.
      if (pages >= 50) break;
    } while (cursor !== null);

    this.logger.info({ pages, events: events.length }, 'minfi-bis-run-complete');
    return { events, documents: [], fetchedPages: pages };
  }
}

function readMtlsMaterial(envVar: string, defaultPath: string): Buffer | null {
  const path = process.env[envVar] ?? defaultPath;
  try {
    return readFileSync(path);
  } catch {
    return null;
  }
}

registerAdapter(new MinfiBisAdapter());
