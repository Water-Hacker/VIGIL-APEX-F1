import { type Schemas } from '@vigil/shared';

import { matched, notMatched, PID } from '../_pattern-helpers.js';
import { registerPattern } from '../registry.js';

import type { PatternDef } from '../types.js';

/**
 * P-A-002 — Split-tender (slicing).
 *
 * Same authority awards two or more contracts of nearly identical scope to the
 * same supplier within a short window, each just below the procurement-method
 * threshold (avoids the open-tender requirement for the combined sum).
 *
 * Threshold for "open tender" varies by sector but 50 M XAF is a common bound;
 * configurable via the pattern's signal payload.
 */
const ID = PID('P-A-002');
const SLICE_WINDOW_DAYS = 60;
const OPEN_TENDER_THRESHOLD_XAF = 50_000_000;

const definition: PatternDef = {
  id: ID,
  category: 'A',
  subjectKinds: ['Tender'],
  title_fr: "Découpage de marché (saucissonnage)",
  title_en: 'Split tender (slicing)',
  description_fr:
    "Plusieurs marchés au même fournisseur dans une fenêtre courte, chacun juste sous le seuil d'appel d'offres ouvert.",
  description_en:
    'Multiple awards to the same supplier in a short window, each just below the open-tender threshold.',
  defaultPrior: 0.18,
  defaultWeight: 0.7,
  status: 'live',

  async detect(subject, ctx): Promise<Schemas.PatternResult> {
    const awards = subject.events.filter((e) => e.kind === 'award');
    if (awards.length < 2) return notMatched(ID, 'fewer than 2 awards on subject');

    // Group by supplier_name within SLICE_WINDOW_DAYS
    const bySupplier = new Map<string, typeof awards>();
    for (const a of awards) {
      const supplier = (a.payload['supplier_name'] as string | undefined) ?? null;
      if (!supplier) continue;
      const arr = bySupplier.get(supplier) ?? [];
      arr.push(a);
      bySupplier.set(supplier, arr);
    }

    let strength = 0;
    const why: string[] = [];
    const ids: string[] = [];
    for (const [supplier, batch] of bySupplier) {
      if (batch.length < 2) continue;
      // Sort by published_at, find any pair within window
      batch.sort((x, y) => (x.published_at ?? '').localeCompare(y.published_at ?? ''));
      for (let i = 0; i + 1 < batch.length; i++) {
        const a = batch[i]!;
        const b = batch[i + 1]!;
        if (!a.published_at || !b.published_at) continue;
        const days = Math.abs(
          (new Date(b.published_at).getTime() - new Date(a.published_at).getTime()) / 86_400_000,
        );
        if (days > SLICE_WINDOW_DAYS) continue;
        const sumA = (a.payload['amount_xaf'] as number | undefined) ?? 0;
        const sumB = (b.payload['amount_xaf'] as number | undefined) ?? 0;
        if (sumA === 0 || sumB === 0) continue;
        const eachUnderThreshold = sumA < OPEN_TENDER_THRESHOLD_XAF && sumB < OPEN_TENDER_THRESHOLD_XAF;
        const sumOverThreshold = sumA + sumB >= OPEN_TENDER_THRESHOLD_XAF;
        if (eachUnderThreshold && sumOverThreshold) {
          strength = Math.max(strength, 0.7);
          why.push(`supplier=${supplier} pair within ${days.toFixed(0)}d sum=${sumA + sumB}`);
          ids.push(a.id, b.id);
        }
      }
    }

    ctx.logger.info('p-a-002-evaluated', { strength });
    return strength === 0
      ? notMatched(ID, 'no slicing pair detected')
      : matched({
          pattern_id: ID,
          strength,
          contributing_event_ids: ids,
          rationale: why.join('; '),
        });
  },
};

registerPattern(definition);
export default definition;
