import { Ids, type Schemas } from '@vigil/shared';

import { matched, notMatched } from '../_pattern-helpers.js';
import { registerPattern } from '../registry.js';

import type { PatternContext, PatternDef, SubjectInput } from '../types.js';

/**
 * P-L-001 — Third-party agent / intermediary with no substance (OECD).
 *
 * 71% of OECD-analysed bribery cases use third-party intermediaries.
 * Pattern fires when a "consultant" or "agent" entity sits between
 * the foreign winner and the contracting authority with: no employees,
 * no industry expertise, agent fee > 5% of contract value, address in
 * a sanctioned or grey-list jurisdiction. Source: OECD Foreign
 * Bribery Report §3.4.
 */
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
    const meta = (subject.canonical?.metadata ?? {}) as Record<string, unknown>;
    const markers: string[] = [];
    if (meta.declared_employees === 0) markers.push('zero_employees');
    if (meta.sector_expertise_evidence === false) markers.push('no_sector_expertise');
    if (Number(meta.agent_fee_share ?? 0) > 0.05) {
      markers.push(`fee_share=${(Number(meta.agent_fee_share) * 100).toFixed(1)}%`);
    }
    if (meta.address_in_fatf_grey === true) markers.push('jurisdiction_fatf_grey');
    if (markers.length < 2) return notMatched(PID, `agent markers ${markers.length}/4`);
    const strength = Math.min(0.95, 0.3 + markers.length * 0.18);
    return matched({
      pattern_id: PID,
      strength,
      rationale: `Third-party agent markers: ${markers.join(', ')}.`,
    });
  },
};
registerPattern(definition);
export default definition;
