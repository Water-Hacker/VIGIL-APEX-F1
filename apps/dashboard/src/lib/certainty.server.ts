import 'server-only';

import {
  CalibrationAuditRepo,
  CallRecordRepo,
  CertaintyRepo,
  VerbatimAuditRepo,
  getDb,
} from '@vigil/db-postgres';

let cached: {
  certainty: CertaintyRepo;
  audit: CalibrationAuditRepo;
  callRecords: CallRecordRepo;
  verbatim: VerbatimAuditRepo;
} | null = null;

async function repos() {
  if (cached) return cached;
  const db = await getDb();
  cached = {
    certainty: new CertaintyRepo(db),
    audit: new CalibrationAuditRepo(db),
    callRecords: new CallRecordRepo(db),
    verbatim: new VerbatimAuditRepo(db),
  };
  return cached;
}

export interface AssessmentSummary {
  readonly id: string;
  readonly engineVersion: string;
  readonly priorProbability: number;
  readonly posteriorProbability: number;
  readonly independentSourceCount: number;
  readonly tier: 'action_queue' | 'investigation_queue' | 'log_only';
  readonly holdReasons: readonly string[];
  readonly modelVersion: string;
  readonly inputHash: string;
  readonly promptRegistryHash: string;
  readonly computedAt: string;
  readonly adversarial: {
    readonly devilsAdvocateCoherent: boolean;
    readonly devilsAdvocateSummary: string | null;
    readonly counterfactualRobust: boolean;
    readonly counterfactualPosterior: number;
    readonly orderRandomisationStable: boolean;
    readonly orderRandomisationMin: number;
    readonly orderRandomisationMax: number;
    readonly secondaryReviewAgreement: boolean;
  };
  readonly components: ReadonlyArray<{
    readonly evidence_id: string;
    readonly pattern_id: string | null;
    readonly source_id: string | null;
    readonly strength: number;
    readonly likelihood_ratio: number;
    readonly effective_weight: number;
    readonly provenance_roots: ReadonlyArray<string>;
    readonly verbatim_quote: string | null;
    readonly rationale: string;
  }>;
}

export async function getLatestAssessment(findingId: string): Promise<AssessmentSummary | null> {
  const r = await repos();
  const row = await r.certainty.latestForFinding(findingId);
  if (!row) return null;
  return {
    id: row.id,
    engineVersion: row.engine_version,
    priorProbability: Number(row.prior_probability),
    posteriorProbability: Number(row.posterior_probability),
    independentSourceCount: row.independent_source_count,
    tier: row.tier as AssessmentSummary['tier'],
    holdReasons: row.hold_reasons,
    modelVersion: row.model_version,
    inputHash: row.input_hash,
    promptRegistryHash: row.prompt_registry_hash,
    computedAt: row.computed_at.toISOString(),
    adversarial: {
      devilsAdvocateCoherent: (row.adversarial as Record<string, unknown>)?.['devils_advocate_coherent'] === true,
      devilsAdvocateSummary:
        ((row.adversarial as Record<string, unknown>)?.['devils_advocate_summary'] as string | null) ?? null,
      counterfactualRobust:
        (row.adversarial as Record<string, unknown>)?.['counterfactual_robust'] !== false,
      counterfactualPosterior: Number(
        (row.adversarial as Record<string, unknown>)?.['counterfactual_posterior'] ?? 0,
      ),
      orderRandomisationStable:
        (row.adversarial as Record<string, unknown>)?.['order_randomisation_stable'] !== false,
      orderRandomisationMin: Number(
        (row.adversarial as Record<string, unknown>)?.['order_randomisation_min'] ?? 0,
      ),
      orderRandomisationMax: Number(
        (row.adversarial as Record<string, unknown>)?.['order_randomisation_max'] ?? 0,
      ),
      secondaryReviewAgreement:
        (row.adversarial as Record<string, unknown>)?.['secondary_review_agreement'] !== false,
    },
    components: (row.components as AssessmentSummary['components']) ?? [],
  };
}

export interface ReliabilityRow {
  readonly bandLabel: string;
  readonly bandMin: number;
  readonly bandMax: number;
  readonly predictedRate: number;
  readonly observedRate: number;
  readonly findingCount: number;
  readonly clearedCount: number;
  readonly confirmedCount: number;
  readonly calibrationGap: number;
}

export interface CalibrationView {
  readonly periodLabel: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly engineVersion: string;
  readonly bands: ReadonlyArray<ReliabilityRow>;
  readonly perPatternGap: ReadonlyArray<{ patternId: string; gap: number }>;
  readonly anchorAuditEventId: string | null;
}

export async function getLatestCalibrationView(): Promise<CalibrationView | null> {
  const r = await repos();
  const runs = await r.audit.listRuns(1);
  const run = runs[0];
  if (!run) return null;
  const bands = await r.audit.listBands(run.id);
  return {
    periodLabel: run.period_label,
    periodStart: run.period_start.toISOString(),
    periodEnd: run.period_end.toISOString(),
    engineVersion: run.engine_version,
    bands: bands.map((b) => ({
      bandLabel: b.band_label,
      bandMin: Number(b.band_min),
      bandMax: Number(b.band_max),
      predictedRate: Number(b.predicted_rate),
      observedRate: Number(b.observed_rate),
      findingCount: b.finding_count,
      clearedCount: b.cleared_count,
      confirmedCount: b.confirmed_count,
      calibrationGap: Number(b.calibration_gap),
    })),
    perPatternGap: Object.entries(
      (run.per_pattern_gap as Record<string, number>) ?? {},
    ).map(([patternId, gap]) => ({ patternId, gap: Number(gap) })),
    anchorAuditEventId: run.anchor_audit_event_id,
  };
}

export interface AiSafetyHealth {
  readonly windowHours: number;
  readonly totalCalls: number;
  readonly canaryTriggered: number;
  readonly schemaInvalid: number;
  readonly verbatimSampled: number;
  readonly hallucinationRate: number;
}

export async function getAiSafetyHealth(windowHours = 24): Promise<AiSafetyHealth> {
  const r = await repos();
  const since = new Date(Date.now() - windowHours * 3_600_000).toISOString();
  const [calls, audit] = await Promise.all([
    r.callRecords.healthSnapshot(since),
    r.verbatim.hallucinationRate(since),
  ]);
  return {
    windowHours,
    totalCalls: calls.totalCalls,
    canaryTriggered: calls.canaryTriggered,
    schemaInvalid: calls.schemaInvalid,
    verbatimSampled: audit.sampled,
    hallucinationRate: audit.rate,
  };
}
