import { Ids, type Schemas } from '@vigil/shared';

import { evidenceFrom, readBoolWithFallback, readNumericWithFallback } from '../_event-helpers.js';
import { matched, notMatched } from '../_pattern-helpers.js';
import { registerPattern } from '../registry.js';

import type { PatternContext, PatternDef, SubjectInput } from '../types.js';

/**
 * P-N-004 — Declared ownership < 25% but de-facto control (Wolfsberg / FATF R.24).
 *
 * Detection: 4 markers, of which ≥ 2 must fire:
 *   - no_ubo_declared (filing flag)
 *   - dual_class_shares (filing flag)
 *   - voting_trust_present (filing flag)
 *   - director_alignment_ratio > 0.66 (board cohesion metric)
 *
 * Sources: company_filing event payloads OR canonical.metadata.
 */
const PID = Ids.asPatternId('P-N-004');
const definition: PatternDef = {
  id: PID,
  category: 'N',
  source_body: 'WOLFSBERG',
  subjectKinds: ['Company'],
  title_fr: 'Contrôle de fait sans participation > 25%',
  title_en: 'De-facto control without > 25% declared stake',
  description_fr:
    'Aucun actionnaire ≥ 25% déclaré, mais contrôle de fait par actions à droits multiples, fiducie de vote ou administrateurs alignés. Test FATF R.24 / Wolfsberg.',
  description_en:
    'No declared ≥ 25% shareholder, but de-facto control via dual-class shares, voting trust, or aligned directors. FATF R.24 / Wolfsberg test.',
  defaultPrior: 0.07,
  defaultWeight: 0.55,
  status: 'live',
  async detect(subject: SubjectInput, _ctx: PatternContext): Promise<Schemas.PatternResult> {
    const noUbo = readBoolWithFallback(subject, 'no_ubo_declared', 'no_ubo_declared', [
      'company_filing',
      'audit_observation',
    ]);
    const dual = readBoolWithFallback(subject, 'dual_class_shares', 'dual_class_shares', [
      'company_filing',
      'audit_observation',
    ]);
    const trust = readBoolWithFallback(subject, 'voting_trust_present', 'voting_trust_present', [
      'company_filing',
      'audit_observation',
    ]);
    const align = readNumericWithFallback(
      subject,
      'director_alignment_ratio',
      'director_alignment_ratio',
      ['company_filing', 'audit_observation'],
    );

    const markers: { name: string; on: boolean }[] = [
      { name: 'noUbo', on: noUbo.value },
      { name: 'dualClass', on: dual.value },
      { name: 'trust', on: trust.value },
      { name: 'dirAlign', on: align.value > 0.66 },
    ];
    const hits = markers.filter((m) => m.on).length;
    if (hits < 2) return notMatched(PID, `de-facto-control flags ${hits}/4`);
    const strength = Math.min(0.95, 0.5 + hits * 0.15);
    const ev = evidenceFrom([
      ...noUbo.contributors,
      ...dual.contributors,
      ...trust.contributors,
      ...align.contributors,
    ]);
    return matched({
      pattern_id: PID,
      strength,
      contributing_event_ids: ev.contributing_event_ids,
      contributing_document_cids: ev.contributing_document_cids,
      rationale: `De-facto control markers: ${hits}/4 (noUbo=${noUbo.value}, dualClass=${dual.value}, trust=${trust.value}, dirAlign=${align.value.toFixed(2)}).`,
    });
  },
};
registerPattern(definition);
export default definition;
