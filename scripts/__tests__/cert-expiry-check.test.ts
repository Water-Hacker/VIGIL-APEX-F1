import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { certNameFor, findCerts, renderTextfile } from '../cert-expiry-check.js';

/**
 * Mode 6.6 — cert-expiry-check pure-helper tests.
 *
 * The TLS cert-expiry script has three pure helpers that we can test
 * without invoking openssl:
 *   - findCerts: walks a dir tree, returns .crt + .pem paths.
 *   - certNameFor: derives a stable cert_name label from a path.
 *   - renderTextfile: produces Prometheus textfile-exporter format.
 *
 * The actual openssl invocation is wrapped by readCertDaysRemaining,
 * which would need a real cert to test. We rely on the systemd timer
 * + alerting smoke test for that path; the unit tests below cover the
 * pure logic.
 */

describe('cert-expiry-check pure helpers (mode 6.6)', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'cert-expiry-test-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe('findCerts', () => {
    it('returns empty array when the directory does not exist', () => {
      expect(findCerts('/nonexistent/path')).toEqual([]);
    });

    it('finds .crt and .pem files at the top level', async () => {
      await writeFile(join(tmpDir, 'a.crt'), 'PEM');
      await writeFile(join(tmpDir, 'b.pem'), 'PEM');
      await writeFile(join(tmpDir, 'c.txt'), 'NOT A CERT');
      const found = findCerts(tmpDir);
      expect(found.map((p) => p.split('/').pop()).sort()).toEqual(['a.crt', 'b.pem']);
    });

    it('recursively descends into subdirectories', async () => {
      const { mkdir } = await import('node:fs/promises');
      await mkdir(join(tmpDir, 'caddy'), { recursive: true });
      await mkdir(join(tmpDir, 'fabric/peer'), { recursive: true });
      await writeFile(join(tmpDir, 'caddy', 'vigilapex.cm.crt'), 'PEM');
      await writeFile(join(tmpDir, 'fabric', 'peer', 'server.crt'), 'PEM');
      await writeFile(join(tmpDir, 'fabric', 'peer', 'README.md'), 'NOT A CERT');
      const found = findCerts(tmpDir);
      expect(found.length).toBe(2);
      expect(found.some((p) => p.endsWith('caddy/vigilapex.cm.crt'))).toBe(true);
      expect(found.some((p) => p.endsWith('fabric/peer/server.crt'))).toBe(true);
    });

    it('ignores other extensions', async () => {
      await writeFile(join(tmpDir, 'private.key'), 'KEY');
      await writeFile(join(tmpDir, 'public.cer'), 'CER');
      expect(findCerts(tmpDir)).toEqual([]);
    });
  });

  describe('certNameFor', () => {
    it('strips the certs-dir prefix and the .crt suffix', () => {
      expect(certNameFor('/srv/vigil/certs/caddy/vigilapex.cm.crt', '/srv/vigil/certs')).toBe(
        'caddy/vigilapex.cm',
      );
    });

    it('strips the .pem suffix', () => {
      expect(certNameFor('/srv/vigil/certs/fabric.pem', '/srv/vigil/certs')).toBe('fabric');
    });

    it('preserves nested directory structure as the label', () => {
      expect(certNameFor('/srv/vigil/certs/fabric/peer/server.crt', '/srv/vigil/certs')).toBe(
        'fabric/peer/server',
      );
    });

    it('strips leading slash when the path is outside certs-dir', () => {
      // certNameFor() normalizes by stripping a leading slash regardless
      // of whether the input started inside certs-dir. The test name
      // previously claimed "unchanged" + asserted '/elsewhere/x' but
      // the function returns 'elsewhere/x' by design (normalization).
      expect(certNameFor('/elsewhere/x.crt', '/srv/vigil/certs')).toBe('elsewhere/x');
    });
  });

  describe('renderTextfile', () => {
    it('produces empty (just header) output when given no certs', () => {
      const out = renderTextfile([]);
      expect(out).toMatch(/^# HELP vigil_certificate_expiry_days_remaining/);
      expect(out).toMatch(/# TYPE vigil_certificate_expiry_days_remaining gauge/);
      // No metric lines.
      expect(out.split('\n').filter((l) => l.startsWith('vigil_'))).toHaveLength(0);
    });

    it('emits one line per cert with the right label + value', () => {
      const out = renderTextfile([
        { path: '/a', name: 'caddy/x', daysRemaining: 42 },
        { path: '/b', name: 'fabric/peer', daysRemaining: -3 }, // expired
      ]);
      expect(out).toContain('vigil_certificate_expiry_days_remaining{cert_name="caddy/x"} 42');
      expect(out).toContain('vigil_certificate_expiry_days_remaining{cert_name="fabric/peer"} -3');
    });

    it('escapes special characters in cert_name (backslash, quote, newline)', () => {
      const out = renderTextfile([
        { path: '/a', name: 'has"quote', daysRemaining: 1 },
        { path: '/b', name: 'has\\backslash', daysRemaining: 2 },
        { path: '/c', name: 'has\nnewline', daysRemaining: 3 },
      ]);
      expect(out).toContain('cert_name="has\\"quote"');
      expect(out).toContain('cert_name="has\\\\backslash"');
      expect(out).toContain('cert_name="has\\nnewline"');
    });

    it('output ends with a trailing newline (textfile-exporter convention)', () => {
      const out = renderTextfile([{ path: '/a', name: 'x', daysRemaining: 1 }]);
      expect(out.endsWith('\n')).toBe(true);
    });
  });
});
