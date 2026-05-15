import { Ids, type Schemas } from '@vigil/shared';

import { evidenceFrom, readBoolWithFallback, readNumericWithFallback } from '../_event-helpers.js';
import { matched, notMatched } from '../_pattern-helpers.js';
import { registerPattern } from '../registry.js';

import type { PatternContext, PatternDef, SubjectInput } from '../types.js';

const PID = Ids.asPatternId('P-L-001');
const definition: PatternDef = {
  id: PID,
  category: 'L',
  source_body: 'OECD',
  subjectKinds: ['Company', 'Tender'],
  title_fr: 'Intermédiaire / agent sans substance opérationnelle',
  title_en: 'Third-party agent with no operational substance',
  description_fr:
    "Société-écran « consultant » ou « agent » entre l'attributaire et l'autorité contractante : sans employés, sans expertise sectorielle, commission > 5% du marché, adresse en juridiction sensible. Typologie OECD.",
  description_en:
    "Shell 'consultant' / 'agent' between winner and contracting authority: no employees, no sector expertise, fee > 5% of contract value, address in sensitive jurisdiction. OECD typology.",
  defaultPrior: 0.07,
  defaultWeight: 0.7,
  status: 'live',
  async detect(subject: SubjectInput, _ctx: PatternContext): Promise<Schemas.PatternResult> {
    const sources: ReadonlyArray<Schemas.SourceEventKind> = ['company_filing', 'audit_observation'];
    const employees = readNumericWithFallback(
      subject,
      'declared_employees',
      'declared_employees',
      sources,
    );
    const sectorExpertise = readBoolWithFallback(
      subject,
      'sector_expertise_evidence',
      'sector_expertise_evidence',
      sources,
    );
    const feeShare = readNumericWithFallback(subject, 'agent_fee_share', 'agent_fee_share', [
      ...sources,
      'payment_order',
    ]);
    const grey = readBoolWithFallback(
      subject,
      'address_in_fatf_grey',
      'address_in_fatf_grey',
      sources,
    );

    const markers: string[] = [];
    if (employees.value === 0 && employees.from !== 'none') markers.push('zero_employees');
    if (sectorExpertise.from !== 'none' && !sectorExpertise.value)
      markers.push('no_sector_expertise');
    if (feeShare.value > 0.05) markers.push(`fee_share=${(feeShare.value * 100).toFixed(1)}%`);
    if (grey.value) markers.push('jurisdiction_fatf_grey');
    if (markers.length < 2) return notMatched(PID, `agent markers ${markers.length}/4`);
    const strength = Math.min(0.95, 0.5 + markers.length * 0.13);
    const ev = evidenceFrom([
      ...employees.contributors,
      ...sectorExpertise.contributors,
      ...feeShare.contributors,
      ...grey.contributors,
    ]);
    return matched({
      pattern_id: PID,
      strength,
      contributing_event_ids: ev.contributing_event_ids,
      contributing_document_cids: ev.contributing_document_cids,
      rationale: `Third-party agent markers: ${markers.join(', ')}.`,
    });
  },
};
registerPattern(definition);
export default definition;
