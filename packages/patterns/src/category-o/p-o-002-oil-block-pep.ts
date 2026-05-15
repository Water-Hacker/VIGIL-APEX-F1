import { Ids, type Schemas } from '@vigil/shared';

import {
  evidenceFrom,
  eventsOfKind,
  meta,
  readBoolWithFallback,
  readNumericWithFallback,
  str,
} from '../_event-helpers.js';
import { matched, notMatched } from '../_pattern-helpers.js';
import { registerPattern } from '../registry.js';

import type { PatternContext, PatternDef, SubjectInput } from '../types.js';

/**
 * P-O-002 — Oil/gas block transferred to PEP-connected entity below market.
 *
 * Detection: sector = 'oil_gas', UBO is a PEP (canonical entity
 * `is_pep` flag OR ubo_is_pep on filing), transfer price ≤ 70% of
 * fair-value benchmark.
 */
const PID = Ids.asPatternId('P-O-002');
const definition: PatternDef = {
  id: PID,
  category: 'O',
  source_body: 'EITI',
  subjectKinds: ['Tender'],
  title_fr: 'Bloc pétrolier transféré à une entité PEP sous le prix de marché',
  title_en: 'Oil/gas block to PEP-connected entity below market',
  description_fr:
    "Bloc pétrolier ou gazier transféré à une entité dont l'UBO est PEP, à un prix inférieur au benchmark FMI / Banque mondiale. Typologie NRGI.",
  description_en:
    'Oil/gas block transferred to an entity whose UBO matches an active PEP, below IMF/World-Bank fair-value benchmark. NRGI typology.',
  defaultPrior: 0.04,
  defaultWeight: 0.75,
  status: 'live',
  async detect(subject: SubjectInput, _ctx: PatternContext): Promise<Schemas.PatternResult> {
    const tenders = eventsOfKind(subject, ['tender_notice', 'gazette_decree', 'company_filing']);
    let sector: string | null = null;
    let sectorEvent: (typeof tenders)[number] | null = null;
    for (const t of tenders) {
      const s = str(t.payload['sector']);
      if (s !== null) {
        sector = s;
        sectorEvent = t;
        break;
      }
    }
    if (sector === null) sector = str(meta(subject).sector);
    if (sector !== 'oil_gas') return notMatched(PID, `sector=${sector ?? 'unknown'} not oil/gas`);

    // PEP: prefer canonical.is_pep, fall back to event/metadata flag.
    let pepLinked = subject.canonical?.is_pep === true;
    const pepEvent = readBoolWithFallback(subject, 'ubo_is_pep', 'ubo_is_pep', [
      'company_filing',
      'pep_match',
    ]);
    if (!pepLinked) pepLinked = pepEvent.value;

    const ratio = readNumericWithFallback(
      subject,
      'transfer_price_to_benchmark',
      'transfer_price_to_benchmark',
      ['tender_notice', 'audit_observation'],
    );
    // Default ratio when unknown is 1.0 (neutral) — but readNumericWithFallback
    // returns 0 on no-signal. Treat no-signal as 1.0 (no anomaly).
    const ratioValue = ratio.from === 'none' ? 1 : ratio.value;
    if (!pepLinked || ratioValue >= 0.7) {
      return notMatched(PID, `pep=${pepLinked} ratio=${ratioValue.toFixed(2)}`);
    }
    const strength = Math.min(0.95, 0.5 + (0.7 - ratioValue) * 1.2);
    const ev = evidenceFrom([
      ...(sectorEvent ? [sectorEvent] : []),
      ...pepEvent.contributors,
      ...ratio.contributors,
    ]);
    return matched({
      pattern_id: PID,
      strength,
      contributing_event_ids: ev.contributing_event_ids,
      contributing_document_cids: ev.contributing_document_cids,
      rationale: `PEP-linked acquirer at ${(ratioValue * 100).toFixed(0)}% of benchmark.`,
    });
  },
};
registerPattern(definition);
export default definition;
