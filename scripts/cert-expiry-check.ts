#!/usr/bin/env tsx
/**
 * Hardening mode 6.6 — TLS certificate expiry monitoring.
 *
 * Scans a directory of TLS certificates and writes a Prometheus
 * textfile-exporter format file with one `vigil_certificate_expiry_days
 * _remaining{cert_name="..."}` line per cert. node_exporter's textfile
 * collector picks it up on its next scrape interval.
 *
 * The script is invoked by a systemd timer (`infra/systemd/vigil-cert
 * -expiry-check.timer`, .service) every hour. Alertmanager fires
 * `CertificateExpiringSoon` when any cert has < 7 days remaining.
 *
 * Operator runs locally:
 *   tsx scripts/cert-expiry-check.ts --certs /srv/vigil/certs --output \
 *     /var/lib/node_exporter/textfile/vigil-certs.prom
 *
 * Defaults pick up the standard production paths so the script is
 * called without args from the systemd unit.
 */

import { execFileSync } from 'node:child_process';
import { readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

interface CertExpiry {
  readonly path: string;
  readonly name: string;
  readonly daysRemaining: number;
}

const DEFAULT_CERTS_DIR = process.env.VIGIL_CERTS_DIR ?? '/srv/vigil/certs';
const DEFAULT_OUTPUT_PATH =
  process.env.VIGIL_CERT_TEXTFILE_PATH ?? '/var/lib/node_exporter/textfile/vigil-certs.prom';

/**
 * Read the `notAfter` date from a PEM certificate via `openssl x509`.
 * Returns the days-remaining; negative if the cert has already expired.
 */
export function readCertDaysRemaining(certPath: string, now: Date = new Date()): number {
  const out = execFileSync('openssl', ['x509', '-enddate', '-noout', '-in', certPath], {
    encoding: 'utf8',
  });
  // openssl emits: `notAfter=Aug 28 23:59:59 2026 GMT`
  const m = out.match(/notAfter=(.+)/);
  if (!m) throw new Error(`cert-expiry-check: could not parse openssl output: ${out}`);
  const notAfter = new Date(m[1]!.trim());
  if (Number.isNaN(notAfter.getTime())) {
    throw new Error(`cert-expiry-check: could not parse notAfter date: ${m[1]}`);
  }
  const diffMs = notAfter.getTime() - now.getTime();
  return Math.floor(diffMs / (1_000 * 60 * 60 * 24));
}

/**
 * Recursively walk `dir`, finding all .crt / .pem files. Symlinks are
 * NOT followed (operator can symlink cert paths into the scan dir if
 * they live elsewhere, but we don't traverse through them).
 */
export function findCerts(dir: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw e;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...findCerts(full));
    } else if (st.isFile() && (entry.endsWith('.crt') || entry.endsWith('.pem'))) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Compute the cert_name label from a cert path. Strips the certs-dir
 * prefix + the .crt/.pem suffix, leaving a stable identifier like
 * `caddy/vigilapex.cm` or `fabric-peer/server`.
 */
export function certNameFor(certPath: string, certsDir: string): string {
  let rel = certPath.startsWith(certsDir) ? certPath.slice(certsDir.length) : certPath;
  if (rel.startsWith('/')) rel = rel.slice(1);
  return rel.replace(/\.(crt|pem)$/, '');
}

/**
 * Render the Prometheus textfile-exporter content. Format:
 *
 *   # HELP vigil_certificate_expiry_days_remaining ...
 *   # TYPE vigil_certificate_expiry_days_remaining gauge
 *   vigil_certificate_expiry_days_remaining{cert_name="caddy/x"} 42
 *   vigil_certificate_expiry_days_remaining{cert_name="caddy/y"} -3
 */
export function renderTextfile(certs: ReadonlyArray<CertExpiry>): string {
  const lines: string[] = [];
  lines.push(
    '# HELP vigil_certificate_expiry_days_remaining Days remaining until cert expiry (mode 6.6)',
  );
  lines.push('# TYPE vigil_certificate_expiry_days_remaining gauge');
  for (const c of certs) {
    // Escape cert_name per Prometheus label-value rules (escape \, ", \n).
    const safe = c.name.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
    lines.push(`vigil_certificate_expiry_days_remaining{cert_name="${safe}"} ${c.daysRemaining}`);
  }
  return lines.join('\n') + '\n';
}

/** Parse CLI flags. */
function parseFlags(argv: ReadonlyArray<string>): { certsDir: string; outputPath: string } {
  let certsDir = DEFAULT_CERTS_DIR;
  let outputPath = DEFAULT_OUTPUT_PATH;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--certs' && argv[i + 1]) {
      certsDir = argv[++i]!;
    } else if (argv[i] === '--output' && argv[i + 1]) {
      outputPath = argv[++i]!;
    }
  }
  return { certsDir, outputPath };
}

async function main(): Promise<number> {
  const { certsDir, outputPath } = parseFlags(process.argv.slice(2));
  const paths = findCerts(certsDir);
  if (paths.length === 0) {
    console.log(`[cert-expiry] no certs found under ${certsDir}; writing empty textfile`);
  }
  const now = new Date();
  const certs: CertExpiry[] = [];
  for (const p of paths) {
    try {
      const days = readCertDaysRemaining(p, now);
      certs.push({ path: p, name: certNameFor(p, certsDir), daysRemaining: days });
    } catch (e) {
      // Log + skip; emit -1 so the alert fires on the malformed cert.
      console.error(`[cert-expiry] failed to read ${p}:`, e);
      certs.push({ path: p, name: certNameFor(p, certsDir), daysRemaining: -1 });
    }
  }
  const content = renderTextfile(certs);
  // Ensure the output directory exists for the writeFile call.
  try {
    const { mkdirSync } = await import('node:fs');
    mkdirSync(dirname(outputPath), { recursive: true });
  } catch {
    // Best effort — if mkdir fails, writeFile will surface a clearer error.
  }
  // Atomic write: write to a temp file in the same dir, then rename.
  const tmp = `${outputPath}.tmp`;
  writeFileSync(tmp, content);
  const { renameSync } = await import('node:fs');
  renameSync(tmp, outputPath);
  console.log(`[cert-expiry] wrote ${certs.length} cert(s) to ${outputPath}`);
  return 0;
}

// Only run main when invoked directly (so unit tests can import the
// helpers without firing the script).
const invokedDirectly = (() => {
  try {
    // tsx + ESM: import.meta.url path matches argv[1].
    const here = new URL(import.meta.url).pathname;
    return process.argv[1] === here || process.argv[1]?.endsWith('cert-expiry-check.ts');
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error('[cert-expiry] crashed:', err);
      process.exit(2);
    });
}
