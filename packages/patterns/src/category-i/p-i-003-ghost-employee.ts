import { Ids, type Schemas } from '@vigil/shared';

import { matched, notMatched } from '../_pattern-helpers.js';
import { registerPattern } from '../registry.js';

import type { PatternContext, PatternDef, SubjectInput } from '../types.js';

/**
 * P-I-003 — Ghost employee on payroll (ACFE Fraud Tree).
 *
 * Asset Misappropriation → Cash → Fraudulent Disbursements → Payroll
 * → Ghost Employees. An entity paid as "employee" but with no
 * corresponding HR record, no NIU under personal-income tax, or whose
 * declared identity matches a fictitious person.
 *
 * Detection: flag when payroll-stream events for an entity have
 * `niu` matching a known-fictitious blocklist OR no entry in the
 * pension fund database OR matched to a deceased person's national ID.
 * Source: ACFE Report to the Nations.
 */
const PID = Ids.asPatternId('P-I-003');
const definition: PatternDef = {
  id: PID,
  category: 'I',
  source_body: 'ACFE',
  subjectKinds: ['Person', 'Payment'],
  title_fr: 'Employé fantôme sur la paie',
  title_en: 'Ghost employee on payroll',
  description_fr:
    'Versement de salaire à un employé fictif : aucun dossier RH, NIU absent du fichier fiscal personnel, ou identité correspondant à une personne décédée. Typologie ACFE.',
  description_en:
    'Salary payment to a fictitious employee: no HR record, NIU absent from personal-income tax file, or identity matching a deceased person. ACFE typology.',
  defaultPrior: 0.03,
  defaultWeight: 0.7,
  status: 'live',
  async detect(subject: SubjectInput, _ctx: PatternContext): Promise<Schemas.PatternResult> {
    const meta = (subject.canonical?.metadata ?? {}) as Record<string, unknown>;
    const markers: string[] = [];
    if (meta.no_hr_record === true) markers.push('no_hr_record');
    if (meta.niu_absent_from_personal_tax === true) markers.push('niu_absent_from_personal_tax');
    if (meta.matched_deceased_identity === true) markers.push('matched_deceased_identity');
    if (meta.no_pension_fund_entry === true) markers.push('no_pension_fund_entry');
    if (markers.length === 0) return notMatched(PID, 'no ghost-employee markers');
    const strength = Math.min(0.95, 0.4 + markers.length * 0.2);
    return matched({
      pattern_id: PID,
      strength,
      rationale: `Ghost-employee markers: ${markers.join(', ')}.`,
    });
  },
};
registerPattern(definition);
export default definition;
