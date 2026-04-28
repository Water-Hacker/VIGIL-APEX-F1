import { type Schemas } from '@vigil/shared';

import { matched, notMatched, PID } from '../_pattern-helpers.js';
import { registerPattern } from '../registry.js';
import type { PatternDef } from '../types.js';

/**
 * P-D-003 — Site mismatch (work performed at a different location).
 *
 * Satellite imagery shows construction activity at coordinates materially
 * distant from the contract's declared GPS coordinates (≥ 500 m). Either the
 * spec is wrong or work was diverted to an undisclosed site.
 */
const ID = PID('P-D-003');
const DISTANCE_THRESHOLD_M = 500;

const definition: PatternDef = {
  id: ID,
  category: 'D',
  subjectKinds: ['Project'],
  title_fr: "Site d'exécution incohérent",
  title_en: 'Site mismatch (work at different coordinates)',
  description_fr:
    "Activité satellitaire à plus de 500 m des coordonnées GPS déclarées dans le marché.",
  description_en:
    'Satellite activity ≥ 500 m from the GPS coordinates declared in the contract.',
  defaultPrior: 0.20,
  defaultWeight: 0.7,
  status: 'live',

  async detect(subject, _ctx): Promise<Schemas.PatternResult> {
    const award = subject.events.find((e) => e.kind === 'award');
    const sat = subject.events.find((e) => e.kind === 'satellite_imagery');
    if (!award || !sat) return notMatched(ID, 'missing award or satellite');
    const declared = award.payload['gps'] as { lat: number; lon: number } | undefined;
    const observed = sat.payload['activity_centroid'] as { lat: number; lon: number } | undefined;
    if (!declared || !observed) return notMatched(ID, 'missing GPS');

    const distance = haversineMeters(declared.lat, declared.lon, observed.lat, observed.lon);
    if (distance < DISTANCE_THRESHOLD_M) return notMatched(ID, `distance=${distance.toFixed(0)}m`);
    const strength = Math.min(1, distance / 5000);
    return matched({
      pattern_id: ID,
      strength,
      contributing_event_ids: [award.id, sat.id],
      contributing_document_cids: [...award.document_cids, ...sat.document_cids],
      rationale: `activity ${distance.toFixed(0)}m from declared coordinates`,
    });
  },
};

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6_371_000;
  const toRad = (d: number): number => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

registerPattern(definition);
export default definition;
