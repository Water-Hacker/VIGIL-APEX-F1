/**
 * Case-load-aware recipient routing — closes FRONTIER-AUDIT Layer-1
 * E1.7 (case-load-aware recipient routing) + Layer-7 outcome-feedback
 * gap.
 *
 * Today's routing in `recipient-body.ts` is a pure function of
 * (pattern_category, severity). It does not consider whether the
 * recipient body has capacity to act on the dossier. A CONAC backlog
 * of 18 months effectively means a dossier delivered today produces
 * no action; the parent at 3am sees the same outcome as if the
 * dossier had never been sent.
 *
 * This module wraps the static routing with a case-load adjustment.
 * For each recipient body the platform tracks:
 *
 *   - estimated_backlog_days        (P50 time from delivery to action)
 *   - active_case_count             (open investigations)
 *   - last_acknowledged_within_days (recency of any operational signal)
 *   - reroute_threshold_days        (above this, prefer an alternative)
 *
 * The signals are populated by `worker-outcome-feedback` (Layer-7
 * closure, separate module) which ingests CONAC press releases,
 * court filings, ARMP debarment listings, and Tribunal Suprême
 * decisions, then matches them back to delivered dossiers to derive
 * the per-body backlog estimate.
 *
 * Routing decision logic:
 *
 *   1. Compute the static default recipient via `recommendRecipientBody`.
 *   2. Look up that body's case-load profile.
 *   3. If backlog ≤ reroute_threshold OR there is no acceptable
 *      alternative, return the default with `adjusted_for_load: false`.
 *   4. Otherwise, pick the lowest-backlog alternative whose mandate
 *      is compatible with the pattern category, and return it with
 *      `adjusted_for_load: true` and a rationale string.
 *
 * Compatibility table (mandate overlap):
 *
 *   CONAC          ↔ procurement-side findings (A, B, C, F, H, M)
 *   COUR_DES_COMPTES ↔ executed-spend / document / extractive (D, G, J, O)
 *   ANIF           ↔ AML / sanctions / TBML / corporate-veil (E, K, N)
 *   MINFI          ↔ pre-disbursement risk findings (any category with
 *                    pre_disbursement_flag = true)
 *   COUR_DES_COMPTES ↔ also accepts foreign-bribery (L) and asset-
 *                      misappropriation (I) as administrative-audit
 *                      jurisdiction
 *   ANIF           ↔ also accepts post-award personal enrichment (P)
 *                    per Loi 2018/011 (patrimoine inexpliqué)
 *
 * The compatibility surface is intentionally narrow — the platform
 * does NOT reroute to an institution that cannot legally act on the
 * pattern. Backlog-busting must respect mandate.
 */

import { recommendRecipientBody } from './recipient-body.js';

import type { PatternCategoryLetter } from '../constants.js';
import type { Severity } from '../schemas/common.js';
import type { RecipientBody } from '../schemas/dossier.js';

export interface RecipientBacklogProfile {
  readonly body: RecipientBody;
  /** P50 days from delivery to first operational action. */
  readonly estimated_backlog_days: number;
  /** Open investigations the body has acknowledged. */
  readonly active_case_count: number;
  /** Days since the body last acknowledged any dossier from VIGIL APEX. */
  readonly last_acknowledged_within_days: number;
  /** Threshold above which the router prefers an alternative. */
  readonly reroute_threshold_days: number;
}

export interface CaseLoadAwareRecipientResult {
  readonly body: RecipientBody;
  readonly adjusted_for_load: boolean;
  readonly default_body: RecipientBody;
  readonly rationale: string;
  /** Snapshot of the backlog inputs (for audit-row payload). */
  readonly inputs: {
    readonly default_backlog_days: number | null;
    readonly chosen_backlog_days: number | null;
    readonly considered_alternatives: ReadonlyArray<{
      readonly body: RecipientBody;
      readonly backlog_days: number;
    }>;
  };
}

/**
 * Mandate compatibility — which bodies can legally act on which
 * pattern categories. Keys are the pattern category letter, values
 * are the bodies (in order of mandate fit).
 */
const MANDATE_COMPATIBILITY: Readonly<Record<PatternCategoryLetter, ReadonlyArray<RecipientBody>>> =
  {
    A: ['CONAC', 'COUR_DES_COMPTES'],
    B: ['CONAC', 'ANIF'],
    C: ['CONAC', 'MINFI'],
    D: ['COUR_DES_COMPTES'],
    E: ['ANIF'],
    F: ['CONAC', 'COUR_DES_COMPTES'],
    G: ['COUR_DES_COMPTES'],
    H: ['CONAC', 'COUR_DES_COMPTES'],
    I: ['COUR_DES_COMPTES', 'CONAC'],
    J: ['COUR_DES_COMPTES'],
    K: ['ANIF'],
    L: ['CONAC', 'COUR_DES_COMPTES'],
    M: ['CONAC'],
    N: ['ANIF', 'CONAC'],
    O: ['COUR_DES_COMPTES'],
    P: ['ANIF', 'CONAC'],
  };

export interface CaseLoadAwareRoutingInput {
  readonly patternCategory: PatternCategoryLetter;
  readonly severity: Severity;
  readonly preDisbursementFlag?: boolean;
  /** Profiles keyed by body name. Pass an empty Map if the
   *  outcome-feedback worker has not yet populated profiles —
   *  the routing falls back to the static default. */
  readonly backlogProfiles: ReadonlyMap<RecipientBody, RecipientBacklogProfile>;
}

export function routeWithCaseLoadAwareness(
  input: CaseLoadAwareRoutingInput,
): CaseLoadAwareRecipientResult {
  const defaultBody = recommendRecipientBody({
    patternCategory: input.patternCategory,
    severity: input.severity,
    ...(input.preDisbursementFlag !== undefined && {
      preDisbursementFlag: input.preDisbursementFlag,
    }),
  });

  // If pre-disbursement, routing is fixed at MINFI per SRD §26 — no rerouting.
  if (input.preDisbursementFlag === true) {
    return makeUnadjusted(defaultBody, 'pre-disbursement flag overrides case-load routing');
  }

  const defaultProfile = input.backlogProfiles.get(defaultBody);
  if (!defaultProfile) {
    return makeUnadjusted(
      defaultBody,
      'no backlog profile available for default body — using static default',
    );
  }

  // Within threshold → keep default.
  if (defaultProfile.estimated_backlog_days <= defaultProfile.reroute_threshold_days) {
    return {
      body: defaultBody,
      adjusted_for_load: false,
      default_body: defaultBody,
      rationale: `default body backlog ${defaultProfile.estimated_backlog_days}d ≤ threshold ${defaultProfile.reroute_threshold_days}d`,
      inputs: {
        default_backlog_days: defaultProfile.estimated_backlog_days,
        chosen_backlog_days: defaultProfile.estimated_backlog_days,
        considered_alternatives: [],
      },
    };
  }

  // Default exceeded threshold — look for compatible alternative.
  const compatibleBodies = MANDATE_COMPATIBILITY[input.patternCategory];
  const alternatives: { body: RecipientBody; backlog_days: number }[] = [];
  for (const altBody of compatibleBodies) {
    if (altBody === defaultBody) continue;
    const altProfile = input.backlogProfiles.get(altBody);
    if (!altProfile) continue;
    alternatives.push({ body: altBody, backlog_days: altProfile.estimated_backlog_days });
  }

  // Sort alternatives by backlog ascending.
  alternatives.sort((a, b) => a.backlog_days - b.backlog_days);

  if (alternatives.length === 0) {
    return {
      body: defaultBody,
      adjusted_for_load: false,
      default_body: defaultBody,
      rationale: `default body backlog ${defaultProfile.estimated_backlog_days}d > threshold but no compatible alternative profile available`,
      inputs: {
        default_backlog_days: defaultProfile.estimated_backlog_days,
        chosen_backlog_days: defaultProfile.estimated_backlog_days,
        considered_alternatives: [],
      },
    };
  }

  const chosen = alternatives[0]!;
  // Only reroute if alternative is materially better (>= 30% lower backlog).
  const improvement =
    (defaultProfile.estimated_backlog_days - chosen.backlog_days) /
    defaultProfile.estimated_backlog_days;
  if (improvement < 0.3) {
    return {
      body: defaultBody,
      adjusted_for_load: false,
      default_body: defaultBody,
      rationale: `default body backlog ${defaultProfile.estimated_backlog_days}d, best alternative ${chosen.body} at ${chosen.backlog_days}d — improvement ${(improvement * 100).toFixed(0)}% < 30% threshold, keeping default`,
      inputs: {
        default_backlog_days: defaultProfile.estimated_backlog_days,
        chosen_backlog_days: defaultProfile.estimated_backlog_days,
        considered_alternatives: alternatives,
      },
    };
  }

  return {
    body: chosen.body,
    adjusted_for_load: true,
    default_body: defaultBody,
    rationale: `default ${defaultBody} backlog ${defaultProfile.estimated_backlog_days}d > threshold ${defaultProfile.reroute_threshold_days}d; rerouted to ${chosen.body} at ${chosen.backlog_days}d backlog (${(improvement * 100).toFixed(0)}% improvement)`,
    inputs: {
      default_backlog_days: defaultProfile.estimated_backlog_days,
      chosen_backlog_days: chosen.backlog_days,
      considered_alternatives: alternatives,
    },
  };
}

function makeUnadjusted(body: RecipientBody, rationale: string): CaseLoadAwareRecipientResult {
  return {
    body,
    adjusted_for_load: false,
    default_body: body,
    rationale,
    inputs: {
      default_backlog_days: null,
      chosen_backlog_days: null,
      considered_alternatives: [],
    },
  };
}

/**
 * Convenience: build an empty profile map. Used by tests and by
 * callers that haven't wired the outcome-feedback worker yet.
 */
export function emptyBacklogProfileMap(): ReadonlyMap<RecipientBody, RecipientBacklogProfile> {
  return new Map();
}
