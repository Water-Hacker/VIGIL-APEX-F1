import { describe, expect, it } from 'vitest';

import { parseChronycTracking, parseTimedatectl, renderTextfile } from '../ntp-check.js';

/**
 * Mode 6.7 — ntp-check pure-helper tests.
 *
 * The clock-skew script has three pure helpers that we test without
 * invoking real time daemons:
 *   - parseChronycTracking: parses chronyc tracking output.
 *   - parseTimedatectl: parses timedatectl show output.
 *   - renderTextfile: produces Prometheus textfile content.
 *
 * The actual `chronyc` / `timedatectl` invocations are wrapped by
 * readNtpStateOrFallback, which needs a running system to test. The
 * unit tests below cover the pure parsing logic so a future format
 * change (chrony 4.x output drift, for instance) is caught early.
 */

describe('parseChronycTracking', () => {
  it('parses an in-sync sample with positive offset (clock fast)', () => {
    const out = `
Reference ID    : 0a000001 (10.0.0.1)
Stratum         : 3
Ref time (UTC)  : Wed May 14 12:00:00 2025
System time     : 0.000456789 seconds fast of NTP time
Last offset     : +0.000123456 seconds
RMS offset      : 0.000098765 seconds
Frequency       : 12.345 ppm slow
Residual freq   : +0.012 ppm
Skew            : 0.567 ppm
Root delay      : 0.012345 seconds
Root dispersion : 0.000234567 seconds
Update interval : 64.2 seconds
Leap status     : Normal
`;
    const r = parseChronycTracking(out);
    expect(r.synced).toBe(true);
    // 0.000456789 seconds fast → positive
    expect(r.offsetSeconds).toBeCloseTo(0.000456789, 9);
  });

  it('parses a sample with negative offset (clock slow)', () => {
    const out = `System time     : 0.001234567 seconds slow of NTP time
Leap status     : Normal`;
    const r = parseChronycTracking(out);
    expect(r.synced).toBe(true);
    expect(r.offsetSeconds).toBeCloseTo(-0.001234567, 9);
  });

  it('reports synced=false when Leap status is not Normal', () => {
    const out = `System time     : 0.5 seconds fast of NTP time
Leap status     : Unsynchronised`;
    const r = parseChronycTracking(out);
    expect(r.synced).toBe(false);
    // Offset still extracted for completeness.
    expect(r.offsetSeconds).toBeCloseTo(0.5);
  });

  it('reports synced=false and offset=0 when output is malformed', () => {
    const r = parseChronycTracking('garbage output');
    expect(r.synced).toBe(false);
    expect(r.offsetSeconds).toBe(0);
  });

  it('handles scientific-notation offsets', () => {
    const out = `System time     : 1.23e-6 seconds fast of NTP time
Leap status     : Normal`;
    const r = parseChronycTracking(out);
    expect(r.synced).toBe(true);
    expect(r.offsetSeconds).toBeCloseTo(1.23e-6, 9);
  });
});

describe('parseTimedatectl', () => {
  it('returns synced=true when NTPSynchronized=yes', () => {
    const r = parseTimedatectl('Timezone=UTC\nNTPSynchronized=yes\nLocalRTC=no');
    expect(r.synced).toBe(true);
  });

  it('returns synced=false when NTPSynchronized=no', () => {
    const r = parseTimedatectl('NTPSynchronized=no\n');
    expect(r.synced).toBe(false);
  });

  it('returns synced=false when the line is missing', () => {
    const r = parseTimedatectl('Timezone=UTC\n');
    expect(r.synced).toBe(false);
  });

  it('handles case-insensitive matching', () => {
    const r = parseTimedatectl('ntpsynchronized=YES');
    expect(r.synced).toBe(true);
  });
});

describe('renderTextfile', () => {
  it('emits the two gauges with the right host label', () => {
    const out = renderTextfile({ synced: true, offsetSeconds: 0.001 }, 'node-a.vigilapex.cm');
    expect(out).toContain('vigil_ntp_synced{host="node-a.vigilapex.cm"} 1');
    expect(out).toContain('vigil_ntp_offset_seconds{host="node-a.vigilapex.cm"} 0.001');
  });

  it('emits synced=0 when state is not synced', () => {
    const out = renderTextfile({ synced: false, offsetSeconds: 0 }, 'host');
    expect(out).toContain('vigil_ntp_synced{host="host"} 0');
  });

  it('escapes special characters in the host label', () => {
    const out = renderTextfile({ synced: true, offsetSeconds: 0 }, 'host"with\\back');
    expect(out).toContain('vigil_ntp_synced{host="host\\"with\\\\back"} 1');
  });

  it('emits both # HELP and # TYPE lines per gauge', () => {
    const out = renderTextfile({ synced: true, offsetSeconds: 0 }, 'h');
    expect(out).toMatch(/# HELP vigil_ntp_synced/);
    expect(out).toMatch(/# TYPE vigil_ntp_synced gauge/);
    expect(out).toMatch(/# HELP vigil_ntp_offset_seconds/);
    expect(out).toMatch(/# TYPE vigil_ntp_offset_seconds gauge/);
  });

  it('output ends with a trailing newline', () => {
    const out = renderTextfile({ synced: true, offsetSeconds: 0 }, 'h');
    expect(out.endsWith('\n')).toBe(true);
  });
});
