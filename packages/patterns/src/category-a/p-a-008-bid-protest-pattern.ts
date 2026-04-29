import { type Schemas } from '@vigil/shared';

import { matched, notMatched, PID } from '../_pattern-helpers.js';
import { registerPattern } from '../registry.js';

import type { PatternDef } from '../types.js';

/**
 * P-A-008 — Bid-protest pattern.
 *
 * Same losing bidder files protests on multiple awards from the same authority,
 * each ultimately rejected without substantive review. Pattern of suppressed
 * complaints rather than concentrated wrongdoing — a meta-signal.
 */
const ID = PID('P-A-008');

const definition: PatternDef = {
  id: ID,
  category: 'A',
  subjectKinds: ['Tender'],
  title_fr: 'Schéma de plaintes étouffées',
  title_en: 'Suppressed-protest pattern',
  description_fr:
    "Mêmes plaignants, mêmes attributaires, plaintes systématiquement rejetées sans examen substantiel.",
  description_en:
    'Same complainants, same awardees, complaints rejected without substantive review.',
  defaultPrior: 0.16,
  defaultWeight: 0.55,
  status: 'live',

  async detect(subject, _ctx): Promise<Schemas.PatternResult> {
    const protests = subject.events.filter(
      (e) =>
        e.kind === 'audit_observation' &&
        typeof e.payload['protest_disposition'] === 'string',
    );
    if (protests.length < 2) return notMatched(ID, 'fewer than 2 protests');
    const dismissed = protests.filter((p) => {
      const d = ((p.payload['protest_disposition'] as string) ?? '').toLowerCase();
      return d.includes('rejet') || d.includes('dismiss');
    });
    const ratio = dismissed.length / protests.length;
    if (ratio < 0.8) return notMatched(ID, `dismissal ratio ${ratio.toFixed(2)}`);

    const strength = Math.min(1, 0.45 + protests.length * 0.08);
    return matched({
      pattern_id: ID,
      strength,
      contributing_event_ids: protests.map((p) => p.id),
      rationale: `${dismissed.length}/${protests.length} protests dismissed (>80%)`,
    });
  },
};

registerPattern(definition);
export default definition;
