/**
 * SSRF guard — adapter T14 audit closure.
 *
 * The system fetches document URLs that come from adapter-scraped HTML
 * (PDF link href attributes, `report_url` payload fields, etc.). That
 * content is adversary-controlled — a compromised or malicious upstream
 * source can publish a "document URL" that points at internal
 * infrastructure:
 *
 *   - cloud metadata services      (169.254.169.254, fd00:ec2::254, …)
 *   - localhost / loopback         (127.0.0.0/8, ::1)
 *   - RFC1918 private networks     (10/8, 172.16/12, 192.168/16)
 *   - link-local / unique-local    (169.254/16, fe80::/10, fc00::/7)
 *   - common internal hostnames    (`localhost`, `*.local`, `*.internal`)
 *
 * `isPublicHttpUrl` performs a synchronous URL-shape check that catches
 * the obvious literal-IP and internal-hostname cases. DNS-rebinding —
 * where a hostname resolves to a public IP at validation time and a
 * private IP at fetch time — requires resolve-then-pin-IP at the
 * connection layer; that is out of scope for this guard. Callers that
 * need rebinding resistance should additionally pin the resolved IP
 * through the dispatcher.
 *
 * The guard is conservative: anything it cannot positively classify as
 * a public hostname is rejected. False positives are recoverable
 * (operator adds the domain to an explicit allowlist downstream); false
 * negatives are not (one bad URL exfiltrates Vault tokens or pivots
 * into the internal network).
 */

import { isIP } from 'node:net';

export interface SsrfGuardOptions {
  /** Permit additional hostnames (case-insensitive exact match). Default empty. */
  readonly extraAllowedHosts?: ReadonlyArray<string>;
}

export interface SsrfGuardResult {
  readonly ok: boolean;
  readonly reason?: string;
}

/**
 * Hostnames that look public on the wire but are conventionally used
 * to reach internal services. Block by suffix.
 */
const INTERNAL_HOSTNAME_SUFFIXES: ReadonlyArray<string> = [
  '.local',
  '.localhost',
  '.internal',
  '.intranet',
  '.lan',
  '.corp',
  '.home',
  '.private',
];

/** Literal hostnames that must never be reachable. */
const RESERVED_HOSTNAMES: ReadonlyArray<string> = [
  'localhost',
  'ip6-localhost',
  'ip6-loopback',
  'broadcasthost',
];

/**
 * IPv4 ranges that must never be reachable from a credentialed fetch.
 * Each entry is [first-octet-low, first-octet-high, second-octet-low, second-octet-high].
 * Single-octet ranges set second-octet-* to [0, 255].
 */
const PRIVATE_IPV4_RANGES: ReadonlyArray<readonly [number, number, number, number]> = [
  [0, 0, 0, 255], // "this network" — 0.0.0.0/8
  [10, 10, 0, 255], // RFC1918 — 10.0.0.0/8
  [100, 100, 64, 127], // CGNAT — 100.64.0.0/10
  [127, 127, 0, 255], // loopback — 127.0.0.0/8
  [169, 169, 254, 254], // link-local — 169.254.0.0/16
  [172, 172, 16, 31], // RFC1918 — 172.16.0.0/12
  [192, 192, 0, 0], // benchmarking + protocol assignments — 192.0.0.0/24 (first /24 only)
  [192, 192, 168, 168], // RFC1918 — 192.168.0.0/16
  [198, 198, 18, 19], // benchmarking — 198.18.0.0/15
  [224, 239, 0, 255], // multicast — 224.0.0.0/4
  [240, 255, 0, 255], // future use — 240.0.0.0/4
];

function isPrivateIpv4(addr: string): boolean {
  const parts = addr.split('.');
  if (parts.length !== 4) return true; // malformed — refuse
  const octets = parts.map((p) => Number.parseInt(p, 10));
  if (octets.some((o) => Number.isNaN(o) || o < 0 || o > 255)) return true;
  const [a, b] = octets as [number, number, number, number];
  for (const [lo1, hi1, lo2, hi2] of PRIVATE_IPV4_RANGES) {
    if (a >= lo1 && a <= hi1 && b >= lo2 && b <= hi2) return true;
  }
  return false;
}

function isPrivateIpv6(addr: string): boolean {
  const lower = addr.toLowerCase();
  // Loopback / unspecified
  if (lower === '::1' || lower === '::') return true;
  // IPv4-mapped IPv6 (`::ffff:a.b.c.d` or its normalized `::ffff:HEX:HEX` form).
  // Public Internet URLs do not use this form; treat unconditionally as
  // suspicious. This blocks both `::ffff:127.0.0.1` and the canonicalized
  // `::ffff:7f00:1` that Node's WHATWG URL parser emits.
  if (lower.startsWith('::ffff:')) return true;
  // Link-local: fe80::/10  (fe80..febf at the first 16-bit hextet)
  if (/^fe[89ab][0-9a-f]{0,2}:/i.test(lower)) return true;
  // Unique-local: fc00::/7  (fc00..fdff at the first 16-bit hextet)
  if (/^f[cd][0-9a-f]{0,3}:/i.test(lower)) return true;
  // Documentation: 2001:db8::/32
  if (lower.startsWith('2001:db8:') || lower === '2001:db8::') return true;
  // Multicast: ff00::/8
  if (lower.startsWith('ff')) return true;
  return false;
}

/**
 * Validate that a URL is safe to fetch credentialed from the worker
 * network namespace.
 *
 * Rules:
 *   1. Scheme must be `http:` or `https:`.
 *   2. URL must parse via `new URL()`.
 *   3. Hostname must not be a reserved literal (`localhost`, …).
 *   4. Hostname must not end with a reserved suffix (`*.local`, …).
 *   5. If hostname is a literal IPv4/IPv6 address, it must not fall
 *      into any private / loopback / link-local / multicast / future
 *      range.
 *
 * The check is synchronous and offline; it does NOT resolve DNS.
 */
export function isPublicHttpUrl(rawUrl: string, opts: SsrfGuardOptions = {}): SsrfGuardResult {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { ok: false, reason: 'url-unparseable' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, reason: `scheme-not-http: ${parsed.protocol}` };
  }
  const hostnameRaw = parsed.hostname;
  if (!hostnameRaw) {
    return { ok: false, reason: 'empty-hostname' };
  }
  // `URL.hostname` preserves the surrounding `[...]` for literal IPv6
  // addresses; strip them so `isIP` and the lowercase suffix matching
  // operate on the bare address.
  const hostname = (
    hostnameRaw.startsWith('[') && hostnameRaw.endsWith(']')
      ? hostnameRaw.slice(1, -1)
      : hostnameRaw
  ).toLowerCase();

  if (opts.extraAllowedHosts?.some((h) => h.toLowerCase() === hostname)) {
    return { ok: true };
  }

  if (RESERVED_HOSTNAMES.includes(hostname)) {
    return { ok: false, reason: `reserved-hostname: ${hostname}` };
  }
  for (const suffix of INTERNAL_HOSTNAME_SUFFIXES) {
    if (hostname.endsWith(suffix)) {
      return { ok: false, reason: `internal-suffix: ${suffix}` };
    }
  }

  // Literal IP cases
  const ipFamily = isIP(hostname);
  if (ipFamily === 4) {
    return isPrivateIpv4(hostname)
      ? { ok: false, reason: `private-ipv4: ${hostname}` }
      : { ok: true };
  }
  if (ipFamily === 6) {
    return isPrivateIpv6(hostname)
      ? { ok: false, reason: `private-ipv6: ${hostname}` }
      : { ok: true };
  }

  // Generic hostname — require at least one dot so single-label names
  // like `vault`, `redis`, `postgres` (which Docker / k8s would resolve
  // to an internal service) are rejected.
  if (!hostname.includes('.')) {
    return { ok: false, reason: `single-label-hostname: ${hostname}` };
  }

  return { ok: true };
}
