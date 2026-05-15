import { Ids, type Schemas } from '@vigil/shared';

import { evidenceFrom, eventsOfKind, meta, num, sumNumericField } from '../_event-helpers.js';
import { matched, notMatched } from '../_pattern-helpers.js';
import { registerPattern } from '../registry.js';

import type { PatternContext, PatternDef, SubjectInput } from '../types.js';

/**
 * P-J-005 — Undisclosed related-party transaction (ACFE).
 *
 * Detection:
 *   1. Identify counterparties in `subject.related` that share a UBO or
 *      director with the subject (relationship payload carries the kind:
 *      'shared_ubo' | 'shared_director').
 *   2. Sum `payment_order` event amounts to those related counterparties.
 *   3. Sum amounts declared in `company_filing` events as related-party
 *      transactions (`related_party_disclosed_xaf` field).
 *   4. Undisclosed = (payments to related) - declared. Fires at > 50M XAF.
 *
 * Falls back to `metadata.related_party_undisclosed_xaf`.
 */
const PID = Ids.asPatternId('P-J-005');
const definition: PatternDef = {
  id: PID,
  category: 'J',
  source_body: 'ACFE',
  subjectKinds: ['Company'],
  title_fr: 'Transaction avec partie liée non déclarée',
  title_en: 'Undisclosed related-party transaction',
  description_fr:
    'Transaction matérielle avec une partie liée (administrateur, UBO commun) non déclarée selon SYSCOHADA art. 32. Typologie ACFE.',
  description_en:
    'Material related-party transaction (shared director / UBO) not disclosed per OHADA Art. 32. ACFE typology.',
  defaultPrior: 0.06,
  defaultWeight: 0.5,
  status: 'live',
  async detect(subject: SubjectInput, _ctx: PatternContext): Promise<Schemas.PatternResult> {
    const relatedIds = new Set<string>();
    for (const r of subject.related) {
      const m = (r.metadata ?? {}) as Record<string, unknown>;
      const kind = (m.relation_kind ?? m.kind) as string | undefined;
      if (kind === 'shared_ubo' || kind === 'shared_director') {
        relatedIds.add(r.id);
      }
    }

    let undisclosedXaf = 0;
    let contributing: ReadonlyArray<(typeof subject.events)[number]> = [];

    const payments = eventsOfKind(subject, ['payment_order', 'treasury_disbursement']);
    const filings = eventsOfKind(subject, ['company_filing']);

    if (relatedIds.size > 0 && payments.length > 0) {
      let toRelated = 0;
      const contribs: (typeof subject.events)[number][] = [];
      for (const p of payments) {
        const counter = (p.payload['counterparty_id'] as string | undefined) ?? null;
        if (counter !== null && relatedIds.has(counter)) {
          const amt = num(p.payload['amount_xaf']);
          if (amt !== null) {
            toRelated += amt;
            contribs.push(p);
          }
        }
      }
      const declared = sumNumericField(filings, 'related_party_disclosed_xaf');
      if (toRelated > declared.value) {
        undisclosedXaf = toRelated - declared.value;
        contributing = [...contribs, ...declared.contributors];
      }
    }

    if (undisclosedXaf === 0) {
      undisclosedXaf = num(meta(subject).related_party_undisclosed_xaf) ?? 0;
    }

    if (undisclosedXaf < 50_000_000) {
      return notMatched(PID, `undisclosed=${undisclosedXaf.toLocaleString('fr-CM')} < 50M XAF`);
    }
    // 50M → 0.50, 100M → 0.58, 500M → 0.75, 5B → 0.95. Base = 0.5 so the
    // default match threshold fires at the 50M XAF disclosure floor.
    const strength = Math.min(0.95, 0.5 + Math.log10(undisclosedXaf / 50_000_000) * 0.25);
    const ev = evidenceFrom(contributing);
    return matched({
      pattern_id: PID,
      strength,
      contributing_event_ids: ev.contributing_event_ids,
      contributing_document_cids: ev.contributing_document_cids,
      rationale: `${undisclosedXaf.toLocaleString('fr-CM')} XAF in related-party transactions absent from disclosures.`,
    });
  },
};
registerPattern(definition);
export default definition;
