import { type Schemas } from '@vigil/shared';

import { matched, notMatched, PID } from '../_pattern-helpers.js';
import { registerPattern } from '../registry.js';

import type { PatternDef } from '../types.js';

/**
 * P-H-003 — Holiday publication burst.
 *
 * An anomalously high number of tender publications, awards, or amendments
 * land on dates known to suppress public scrutiny — late on the eve of a
 * national holiday, between Christmas and New Year, or at midnight on a
 * Friday before a long weekend.
 */
const ID = PID('P-H-003');

// Cameroonian public holidays (approximate; year-independent month-day pairs)
const HOLIDAY_MD = new Set([
  '01-01', // New Year
  '02-11', // Youth Day
  '05-01', // Labour Day
  '05-20', // National Day
  '08-15', // Assumption
  '12-25', // Christmas
]);

const definition: PatternDef = {
  id: ID,
  category: 'H',
  subjectKinds: ['Tender'],
  title_fr: 'Publication concentrée à l\'approche d\'un jour férié',
  title_en: 'Holiday-eve publication burst',
  description_fr:
    "Publications anormalement nombreuses la veille d'un jour férié ou en période creuse (fin décembre).",
  description_en:
    'Anomalously high publication volume on dates designed to evade public scrutiny.',
  defaultPrior: 0.15,
  defaultWeight: 0.5,
  status: 'live',

  async detect(subject, _ctx): Promise<Schemas.PatternResult> {
    const dated = subject.events.filter((e) => e.published_at !== null);
    if (dated.length < 3) return notMatched(ID, 'too few dated events');
    let burstHits = 0;
    const ids: string[] = [];
    for (const e of dated) {
      const d = new Date(e.published_at!);
      const md = `${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
      const dow = d.getUTCDay();
      const hour = d.getUTCHours();
      const onHolidayEve = isHolidayEve(md);
      const lateFriday = dow === 5 && hour >= 19;
      const yearEnd = (md >= '12-23' && md <= '12-31') || md <= '01-02';
      if (onHolidayEve || lateFriday || yearEnd) {
        burstHits++;
        ids.push(e.id);
      }
    }
    const ratio = burstHits / dated.length;
    if (ratio < 0.4 || burstHits < 3) {
      return notMatched(ID, `burst ratio=${ratio.toFixed(2)} hits=${burstHits}`);
    }
    const strength = Math.min(1, 0.4 + ratio * 0.6);
    return matched({
      pattern_id: ID,
      strength,
      contributing_event_ids: ids,
      rationale: `${burstHits}/${dated.length} publications on suppression-friendly dates`,
    });
  },
};

function isHolidayEve(md: string): boolean {
  // Eve = the day before a holiday. Approximate via simple month/day arithmetic.
  const [m, d] = md.split('-').map((s) => Number(s));
  const date = new Date(Date.UTC(2000, (m ?? 1) - 1, (d ?? 1) + 1));
  const nextMd = `${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
  return HOLIDAY_MD.has(nextMd);
}

registerPattern(definition);
export default definition;
