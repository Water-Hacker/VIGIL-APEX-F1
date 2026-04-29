import { type Schemas } from '@vigil/shared';

import { matched, notMatched, PID } from '../_pattern-helpers.js';
import { registerPattern } from '../registry.js';

import type { PatternDef } from '../types.js';

/**
 * P-D-005 — Fabricated progress reporting.
 *
 * Project periodic progress reports show consistent month-over-month
 * progress (≥ 5 %/month) but satellite imagery for the same months shows
 * no measurable activity change. The progress reports are likely fabricated.
 */
const ID = PID('P-D-005');

const definition: PatternDef = {
  id: ID,
  category: 'D',
  subjectKinds: ['Project'],
  title_fr: "Rapports d'avancement fabriqués",
  title_en: 'Fabricated progress reports',
  description_fr:
    "Les rapports périodiques affichent une progression alors que l'imagerie satellite ne montre aucun changement.",
  description_en:
    'Progress reports show steady advancement while satellite imagery shows no change in activity.',
  defaultPrior: 0.30,
  defaultWeight: 0.85,
  status: 'live',

  async detect(subject, _ctx): Promise<Schemas.PatternResult> {
    const reports = subject.events.filter(
      (e) =>
        e.kind === 'investment_project' &&
        typeof e.payload['progress_pct'] === 'number',
    );
    const sats = subject.events
      .filter((e) => e.kind === 'satellite_imagery')
      .sort((a, b) => (a.observed_at).localeCompare(b.observed_at));
    if (reports.length < 3 || sats.length < 2) return notMatched(ID, 'insufficient reports/satellite');

    // Compute progress reported vs activity delta
    const firstActivity = Number(sats[0]!.payload['activity_score'] ?? 0);
    const lastActivity = Number(sats[sats.length - 1]!.payload['activity_score'] ?? 0);
    const activityDelta = lastActivity - firstActivity;
    const reportedDelta =
      Number(reports[reports.length - 1]!.payload['progress_pct']) -
      Number(reports[0]!.payload['progress_pct']);
    if (reportedDelta < 15) return notMatched(ID, `reported delta only ${reportedDelta}%`);
    if (activityDelta > 0.15) return notMatched(ID, 'satellite confirms activity');

    const strength = Math.min(1, (reportedDelta - 15) / 50 + 0.5);
    return matched({
      pattern_id: ID,
      strength,
      contributing_event_ids: [...reports.map((r) => r.id), ...sats.map((s) => s.id)],
      rationale: `progress reports +${reportedDelta}% vs satellite activity Δ${activityDelta.toFixed(2)}`,
    });
  },
};

registerPattern(definition);
export default definition;
