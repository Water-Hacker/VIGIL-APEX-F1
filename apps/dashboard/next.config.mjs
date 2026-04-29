/** @type {import('next').NextConfig} */

import { createRequire } from 'node:module';

// Per-surface CSP — operator dashboards, public verify, and the tip portal
// each have different trust requirements. Defining them here (rather than
// at the Caddy layer) means they ship together with the route code, so a
// dev pulling the dashboard alone still gets the correct policy.
const CSP_OPERATOR = [
  "default-src 'self'",
  "img-src 'self' data: blob: https://api.mapbox.com",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self'",
  // Server-Sent Events (Phase C12) connects to /api/realtime; keycloak
  // logout posts back to the realm.
  "connect-src 'self' https://kc.vigilapex.cm",
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self' https://kc.vigilapex.cm",
].join('; ');

const CSP_PUBLIC = [
  "default-src 'self'",
  "img-src 'self' data: blob:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self'",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
].join('; ');

const CSP_TIP = [
  "default-src 'self'",
  // Cloudflare Turnstile drops a script + iframe.
  "script-src 'self' https://challenges.cloudflare.com",
  "frame-src https://challenges.cloudflare.com",
  "style-src 'self' 'unsafe-inline'",
  // libsodium-wrappers is bundled locally — no remote CDN.
  "connect-src 'self'",
  "img-src 'self' data:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

const COMMON_SECURITY_HEADERS = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'geolocation=(), microphone=(), camera=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
];

const nextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    serverComponentsExternalPackages: ['pg', '@vigil/db-postgres'],
  },
  async headers() {
    return [
      // Public verify surface — reduced CSP, can be cached.
      {
        source: '/verify/:path*',
        headers: [
          ...COMMON_SECURITY_HEADERS,
          { key: 'Content-Security-Policy', value: CSP_PUBLIC },
          { key: 'Cache-Control', value: 'public, max-age=300' },
        ],
      },
      {
        source: '/ledger/:path*',
        headers: [
          ...COMMON_SECURITY_HEADERS,
          { key: 'Content-Security-Policy', value: CSP_PUBLIC },
          { key: 'Cache-Control', value: 'public, max-age=300' },
        ],
      },
      // Tip portal — needs Turnstile origins.
      {
        source: '/tip/:path*',
        headers: [
          ...COMMON_SECURITY_HEADERS,
          { key: 'Content-Security-Policy', value: CSP_TIP },
          { key: 'Referrer-Policy', value: 'no-referrer' },
        ],
      },
      // Tip status (public, but no Turnstile).
      {
        source: '/tip',
        headers: [
          ...COMMON_SECURITY_HEADERS,
          { key: 'Content-Security-Policy', value: CSP_TIP },
          { key: 'Referrer-Policy', value: 'no-referrer' },
        ],
      },
      // Operator dashboard — strictest default; no inline scripts.
      {
        source: '/(.*)',
        headers: [
          ...COMMON_SECURITY_HEADERS,
          { key: 'Content-Security-Policy', value: CSP_OPERATOR },
        ],
      },
    ];
  },
  webpack: (config) => {
    // libsodium-wrappers-sumo@0.7.16 ships an ESM build that references a
    // sibling .mjs file that pnpm hoists to a different package directory,
    // which webpack cannot resolve. Force resolution through the package's
    // CJS main entry, which is self-contained.
    const sumoCjs = createRequire(import.meta.url).resolve(
      'libsodium-wrappers-sumo',
    );
    config.resolve.alias = {
      ...(config.resolve.alias ?? {}),
      'libsodium-wrappers-sumo$': sumoCjs,
    };
    return config;
  },
};

export default nextConfig;
