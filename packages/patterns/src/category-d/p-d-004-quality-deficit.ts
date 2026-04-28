import { type Schemas } from '@vigil/shared';

import { matched, notMatched, PID } from '../_pattern-helpers.js';
import { registerPattern } from '../registry.js';
import type { PatternDef } from '../types.js';

/**
 * P-D-004 — Quality deficit on delivered work.
 *
 * Cour des Comptes or technical-audit observation flags a quality deficit
 * (e.g. road surface below thickness spec, building below seismic class)
 * AND no remediation amendment exists. Documents come in via worker-document.
 */
const ID = PID('P-D-004');

const definition: PatternDef = {
  id: ID,
  category: 'D',
  subjectKinds: ['Project'],
  title_fr: 'Déficit de qualité non corrigé',
  title_en: 'Uncorrected quality deficit',
  description_fr:
    "Une observation de la Cour des Comptes ou d'un audit technique signale un défaut, sans avenant correctif.",
  description_en:
    'Cour des Comptes or technical audit flags a quality deficit; no remediation amendment exists.',
  defaultPrior: 0.20,
  defaultWeight: 0.65,
  status: 'live',

  async detect(subject, _ctx): Promise<Schemas.PatternResult> {
    const auditObs = subject.events.find(
      (e) => e.kind === 'audit_observation' && typeof e.payload['quality_deficit'] === 'string',
    );
    if (!auditObs) return notMatched(ID, 'no quality observation');
    const remedied = subject.events.some((e) => {
      if (e.kind !== 'amendment') return false;
      const purpose = ((e.payload['purpose'] as string) ?? '').toLowerCase();
      return purpose.includes('remediation') || purpose.includes('correctif');
    });
    if (remedied) return notMatched(ID, 'remediation recorded');
    const severity = Number(auditObs.payload['severity_score'] ?? 0.7);
    return matched({
      pattern_id: ID,
      strength: Math.min(1, 0.5 + severity * 0.4),
      contributing_event_ids: [auditObs.id],
      contributing_document_cids: auditObs.document_cids,
      rationale: `quality deficit (${auditObs.payload['quality_deficit'] as string}) without remediation`,
    });
  },
};

registerPattern(definition);
export default definition;
