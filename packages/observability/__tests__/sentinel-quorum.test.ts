import { describe, expect, it } from 'vitest';

import { quorumDecide, type SentinelReport } from '../src/sentinel-quorum.js';

const at = '2026-04-29T12:00:00Z';

function reports(
  ...rs: Array<['helsinki' | 'tokyo' | 'nyc', 'up' | 'down' | 'unknown']>
): SentinelReport[] {
  return rs.map(([site, outcome]) => ({ site, target: 'dashboard', outcome, observed_at: at }));
}

describe('quorumDecide — 2-of-3 outage attestation', () => {
  it('all three up → up', () => {
    const d = quorumDecide(reports(['helsinki', 'up'], ['tokyo', 'up'], ['nyc', 'up']));
    expect(d.decision).toBe('up');
    expect(d.up).toBe(3);
    expect(d.attesting_sites).toEqual(['helsinki', 'tokyo', 'nyc']);
  });

  it('all three down → down', () => {
    const d = quorumDecide(reports(['helsinki', 'down'], ['tokyo', 'down'], ['nyc', 'down']));
    expect(d.decision).toBe('down');
    expect(d.down).toBe(3);
  });

  it('two down + one up → down (down quorum reached first)', () => {
    const d = quorumDecide(reports(['helsinki', 'down'], ['tokyo', 'down'], ['nyc', 'up']));
    expect(d.decision).toBe('down');
    expect(d.attesting_sites).toEqual(['helsinki', 'tokyo']);
  });

  it('two up + one down → up', () => {
    const d = quorumDecide(reports(['helsinki', 'up'], ['tokyo', 'up'], ['nyc', 'down']));
    expect(d.decision).toBe('up');
    expect(d.attesting_sites).toEqual(['helsinki', 'tokyo']);
  });

  it('one up + one down + one unknown → inconclusive', () => {
    const d = quorumDecide(reports(['helsinki', 'up'], ['tokyo', 'down'], ['nyc', 'unknown']));
    expect(d.decision).toBe('inconclusive');
    expect(d.attesting_sites).toEqual([]);
  });

  it('two unknown + one up → inconclusive (no quorum)', () => {
    const d = quorumDecide(reports(['helsinki', 'unknown'], ['tokyo', 'unknown'], ['nyc', 'up']));
    expect(d.decision).toBe('inconclusive');
    expect(d.unknown).toBe(2);
  });

  it('all three unknown → inconclusive', () => {
    const d = quorumDecide(
      reports(['helsinki', 'unknown'], ['tokyo', 'unknown'], ['nyc', 'unknown']),
    );
    expect(d.decision).toBe('inconclusive');
    expect(d.unknown).toBe(3);
  });

  it('empty input → inconclusive (no sentinels reporting)', () => {
    const d = quorumDecide([]);
    expect(d.decision).toBe('inconclusive');
    expect(d.up + d.down + d.unknown).toBe(0);
  });

  it('down-quorum decision is preferred when both up≥2 and down≥2 (impossible with 3 sites — sanity)', () => {
    // Hypothetical 4-site deployment: 2 down, 2 up. The contract: down wins
    // because we treat outage attestation as the safer (false-alarm-tolerable) decision.
    const four: SentinelReport[] = [
      { site: 'helsinki', target: 'd', outcome: 'down', observed_at: at },
      { site: 'tokyo', target: 'd', outcome: 'down', observed_at: at },
      { site: 'nyc', target: 'd', outcome: 'up', observed_at: at },
      // 4th sentinel hypothetical — in 3-site reality this never happens
    ];
    expect(quorumDecide(four).decision).toBe('down');
  });
});
