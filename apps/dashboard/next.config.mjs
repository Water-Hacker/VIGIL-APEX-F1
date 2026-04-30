/** @type {import('next').NextConfig} */

import { createRequire } from 'node:module';
import path from 'node:path';

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
  'frame-src https://challenges.cloudflare.com',
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
  // Transpile workspace packages so Next compiles them through its own
  // SWC pipeline instead of consuming the prebuilt CJS dist directly.
  // Without this, Next dev's React Refresh loader injects
  // `import.meta.webpackHot.accept()` into the CJS module, which
  // webpack cannot parse and the page returns 500. Production
  // (`next build`) is unaffected because Refresh isn't injected, but
  // the a11y job runs against `next dev` so it hits the dev-only path.
  transpilePackages: ['@vigil/shared', '@vigil/observability'],
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
  webpack: (config, { isServer }) => {
    // libsodium-wrappers-sumo@0.7.16 ships an ESM build that references a
    // sibling .mjs file that pnpm hoists to a different package directory,
    // which webpack cannot resolve. Force resolution through the package's
    // CJS main entry, which is self-contained.
    const sumoCjs = createRequire(import.meta.url).resolve('libsodium-wrappers-sumo');
    config.resolve.alias = {
      ...(config.resolve.alias ?? {}),
      'libsodium-wrappers-sumo$': sumoCjs,
    };
    // The client bundle pulls @vigil/shared via the tip portal's
    // `import { TipSanitise } from '@vigil/shared'`. The shared package's
    // barrel re-exports `Ids` (ids.ts), which imports `randomUUID` from
    // `node:crypto`. The actual call is dead code from the browser's
    // perspective — TipSanitise doesn't use Ids — but webpack still
    // bundles the file, then chokes on the `node:` URL scheme. We mark
    // node:crypto / crypto as unavailable on the client; any unintended
    // call will throw at runtime instead of failing the build silently.
    if (!isServer) {
      config.resolve.fallback = {
        ...(config.resolve.fallback ?? {}),
        crypto: false,
      };
      // Strip the `node:` URL scheme so the fallback above (crypto: false)
      // takes effect on the client bundle.
      const webpack = createRequire(import.meta.url)('next/dist/compiled/webpack/webpack.js');
      const wp = webpack.webpack ?? webpack;
      config.plugins ??= [];
      config.plugins.push(new wp.NormalModuleReplacementPlugin(/^node:crypto$/, 'crypto'));
    }
    // Client bundle alias: redirect `@vigil/shared/tip-sanitise` to
    // its TypeScript source so Next compiles it through its own SWC
    // pipeline instead of consuming the prebuilt CJS dist. The dist
    // is `type: "commonjs"`, but Next dev's React Refresh loader
    // injects `import.meta.webpackHot.accept()` into every JS module
    // it processes — webpack's CJS parser then rejects `import.meta`
    // and the route returns 500. Compiling from .ts dodges the
    // CJS/ESM mismatch entirely. transpilePackages above ensures the
    // SWC pipeline applies. Server bundle keeps the dist (no Refresh
    // loader, no problem).
    if (!isServer) {
      // Resolve @vigil/shared via its registered "." entry, then walk
      // up from the resolved dist file to the package root, then point
      // at src/tip-sanitise.ts. Alternative `@vigil/shared/package.json`
      // lookup fails because the package's `exports` field doesn't
      // expose package.json.
      const sharedDistEntry = createRequire(import.meta.url).resolve('@vigil/shared');
      const sharedRoot = path.resolve(sharedDistEntry, '..', '..');
      config.resolve.alias = {
        ...(config.resolve.alias ?? {}),
        '@vigil/shared/tip-sanitise$': path.join(sharedRoot, 'src', 'tip-sanitise.ts'),
      };
    }
    return config;
  },
};

export default nextConfig;
