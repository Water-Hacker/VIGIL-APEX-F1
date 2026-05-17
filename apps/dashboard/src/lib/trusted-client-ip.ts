/**
 * Tier-55 audit closure — explicit trust gate for proxy-forwarded
 * client IPs.
 *
 * The production Caddy edge sets `cf-connecting-ip` (via Cloudflare)
 * and `x-forwarded-for`, both of which are unconditionally trusted
 * by the per-route rate-limit and the Turnstile `remoteip` parameter.
 * In a misconfigured deployment (no Caddy, Caddy not stripping
 * client-supplied versions of these headers, dev-mode `next dev`),
 * an attacker can spoof any IP they want by setting these headers
 * directly — bypassing per-IP rate limits and feeding Cloudflare a
 * lie that may bias its risk score.
 *
 * `getTrustedClientIp` makes the trust assumption EXPLICIT via the
 * `TRUST_PROXY_HEADERS` env var. Trust the forwarded headers only
 * when EITHER:
 *   - `TRUST_PROXY_HEADERS=true` is set explicitly (production deploy
 *     under Caddy + Cloudflare), OR
 *   - `NODE_ENV=production` (graceful default for production builds
 *     that haven't migrated to setting the explicit var yet).
 *
 * Otherwise return `null`. Routes that use the IP for rate-limit
 * keying should fall back to a deterministic-but-unidentifying
 * bucket (`'unknown'` is the existing convention). Routes that pass
 * the IP to Turnstile's `remoteip` parameter should omit it when
 * untrusted — Cloudflare treats omission as "I don't know" rather
 * than as a hint.
 *
 * Pre-fix this trust was implicit + unconditional. Post-fix, dev
 * deployments see `null` (one rate-limit bucket for all requests —
 * single-tenant safe) and production-misconfigured deployments are
 * surfaced at boot-time review when an operator notices their
 * rate-limit metric is collapsed.
 */
import type { NextRequest } from 'next/server';

/** Default true when NODE_ENV=production; otherwise honour the env var. */
function defaultsToTrusted(): boolean {
  if (process.env.TRUST_PROXY_HEADERS === 'true') return true;
  if (process.env.TRUST_PROXY_HEADERS === 'false') return false;
  return process.env.NODE_ENV === 'production';
}

/**
 * Returns the trusted client IP, or `null` when proxy-header trust
 * is not in effect. Callers should treat `null` as "single anonymous
 * bucket" for rate-limit keys, NOT as "no client IP" (every request
 * has an IP at the TCP layer — we just refuse to read the
 * untrusted-header claim about it).
 */
export function getTrustedClientIp(req: NextRequest): string | null {
  if (!defaultsToTrusted()) return null;
  return (
    req.headers.get('cf-connecting-ip') ??
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    null
  );
}
