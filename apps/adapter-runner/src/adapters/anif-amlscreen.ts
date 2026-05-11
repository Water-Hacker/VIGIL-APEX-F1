import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { Adapter, registerAdapter, type AdapterRunContext } from '@vigil/adapters';
import { Constants, Errors, type Schemas } from '@vigil/shared';
import { z } from 'zod';

import { boundedBodyText, boundedRequest } from './_bounded-fetch.js';

/**
 * anif-amlscreen — Agence Nationale d'Investigation Financière (Cameroon FIU)
 * AML / PEP screening adapter (Phase-2-prep placeholder).
 *
 * ANIF maintains the authoritative national PEP registry (broader than any
 * public OFAC / EU list — it includes Cameroonian elected officials, military
 * brass, judges, and their immediate families). Under a Phase-2 MOU we
 * receive a daily delta:
 *   - additions / removals on the PEP register
 *   - sanctions-list updates ANIF has aggregated from CEMAC + AU + UN
 *   - PEP-relationship updates (e.g. new spouse, new business address)
 *
 * Auth: API key in the `X-ANIF-Key` header, rotated quarterly. The key
 * lives in `secret/vigil/anif/api_key` and rotates via the F10 timer.
 *
 * The MOU restricts what we can do with ANIF data:
 *   - PEP records may be referenced by VIGIL APEX findings but not surfaced
 *     in public verify-page output (operator-only).
 *   - Sanctions records may be cited publicly with attribution.
 * worker-dossier already strips PEP rationale text from the public
 * dossier renderer when ANIF is the only citation source.
 *
 * Switching from placeholder → live at MOU-day:
 *   1. Provision Vault path `secret/vigil/anif/api_key`
 *   2. Set `ANIF_BASE_URL`
 *   3. Set `ANIF_ENABLED=1`
 *   4. Restart adapter-runner
 */
const SOURCE_ID = 'anif-amlscreen';
const DEFAULT_BASE_URL = 'https://anif.minfi.cm/api/v2';

const zAnifPepRecord = z.object({
  anif_id: z.string(),
  full_name: z.string(),
  function: z.string(),
  pep_class: z.enum(['domestic', 'foreign', 'international_org', 'family', 'close_associate']),
  start_date: z.string(),
  end_date: z.string().nullable(),
  niu: z.string().optional(),
  rccm_links: z.array(z.string()).default([]),
});
const zAnifSanctionRecord = z.object({
  anif_id: z.string(),
  list_origin: z.string(), // 'UN-1267' | 'CEMAC-INTERNAL' | 'EU-CFSP' | …
  subject_name: z.string(),
  subject_kind: z.enum(['person', 'company', 'vessel']),
  added_at: z.string(),
  removed_at: z.string().nullable(),
});
const zAnifDelta = z.object({
  generated_at: z.string(),
  pep_records: z.array(zAnifPepRecord).max(5_000),
  sanction_records: z.array(zAnifSanctionRecord).max(5_000),
});

class AnifAmlScreenAdapter extends Adapter {
  public readonly sourceId = SOURCE_ID;
  // Daily pull is enough — ANIF's own register updates on a daily cadence.
  public readonly defaultRateIntervalMs = 24 * 3600_000;

  protected async execute(ctx: AdapterRunContext): Promise<{
    events: ReadonlyArray<Schemas.SourceEvent>;
    documents: ReadonlyArray<Schemas.Document>;
    fetchedPages: number;
  }> {
    if (process.env.ANIF_ENABLED !== '1') {
      this.logger.info('anif-amlscreen disabled (MOU pending) — no events emitted');
      return { events: [], documents: [], fetchedPages: 0 };
    }
    // AUDIT-003 — same shape as AUDIT-001: refuse the run when ENABLED was
    // flipped without the MOU countersignature, instead of silently passing
    // through to a downstream API that will reject every unsigned request.
    if (process.env.ANIF_MOU_ACK !== '1') {
      throw new Error(
        'anif-amlscreen: ANIF_ENABLED=1 but ANIF_MOU_ACK is not "1"; refusing to run before the MOU is countersigned',
      );
    }

    const baseUrl = process.env.ANIF_BASE_URL ?? DEFAULT_BASE_URL;
    const apiKey =
      process.env.ANIF_API_KEY ??
      tryRead(process.env.ANIF_API_KEY_FILE ?? '/run/secrets/anif_api_key');
    if (!apiKey) {
      throw new Errors.SourceBlockedError(SOURCE_ID, {
        url: baseUrl,
        status: 0,
        reason: 'anif api key not provisioned',
      });
    }

    const url = `${baseUrl}/delta/latest`;
    const r = await boundedRequest(url, {
      method: 'GET',
      headers: {
        'X-ANIF-Key': apiKey,
        'user-agent': Constants.ADAPTER_DEFAULT_USER_AGENT,
        accept: 'application/json',
      },
    });

    if (r.statusCode === 401 || r.statusCode === 403) {
      throw new Errors.SourceBlockedError(SOURCE_ID, { url, status: r.statusCode });
    }
    if (r.statusCode >= 500) {
      throw new Errors.SourceUnavailableError(SOURCE_ID, r.statusCode, { url });
    }

    const text = await boundedBodyText(r.body, { sourceId: SOURCE_ID, url });
    const responseSha = createHash('sha256').update(text).digest('hex');
    const parsed = zAnifDelta.safeParse(JSON.parse(text));
    if (!parsed.success) {
      throw new Errors.SourceParseError(SOURCE_ID, {
        url,
        html: text.slice(0, 100_000),
        issues: JSON.stringify(parsed.error.issues.slice(0, 5)),
      });
    }

    const events: Schemas.SourceEvent[] = [];
    // Tier 3 hardening — PEP-data egress gate. ANIF supplies politically
    // exposed-person matches; surfacing those to the operator UI requires
    // the architect to explicitly opt in via ANIF_PEP_SURFACE_ALLOWED. A
    // misconfigured `ANIF_ENABLED=1` without the egress flag must NOT
    // cause PEP rows to land. Sanction rows (Section list, OFAC echoes)
    // remain available since those are public commitments.
    const pepSurfaceAllowed = process.env.ANIF_PEP_SURFACE_ALLOWED === '1';
    if (!pepSurfaceAllowed && parsed.data.pep_records.length > 0) {
      this.logger.warn(
        { pep_records_dropped: parsed.data.pep_records.length },
        'anif pep_match events stripped at adapter — set ANIF_PEP_SURFACE_ALLOWED=1 to surface',
      );
    }
    const pepRecords = pepSurfaceAllowed ? parsed.data.pep_records : [];
    for (const pep of pepRecords) {
      events.push(
        this.makeEvent({
          kind: 'pep_match',
          dedupKey: this.dedupKey([SOURCE_ID, 'pep', pep.anif_id]),
          payload: {
            anif_id: pep.anif_id,
            full_name: pep.full_name,
            function: pep.function,
            pep_class: pep.pep_class,
            start_date: pep.start_date,
            end_date: pep.end_date,
            niu: pep.niu ?? null,
            rccm_links: pep.rccm_links,
          },
          publishedAt: pep.start_date,
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
    for (const s of parsed.data.sanction_records) {
      events.push(
        this.makeEvent({
          kind: 'sanction',
          dedupKey: this.dedupKey([SOURCE_ID, 'san', s.anif_id]),
          payload: {
            anif_id: s.anif_id,
            list_origin: s.list_origin,
            subject_name: s.subject_name,
            subject_kind: s.subject_kind,
            added_at: s.added_at,
            removed_at: s.removed_at,
          },
          publishedAt: s.added_at,
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

    this.logger.info(
      { peps: parsed.data.pep_records.length, sanctions: parsed.data.sanction_records.length },
      'anif-amlscreen-run-complete',
    );
    return { events, documents: [], fetchedPages: 1 };
  }
}

function tryRead(path: string): string | null {
  try {
    return readFileSync(path, 'utf8').trim();
  } catch {
    return null;
  }
}

registerAdapter(new AnifAmlScreenAdapter());
