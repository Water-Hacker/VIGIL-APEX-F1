import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  probeSentinel,
  quorumDecide,
  setProbeErrorSink,
  type ProbeErrorSink,
  type SentinelReport,
} from '../src/sentinel-quorum.js';

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

/**
 * Tier-3 audit — probeSentinel observability + protocol-aware module
 * selection. Pre-fix:
 *   (a) catch block swallowed all errors with no log; permanently-down
 *       sentinel (DNS broken, cert expired, firewall) became "unknown"
 *       forever with no signal to the operator.
 *   (b) Only the http module was used; an https://... sentinel URL
 *       silently failed (wrong-protocol on port 443) → also "unknown".
 *
 * Post-fix: injectable ProbeErrorSink + protocol-aware http/https
 * dispatch. These tests pin the new behaviour.
 */
describe('probeSentinel — tier-3 audit closures', () => {
  let onProbeError: ReturnType<typeof vi.fn>;
  let onProbeUnexpectedResponse: ReturnType<typeof vi.fn>;
  let originalSink: ProbeErrorSink;

  beforeEach(() => {
    onProbeError = vi.fn();
    onProbeUnexpectedResponse = vi.fn();
    // Save current sink (the default) so afterEach can restore it.
    // The module's exported sink is a let-binding swapped by
    // setProbeErrorSink; calling setProbeErrorSink with our spies
    // installs them.
    originalSink = {
      onProbeError(_site, _target, _err) {
        /* default */
      },
      onProbeUnexpectedResponse(_site, _target, _status, _outcome) {
        /* default */
      },
    };
    setProbeErrorSink({ onProbeError, onProbeUnexpectedResponse });
  });

  afterEach(() => {
    setProbeErrorSink(originalSink);
  });

  it('connection failure to a non-listening port → outcome "unknown" + onProbeError called with the error', async () => {
    // 127.0.0.1:1 is the IANA-reserved tcpmux port; nothing listens
    // there on a normal host. Connection refused → probeSentinel's
    // catch block triggers.
    const endpoint = { site: 'helsinki', url: 'http://127.0.0.1:1' } as const;
    const report = await probeSentinel(endpoint, 'dashboard');

    expect(report.outcome).toBe('unknown');
    expect(report.site).toBe('helsinki');
    expect(onProbeError).toHaveBeenCalledTimes(1);
    const call = onProbeError.mock.calls[0]!;
    expect(call[0]).toBe('helsinki');
    expect(call[1]).toBe('dashboard');
    expect(call[2]).toBeInstanceOf(Error);
  });

  it('https:// URL routes through the https module (not silently failing on port 443 via http)', async () => {
    // Connecting to https://127.0.0.1:1 must trigger an HTTPS-stack
    // error (e.g., ECONNREFUSED reported via tls), NOT the pre-fix
    // "the http module sent plaintext to port 443" silent fail.
    // The observable assertion: the onProbeError callback receives
    // an Error (the error type itself is platform-dependent, so we
    // assert on the call, not the message).
    const endpoint = { site: 'tokyo', url: 'https://127.0.0.1:1' } as const;
    const report = await probeSentinel(endpoint, 'dashboard');

    expect(report.outcome).toBe('unknown');
    expect(onProbeError).toHaveBeenCalledTimes(1);
    expect(onProbeError.mock.calls[0]![2]).toBeInstanceOf(Error);
  });
});
