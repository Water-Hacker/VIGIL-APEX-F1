import { Ids, type Schemas } from '@vigil/shared';

import { evidenceFrom, eventsOfKind, meta, num, sumNumericField } from '../_event-helpers.js';
import { matched, notMatched } from '../_pattern-helpers.js';
import { registerPattern } from '../registry.js';

import type { PatternContext, PatternDef, SubjectInput } from '../types.js';

/**
 * P-J-003 — Concealed off-books liabilities (ACFE).
 *
 * Detection:
 *   1. Sum `liability_xaf` declared in `company_filing` events.
 *   2. Sum `obligation_xaf` (or `liability_xaf`) discovered in
 *      `audit_observation` + `court_judgement` events (these surface
 *      contingent / pending liabilities that should have been booked).
 *   3. Hidden = discovered - declared. Fires when > 100M XAF.
 *
 * Falls back to `metadata.hidden_liabilities_xaf` if no events.
 */
const PID = Ids.asPatternId('P-J-003');
const definition: PatternDef = {
  id: PID,
  category: 'J',
  source_body: 'ACFE',
  subjectKinds: ['Company'],
  title_fr: 'Dissimulation de passifs hors bilan',
  title_en: 'Concealed off-books liabilities',
  description_fr:
    'Engagements matériels (dette, litiges pendants, garanties) absents des états financiers déposés. Typologie ACFE.',
  description_en: 'Material obligations absent from filed financial statements. ACFE typology.',
  defaultPrior: 0.03,
  defaultWeight: 0.55,
  status: 'live',
  async detect(subject: SubjectInput, _ctx: PatternContext): Promise<Schemas.PatternResult> {
    const filings = eventsOfKind(subject, ['company_filing']);
    const discovered = eventsOfKind(subject, ['audit_observation', 'court_judgement']);

    let hiddenXaf = 0;
    let contributing: ReadonlyArray<(typeof subject.events)[number]> = [];

    if (filings.length > 0 || discovered.length > 0) {
      const declared = sumNumericField(filings, 'liability_xaf');
      const known = sumNumericField(discovered, 'obligation_xaf');
      const knownAlt = sumNumericField(discovered, 'liability_xaf');
      const totalKnown = known.value + knownAlt.value;
      if (totalKnown > declared.value) {
        hiddenXaf = totalKnown - declared.value;
        contributing = [...declared.contributors, ...known.contributors, ...knownAlt.contributors];
      }
    }

    if (hiddenXaf === 0) {
      hiddenXaf = num(meta(subject).hidden_liabilities_xaf) ?? 0;
    }

    if (hiddenXaf < 100_000_000) {
      return notMatched(PID, `hidden=${hiddenXaf.toLocaleString('fr-CM')} < 100M XAF`);
    }
    // Strength grows logarithmically with the hidden amount: 100M XAF → 0.50,
    // 200M → 0.58, 500M → 0.67, 1B → 0.75, 10B → 0.95. The base is 0.5 so the
    // default match-at threshold fires at the 100M XAF floor.
    const strength = Math.min(0.95, 0.5 + Math.log10(hiddenXaf / 100_000_000) * 0.25);
    const ev = evidenceFrom(contributing);
    return matched({
      pattern_id: PID,
      strength,
      contributing_event_ids: ev.contributing_event_ids,
      contributing_document_cids: ev.contributing_document_cids,
      rationale: `${hiddenXaf.toLocaleString('fr-CM')} XAF in liabilities not reflected on filed balance sheet.`,
    });
  },
};
registerPattern(definition);
export default definition;
