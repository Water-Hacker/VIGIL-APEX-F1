import { type Schemas } from '@vigil/shared';

import { evidenceFrom, eventsOfKind } from '../_event-helpers.js';
import { matched, notMatched, PID } from '../_pattern-helpers.js';
import { registerPattern } from '../registry.js';

import type { PatternDef } from '../types.js';

/**
 * P-F-004 — Hub-and-spoke procurement.
 *
 * One authority (the "hub") accounts for ≥ 70% of contracts won by a given
 * supplier (the "spoke"). `metadata.authorityConcentrationRatio` and
 * `publicContractsCount` are populated upstream from Neo4j; award events
 * are attached as contributing evidence.
 */
const ID = PID('P-F-004');

const definition: PatternDef = {
  id: ID,
  category: 'F',
  subjectKinds: ['Company'],
  title_fr: "Schéma en étoile (un seul donneur d'ordre)",
  title_en: 'Hub-and-spoke procurement vehicle',
  description_fr:
    "Au moins 70 % des marchés du fournisseur proviennent d'une même autorité contractante.",
  description_en: "≥ 70 % of the supplier's public contracts come from a single authority.",
  defaultPrior: 0.2,
  defaultWeight: 0.7,
  status: 'live',

  async detect(subject, _ctx): Promise<Schemas.PatternResult> {
    const company = subject.canonical;
    if (!company || company.kind !== 'company') return notMatched(ID, 'no company');
    const hubRatio = Number(company.metadata['authorityConcentrationRatio'] ?? 0);
    const totalContracts = Number(company.metadata['publicContractsCount'] ?? 0);
    if (hubRatio < 0.7 || totalContracts < 3) {
      return notMatched(ID, `hubRatio=${hubRatio.toFixed(2)} contracts=${totalContracts}`);
    }
    const awards = eventsOfKind(subject, ['award']);
    const ev = evidenceFrom(awards);
    const strength = Math.min(1, 0.5 + (hubRatio - 0.7) * 1.5);
    return matched({
      pattern_id: ID,
      strength,
      contributing_event_ids: ev.contributing_event_ids,
      contributing_document_cids: ev.contributing_document_cids,
      rationale: `hub ratio ${(hubRatio * 100).toFixed(0)}% across ${totalContracts} contracts`,
    });
  },
};

registerPattern(definition);
export default definition;
