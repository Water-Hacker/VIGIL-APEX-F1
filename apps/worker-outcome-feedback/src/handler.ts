import { randomUUID } from 'node:crypto';

import { z } from 'zod';

import {
  matchSignalAgainstDossiers,
  type OperationalSignal,
  type DeliveredDossierSummary,
} from './outcome-matching.js';

import type { HashChain } from '@vigil/audit-chain';
import type { DeliveredDossierRow, DossierOutcomeRepo } from '@vigil/db-postgres';
import type { Logger } from '@vigil/observability';
import type { Envelope, HandlerOutcome } from '@vigil/queue';

/**
 * Operational-signal envelope payload — the canonical shape that
 * adapter-runner feeds (CONAC press / Cour Suprême / ARMP / TPI roll /
 * ANIF / MINFI) emit onto STREAMS.OUTCOME_SIGNAL.
 */
export const zOutcomeSignalPayload = z.object({
  signal_id: z.string().min(1).max(200),
  source: z.enum([
    'conac_press',
    'cour_supreme',
    'armp_debarment',
    'tpi_court_roll',
    'anif_bulletin',
    'minfi_clawback',
  ]),
  kind: z.enum([
    'investigation_opened',
    'charges_filed',
    'conviction',
    'acquittal',
    'debarment',
    'fine_assessed',
    'asset_freeze',
    'asset_clawback',
    'case_closed_without_action',
  ]),
  date: z.string().datetime({ offset: true }),
  text: z.string().min(1).max(20_000),
  entities_mentioned: z.array(z.string().min(1).max(400)).max(50),
  amount_xaf: z.number().int().nonnegative().optional(),
});
export type OutcomeSignalPayload = z.infer<typeof zOutcomeSignalPayload>;

export interface OutcomeFeedbackContext {
  readonly chain: HashChain;
  readonly outcomeRepo: DossierOutcomeRepo;
  readonly listDelivered: (windowDays: number) => Promise<ReadonlyArray<DeliveredDossierRow>>;
  readonly logger: Logger;
  /** Default 540 days (≈18 months) — half of the maximum 36-month
   *  attribution window. Tighter than 1080 reduces false-positive load
   *  on operators triaging the dashboard match queue. */
  readonly windowDays?: number;
}

export function dossierRowToSummary(r: DeliveredDossierRow): DeliveredDossierSummary {
  return {
    dossier_ref: r.dossier_ref,
    recipient_body: (r.recipient_body_name as DeliveredDossierSummary['recipient_body']) ?? 'OTHER',
    delivered_at: r.delivered_at,
    primary_entity_id: r.primary_entity_id ?? '',
    primary_entity_name: r.primary_entity_name ?? '',
    primary_entity_aliases: r.primary_entity_aliases,
    ...(r.rccm ? { rccm: r.rccm } : {}),
    ...(r.niu ? { niu: r.niu } : {}),
    ubo_names: r.ubo_names,
    pattern_categories: r.pattern_categories,
  };
}

/**
 * Handler: for one inbound signal, list recently delivered dossiers
 * within `windowDays`, run `matchSignalAgainstDossiers`, persist every
 * high-confidence match via DossierOutcomeRepo.insertIfAbsent, and
 * append one `audit.dossier_outcome_matched` chain row per persisted
 * match.
 *
 * Idempotent: `insertIfAbsent` is keyed on (signal_id, dossier_id) so a
 * re-delivery of the same signal does not produce duplicate rows or
 * duplicate audit-chain entries.
 */
export async function handleOutcomeSignal(
  ctx: OutcomeFeedbackContext,
  env: Envelope<OutcomeSignalPayload>,
): Promise<HandlerOutcome> {
  const windowDays = ctx.windowDays ?? 540;
  let rows: ReadonlyArray<DeliveredDossierRow>;
  try {
    rows = await ctx.listDelivered(windowDays);
  } catch (err) {
    ctx.logger.error({ err: (err as Error).message }, 'outcome-feedback-list-delivered-failed');
    return { kind: 'retry', reason: 'list delivered failed', delay_ms: 5_000 };
  }

  const candidates: DeliveredDossierSummary[] = rows.map(dossierRowToSummary);
  const signal: OperationalSignal = {
    signal_id: env.payload.signal_id,
    source: env.payload.source,
    kind: env.payload.kind,
    date: env.payload.date,
    text: env.payload.text,
    entities_mentioned: env.payload.entities_mentioned,
    ...(env.payload.amount_xaf !== undefined ? { amount_xaf: env.payload.amount_xaf } : {}),
  };

  const matches = matchSignalAgainstDossiers(signal, candidates);
  let highConfidenceCount = 0;
  for (const m of matches) {
    if (!m.is_high_confidence) continue;
    const dossier = rows.find((r) => r.dossier_ref === m.dossier_ref);
    if (!dossier) continue;
    const { inserted } = await ctx.outcomeRepo.insertIfAbsent({
      id: randomUUID(),
      dossier_id: dossier.dossier_id,
      dossier_ref: dossier.dossier_ref,
      signal_id: env.payload.signal_id,
      signal_source: env.payload.source,
      signal_kind: env.payload.kind,
      signal_date: new Date(env.payload.date),
      match_score: m.score.toFixed(4),
      entity_overlap: m.dimensions.entity_overlap.toFixed(4),
      temporal_proximity: m.dimensions.temporal_proximity.toFixed(4),
      body_alignment: m.dimensions.body_alignment.toFixed(4),
      category_alignment: m.dimensions.category_alignment.toFixed(4),
      is_high_confidence: true,
      rationale: m.rationale,
      matched_at: new Date(),
      audit_event_id: null,
    });
    if (!inserted) continue;
    highConfidenceCount += 1;
    await ctx.chain.append({
      action: 'audit.dossier_outcome_matched',
      actor: 'system:worker-outcome-feedback',
      subject_kind: 'dossier',
      subject_id: dossier.dossier_ref,
      payload: {
        signal_id: env.payload.signal_id,
        signal_source: env.payload.source,
        signal_kind: env.payload.kind,
        match_score: m.score,
        entity_overlap: m.dimensions.entity_overlap,
        temporal_proximity: m.dimensions.temporal_proximity,
        correlation_id: env.correlation_id,
      },
    });
  }

  ctx.logger.info(
    {
      signal_id: env.payload.signal_id,
      candidates: candidates.length,
      total_matches: matches.length,
      high_confidence_persisted: highConfidenceCount,
    },
    'outcome-feedback-processed',
  );
  return { kind: 'ack' };
}
