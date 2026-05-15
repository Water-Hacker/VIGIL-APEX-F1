import 'server-only';

import { DossierOutcomeRepo, getDb } from '@vigil/db-postgres';

let cached: DossierOutcomeRepo | null = null;

async function repo(): Promise<DossierOutcomeRepo> {
  if (cached) return cached;
  const db = await getDb();
  cached = new DossierOutcomeRepo(db);
  return cached;
}

export interface OutcomeView {
  readonly id: string;
  readonly dossier_ref: string;
  readonly signal_id: string;
  readonly signal_source: string;
  readonly signal_kind: string;
  readonly signal_date: string;
  readonly match_score: number;
  readonly entity_overlap: number;
  readonly temporal_proximity: number;
  readonly body_alignment: number;
  readonly category_alignment: number;
  readonly rationale: string;
  readonly matched_at: string;
}

/**
 * List the outcome rows that worker-outcome-feedback wrote for every
 * dossier whose ref matches one of the dossiers attached to this
 * finding. We dedupe on (dossier_ref) before resolving by joining on
 * dossier_id at the repo layer.
 */
export async function listOutcomesForFinding(
  dossierIds: ReadonlyArray<string>,
): Promise<ReadonlyArray<OutcomeView>> {
  if (dossierIds.length === 0) return [];
  const r = await repo();
  const all: OutcomeView[] = [];
  for (const id of dossierIds) {
    const rows = await r.listForDossier(id, 20);
    for (const row of rows) {
      all.push({
        id: row.id,
        dossier_ref: row.dossier_ref,
        signal_id: row.signal_id,
        signal_source: row.signal_source,
        signal_kind: row.signal_kind,
        signal_date: row.signal_date.toISOString(),
        match_score: Number(row.match_score),
        entity_overlap: Number(row.entity_overlap),
        temporal_proximity: Number(row.temporal_proximity),
        body_alignment: Number(row.body_alignment),
        category_alignment: Number(row.category_alignment),
        rationale: row.rationale,
        matched_at: row.matched_at.toISOString(),
      });
    }
  }
  // newest first across dossiers
  all.sort((a, b) => b.matched_at.localeCompare(a.matched_at));
  return all;
}
