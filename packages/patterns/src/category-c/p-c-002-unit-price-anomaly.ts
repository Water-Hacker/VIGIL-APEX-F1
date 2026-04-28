import { type Schemas } from '@vigil/shared';

import { matched, notMatched, PID } from '../_pattern-helpers.js';
import { registerPattern } from '../registry.js';
import type { PatternDef } from '../types.js';

/**
 * P-C-002 — Unit-price anomaly.
 *
 * Per-unit price for a line item materially deviates from its sectoral
 * benchmark (catalogue / median across recent comparable contracts). Distinct
 * from P-C-001 which compares total amount; this one inspects line items.
 */
const ID = PID('P-C-002');
const ANOMALY_RATIO = 1.5; // 50 % above benchmark unit price

const definition: PatternDef = {
  id: ID,
  category: 'C',
  subjectKinds: ['Tender'],
  title_fr: 'Prix unitaire aberrant sur une ligne',
  title_en: 'Unit-price anomaly on a line item',
  description_fr:
    "Au moins une ligne du marché présente un prix unitaire >= 1,5× la médiane sectorielle.",
  description_en: 'At least one line item carries a unit price ≥ 1.5× the sectoral median.',
  defaultPrior: 0.16,
  defaultWeight: 0.6,
  status: 'live',

  async detect(subject, _ctx): Promise<Schemas.PatternResult> {
    const award = subject.events.find((e) => e.kind === 'award');
    if (!award) return notMatched(ID, 'no award');
    const lines = (award.payload['line_items'] as
      | Array<{ unit_price_xaf: number; benchmark_xaf?: number; description?: string }>
      | undefined) ?? [];
    let strength = 0;
    const why: string[] = [];
    for (const li of lines) {
      const u = Number(li.unit_price_xaf);
      const b = Number(li.benchmark_xaf ?? 0);
      if (!Number.isFinite(u) || b <= 0) continue;
      const ratio = u / b;
      if (ratio >= ANOMALY_RATIO) {
        const s = Math.min(1, (ratio - 1) / 3);
        if (s > strength) strength = s;
        why.push(`${li.description ?? 'line'} ratio=${ratio.toFixed(2)}`);
      }
    }
    return strength === 0
      ? notMatched(ID, 'no line item above 1.5× benchmark')
      : matched({
          pattern_id: ID,
          strength,
          contributing_event_ids: [award.id],
          rationale: why.slice(0, 5).join('; '),
        });
  },
};

registerPattern(definition);
export default definition;
