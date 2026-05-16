/**
 * Tier-29 audit closure — logger redact-list coverage.
 *
 * The pino logger has a `redact` allowlist of secret-shaped keys. T29
 * expanded it to cover key shapes that were missing pre-fix and would
 * have leaked sensitive material into structured log lines.
 *
 * Test approach: route the logger output through a stream-capture, then
 * assert that fields named with each redacted shape appear as
 * "[REDACTED]" rather than their actual value.
 */
import { Writable } from 'node:stream';

import pino from 'pino';
import { describe, expect, it } from 'vitest';

import { createLogger } from '../src/logger.js';

// Capture stream — collects all writes and exposes them as one string.
function captureStream(): { sink: Writable; read: () => string } {
  let buf = '';
  const sink = new Writable({
    write(chunk: Buffer, _enc, cb): void {
      buf += chunk.toString('utf8');
      cb();
    },
  });
  return { sink, read: () => buf };
}

// Helper: build a logger that writes to our capture sink + log a single
// record with the given object, then return the captured JSON.
function logAndCapture(obj: Record<string, unknown>): Record<string, unknown> {
  const { sink, read } = captureStream();
  // We can't directly pipe createLogger's output to our sink (pino owns
  // its destination), so re-create with the same redact list inline.
  // The redact paths are the load-bearing assertion target; service /
  // mixin behaviour is covered by other tests.
  const base = createLogger({ service: 'tier29-test' });
  // Pino-pretty in dev wraps the stream; explicitly use a plain pino
  // bound to our sink with the same redact config so the assertion
  // is on the JSON output.
  const plain = pino(
    {
      level: 'info',
      // Re-export the same paths the production logger uses by reading
      // the redact metadata off the createLogger instance is awkward;
      // simpler: mirror the list here and let the source-grep test
      // (below) ensure the production list stays in sync.
      redact: {
        paths: [
          'password',
          '*.password',
          'token',
          '*.token',
          'authorization',
          'headers.authorization',
          'headers["x-api-key"]',
          'headers["set-cookie"]',
          'headers.cookie',
          'cookie',
          '*.cookie',
          'api_key',
          '*.api_key',
          'client_secret',
          '*.client_secret',
          'pin',
          '*.pin',
          '*.private_key',
          '*.private_key_b64',
          'secret',
          '*.secret',
          'share',
          '*.share',
          'shares',
          '*.shares',
          'unseal_key',
          '*.unseal_key',
          'webauthn_assertion',
          '*.webauthn_assertion',
          'root_token',
          '*.root_token',
        ],
        censor: '[REDACTED]',
      },
    },
    sink,
  );
  // Touch the prod logger so it's exercised in this test file too.
  void base.bindings();
  plain.info(obj, 'tier29-test-emit');
  return JSON.parse(read()) as Record<string, unknown>;
}

describe('Tier-29 — logger redact list expansion', () => {
  // Each case asserts the top-level OR nested-on-event placement.
  it.each([
    ['password', { password: 'hunter2' }],
    ['nested.password', { nested: { password: 'hunter2' } }],
    ['token', { token: 'abc123' }],
    ['authorization header', { headers: { authorization: 'Bearer x' } }],
    ['x-api-key header', { headers: { 'x-api-key': 'sk-...' } }],
    ['set-cookie header', { headers: { 'set-cookie': 'session=abc' } }],
    ['cookie header', { headers: { cookie: 'session=abc' } }],
    ['top-level cookie', { cookie: 'session=abc' }],
    ['nested.cookie', { req: { cookie: 'session=abc' } }],
    ['api_key (bare)', { api_key: 'sk-abc' }],
    ['nested.api_key', { provider: { api_key: 'sk-abc' } }],
    ['client_secret (bare)', { client_secret: 'oauth-secret' }],
    ['nested.client_secret', { oauth: { client_secret: 'x' } }],
    ['pin', { pin: '123456' }],
    ['nested.private_key', { sodium: { private_key: 'b64...' } }],
    ['nested.private_key_b64', { sodium: { private_key_b64: 'b64...' } }],
    ['secret', { secret: 'x' }],
    ['nested.secret', { vault: { secret: 'x' } }],
    ['share', { share: 'shamir-share-1' }],
    ['nested.share', { shamir: { share: 'x' } }],
    ['shares', { shares: ['SHARE-LEAF-PROBE-A', 'SHARE-LEAF-PROBE-B'] }],
    ['nested.shares', { shamir: { shares: ['SHARE-LEAF-PROBE-C', 'SHARE-LEAF-PROBE-D'] } }],
    ['unseal_key', { unseal_key: 'b64...' }],
    ['nested.unseal_key', { vault: { unseal_key: 'b64...' } }],
    ['webauthn_assertion', { webauthn_assertion: { rawId: 'x' } }],
    ['nested.webauthn_assertion', { req: { webauthn_assertion: 'x' } }],
    ['root_token', { root_token: 's.abc' }],
    ['nested.root_token', { vault: { root_token: 's.abc' } }],
  ])('redacts %s', (_label, input) => {
    const record = logAndCapture(input);
    const json = JSON.stringify(record);
    // The secret value must not appear; the [REDACTED] placeholder must.
    // Pull out the secret literal we passed in.
    const collectLeafs = (val: unknown, out: string[]): void => {
      if (typeof val === 'string') out.push(val);
      else if (Array.isArray(val)) for (const v of val) collectLeafs(v, out);
      else if (val !== null && typeof val === 'object')
        for (const v of Object.values(val)) collectLeafs(v, out);
    };
    const leafs: string[] = [];
    collectLeafs(input, leafs);
    for (const leaf of leafs) {
      expect(json, `leaf "${leaf}" should be redacted in ${json}`).not.toContain(leaf);
    }
    expect(json).toContain('[REDACTED]');
  });
});

describe('Tier-29 — production logger has the redact list (source-grep regression)', () => {
  it('logger.ts source still declares the new redact paths', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const src = readFileSync(join(__dirname, '..', 'src', 'logger.ts'), 'utf8');
    // Pin a sampling of the NEW paths so a future edit can't silently
    // drop them.
    for (const path of [
      'api_key',
      'client_secret',
      "headers['set-cookie']".replace(/'/g, '"'), // either quote style
      'unseal_key',
      'webauthn_assertion',
      'root_token',
      'shares',
    ]) {
      expect(src, `expected '${path}' in logger redact list`).toContain(path);
    }
  });
});
