/**
 * Operator AI co-pilot — pure suggestion logic.
 *
 * Closes FRONTIER-AUDIT Layer-1 E1.6: operator triage is manual today;
 * at 10× current throughput one operator cannot keep up. The co-pilot
 * pre-generates suggestions for each finding so the operator approves
 * / edits / rejects rather than reading every finding cold.
 *
 * This module is the DETERMINISTIC fallback co-pilot — no LLM call.
 * The frontier system pairs this with an LLM-generated rationale via
 * SafeLlmRouter; the deterministic baseline still works when the
 * LLM is unavailable (Bedrock + Anthropic both down). Calls produce
 * the same shape; the LLM path adds richer rationale text.
 *
 * Output:
 *   - suggested_classification: escalate | hold | dismiss
 *   - urgency_score: 0..1
 *   - top_next_actions: ordered list of operator-actionable steps
 *   - rationale: human-readable explanation
 *
 * Audit doctrine: the suggestion is RECORDED to the audit chain
 * alongside the operator's final decision. Divergence between
 * co-pilot suggestion and operator decision is auditable, and a
 * statistically anomalous divergence rate is itself a flag (an
 * operator systematically over-riding the co-pilot may indicate
 * either co-pilot drift or operator capture).
 */

import { Constants } from '@vigil/shared';

export interface FindingSnapshotForCopilot {
  readonly finding_id: string;
  readonly posterior: number;
  readonly signal_count: number;
  readonly primary_pattern_category: string | null;
  readonly signal_categories: ReadonlyArray<string>;
  readonly severity: 'low' | 'medium' | 'high' | 'critical';
  readonly created_at: string; // ISO-8601
  readonly tip_linked: boolean;
  readonly external_press_mentions: number;
  readonly entity_is_sanctioned_or_pep: boolean;
  /** Optional adversarial-pipeline outcomes. */
  readonly counter_evidence_coherent?: boolean;
  readonly hold_reasons?: ReadonlyArray<string>;
}

export type CopilotClassification = 'escalate' | 'hold' | 'dismiss';

export interface CopilotSuggestion {
  readonly classification: CopilotClassification;
  /** 0..1 — higher means handle this finding sooner. */
  readonly urgency_score: number;
  readonly top_next_actions: ReadonlyArray<string>;
  readonly rationale: string;
  readonly inputs: {
    readonly posterior: number;
    readonly signal_count: number;
    readonly conac_threshold_met: boolean;
    readonly counter_evidence_blocking: boolean;
    readonly hold_reasons: ReadonlyArray<string>;
  };
}

const STALE_AFTER_DAYS = 14;

export function generateCopilotSuggestion(
  finding: FindingSnapshotForCopilot,
  now: Date = new Date(),
): CopilotSuggestion {
  const conacThresholdMet =
    finding.posterior >= Constants.POSTERIOR_THRESHOLD_CONAC &&
    finding.signal_count >= Constants.MIN_SIGNAL_COUNT_CONAC;

  const counterEvidenceBlocking = finding.counter_evidence_coherent === true;
  const holdReasons = finding.hold_reasons ?? [];

  // Classification logic.
  let classification: CopilotClassification;
  const rationaleParts: string[] = [];
  if (counterEvidenceBlocking) {
    classification = 'hold';
    rationaleParts.push('counter-evidence is coherent — escalation premature');
  } else if (holdReasons.length > 0) {
    classification = 'hold';
    rationaleParts.push(`adversarial pipeline raised: ${holdReasons.join(', ')}`);
  } else if (conacThresholdMet) {
    classification = 'escalate';
    rationaleParts.push(
      `posterior ${finding.posterior.toFixed(2)} ≥ ${Constants.POSTERIOR_THRESHOLD_CONAC}, signal_count ${finding.signal_count} ≥ ${Constants.MIN_SIGNAL_COUNT_CONAC} — CONAC threshold met`,
    );
  } else if (finding.posterior < 0.5 && finding.signal_count < 3) {
    classification = 'dismiss';
    rationaleParts.push('low posterior + insufficient signals — likely false positive');
  } else {
    classification = 'hold';
    rationaleParts.push(
      `posterior ${finding.posterior.toFixed(2)} / signals ${finding.signal_count} — needs more evidence`,
    );
  }

  // Urgency: severity + sanction + tip + posterior strength + age.
  let urgency = 0;
  switch (finding.severity) {
    case 'critical':
      urgency += 0.35;
      break;
    case 'high':
      urgency += 0.2;
      break;
    case 'medium':
      urgency += 0.1;
      break;
    case 'low':
      urgency += 0.05;
      break;
  }
  if (finding.entity_is_sanctioned_or_pep) urgency += 0.2;
  if (finding.tip_linked) urgency += 0.15;
  if (finding.posterior >= 0.95) urgency += 0.15;
  if (finding.external_press_mentions > 0) urgency += 0.1;

  // Age boost — older un-actioned findings get bumped up.
  const ageDays = (now.getTime() - Date.parse(finding.created_at)) / 86_400_000;
  if (ageDays > STALE_AFTER_DAYS) {
    urgency += Math.min(0.15, (ageDays - STALE_AFTER_DAYS) * 0.005);
    rationaleParts.push(`stale ${Math.round(ageDays)} days`);
  }

  urgency = Math.min(1, urgency);

  // Top next actions — concrete operator clicks.
  const actions: string[] = [];
  if (classification === 'escalate') {
    actions.push('Review counter-evidence panel');
    actions.push('Open council proposal (commit-reveal initiates immediately)');
    actions.push('Notify recipient body via the standard delivery path');
  } else if (classification === 'hold') {
    if (counterEvidenceBlocking) {
      actions.push('Read counter-evidence in full — decide whether it is actually coherent');
      actions.push('If counter-evidence is rebuttal-able, document rebuttal and re-score');
    }
    if (holdReasons.length > 0) {
      actions.push('Address hold reasons: ' + holdReasons.join(', '));
    }
    if (finding.signal_count < Constants.MIN_SIGNAL_COUNT_CONAC) {
      actions.push(
        `Seek additional corroborating signals (need ≥ ${Constants.MIN_SIGNAL_COUNT_CONAC}, have ${finding.signal_count})`,
      );
    }
    if (finding.posterior < Constants.POSTERIOR_THRESHOLD_CONAC) {
      actions.push('Await posterior strengthening from worker-score or additional pattern matches');
    }
  } else {
    actions.push('Mark dismissed with reason in finding-state notes');
    actions.push('Audit-row will record the dismissal — operator decision is traceable');
  }
  if (finding.tip_linked) {
    actions.unshift('Cross-reference linked tip text before deciding');
  }

  return {
    classification,
    urgency_score: urgency,
    top_next_actions: actions,
    rationale: rationaleParts.join('; '),
    inputs: {
      posterior: finding.posterior,
      signal_count: finding.signal_count,
      conac_threshold_met: conacThresholdMet,
      counter_evidence_blocking: counterEvidenceBlocking,
      hold_reasons: holdReasons,
    },
  };
}

/** Batch helper — sort findings by co-pilot urgency descending. */
export function sortByCopilotUrgency<T extends FindingSnapshotForCopilot>(
  findings: ReadonlyArray<T>,
  now: Date = new Date(),
): ReadonlyArray<{ finding: T; suggestion: CopilotSuggestion }> {
  const out = findings.map((f) => ({ finding: f, suggestion: generateCopilotSuggestion(f, now) }));
  out.sort((a, b) => b.suggestion.urgency_score - a.suggestion.urgency_score);
  return out;
}
