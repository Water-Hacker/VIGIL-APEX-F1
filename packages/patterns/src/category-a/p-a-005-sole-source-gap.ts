import { type Schemas } from '@vigil/shared';

import { matched, notMatched, PID } from '../_pattern-helpers.js';
import { registerPattern } from '../registry.js';

import type { PatternDef } from '../types.js';

/**
 * P-A-005 — Sole-source repeat (no competitive review window).
 *
 * Same supplier wins ≥ 3 sole-source / no-bid awards from the same authority
 * within 12 months. Distinct from P-A-002 (size slicing) — this one watches
 * award FREQUENCY rather than size.
 */
const ID = PID('P-A-005');
const WINDOW_DAYS = 365;

const definition: PatternDef = {
  id: ID,
  category: 'A',
  subjectKinds: ['Tender'],
  title_fr: 'Marchés répétitifs sans mise en concurrence',
  title_en: 'Repeat no-bid awards',
  description_fr:
    "Le même fournisseur remporte au moins trois marchés gré-à-gré du même donneur d'ordre en 12 mois.",
  description_en:
    'Same supplier wins ≥ 3 no-bid awards from the same authority within 12 months.',
  defaultPrior: 0.16,
  defaultWeight: 0.65,
  status: 'live',

  async detect(subject, _ctx): Promise<Schemas.PatternResult> {
    const awards = subject.events.filter((e) => e.kind === 'award');
    if (awards.length < 3) return notMatched(ID, 'fewer than 3 awards');

    const noBids = awards.filter((a) => {
      const m = (a.payload['procurement_method'] as string | undefined) ?? '';
      const lower = m.toLowerCase();
      return lower.includes('gré à gré') || lower.includes('sole-source') || lower.includes('négocié');
    });
    if (noBids.length < 3) return notMatched(ID, 'fewer than 3 no-bid awards');

    // Group by supplier
    const bySupplier = new Map<string, typeof noBids>();
    for (const a of noBids) {
      const supplier = (a.payload['supplier_name'] as string | undefined) ?? null;
      if (!supplier) continue;
      const arr = bySupplier.get(supplier) ?? [];
      arr.push(a);
      bySupplier.set(supplier, arr);
    }
    let bestStrength = 0;
    const ids: string[] = [];
    let bestSupplier = '';
    for (const [supplier, batch] of bySupplier) {
      if (batch.length < 3) continue;
      // Are at least 3 within a 365d sliding window?
      batch.sort((x, y) => (x.published_at ?? '').localeCompare(y.published_at ?? ''));
      for (let i = 0; i + 2 < batch.length; i++) {
        const a = batch[i]!;
        const c = batch[i + 2]!;
        if (!a.published_at || !c.published_at) continue;
        const days = (new Date(c.published_at).getTime() - new Date(a.published_at).getTime()) / 86_400_000;
        if (days <= WINDOW_DAYS) {
          const strength = Math.min(1, 0.55 + (batch.length - 3) * 0.08);
          if (strength > bestStrength) {
            bestStrength = strength;
            bestSupplier = supplier;
            ids.length = 0;
            ids.push(...batch.map((b) => b.id));
          }
          break;
        }
      }
    }
    return bestStrength === 0
      ? notMatched(ID, 'no 3-in-12-month cluster')
      : matched({
          pattern_id: ID,
          strength: bestStrength,
          contributing_event_ids: ids,
          rationale: `supplier=${bestSupplier} repeat no-bid pattern`,
        });
  },
};

registerPattern(definition);
export default definition;
