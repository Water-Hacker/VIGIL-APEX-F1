import { Ids, type Schemas } from '@vigil/shared';

import { evidenceFrom, readBoolWithFallback } from '../_event-helpers.js';
import { matched, notMatched } from '../_pattern-helpers.js';
import { registerPattern } from '../registry.js';

import type { PatternContext, PatternDef, SubjectInput } from '../types.js';

/**
 * P-I-003 — Ghost employee on payroll (ACFE).
 *
 * Detection: any of 4 markers from `company_filing` / `audit_observation` /
 * `payment_order` payloads — falls back to canonical.metadata.
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
    const sources: ReadonlyArray<Schemas.SourceEventKind> = [
      'company_filing',
      'audit_observation',
      'payment_order',
    ];
    const noHr = readBoolWithFallback(subject, 'no_hr_record', 'no_hr_record', sources);
    const noNiu = readBoolWithFallback(
      subject,
      'niu_absent_from_personal_tax',
      'niu_absent_from_personal_tax',
      sources,
    );
    const deceased = readBoolWithFallback(
      subject,
      'matched_deceased_identity',
      'matched_deceased_identity',
      sources,
    );
    const noPension = readBoolWithFallback(
      subject,
      'no_pension_fund_entry',
      'no_pension_fund_entry',
      sources,
    );
    const markers: string[] = [];
    if (noHr.value) markers.push('no_hr_record');
    if (noNiu.value) markers.push('niu_absent_from_personal_tax');
    if (deceased.value) markers.push('matched_deceased_identity');
    if (noPension.value) markers.push('no_pension_fund_entry');
    if (markers.length === 0) return notMatched(PID, 'no ghost-employee markers');
    const strength = Math.min(0.95, 0.5 + markers.length * 0.15);
    const ev = evidenceFrom([
      ...noHr.contributors,
      ...noNiu.contributors,
      ...deceased.contributors,
      ...noPension.contributors,
    ]);
    return matched({
      pattern_id: PID,
      strength,
      contributing_event_ids: ev.contributing_event_ids,
      contributing_document_cids: ev.contributing_document_cids,
      rationale: `Ghost-employee markers: ${markers.join(', ')}.`,
    });
  },
};
registerPattern(definition);
export default definition;
