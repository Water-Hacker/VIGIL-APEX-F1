/**
 * council-signer bridge — Unix-socket round-trip tests.
 *
 * Spins up an in-process Unix-socket server that mimics the
 * NDJSON contract the real Rust helper / Python wrapper expose.
 * Verifies the dashboard's bridge handles every documented branch:
 * unavailable socket, valid get_pubkey, valid sign, helper error
 * envelope, malformed JSON, malformed pubkey shape, timeout, hex
 * validation.
 *
 * Hardware tests against a real YubiKey live in
 * tools/vigil-council-signer/rust-helper/tests/ — those are gated
 * on YUBIKEY_PRESENT=1 in CI.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  CouncilSignerProtocolError,
  CouncilSignerUnavailableError,
  defaultCouncilSignerSocketPath,
  getCouncilPubkey,
  isCouncilSignerAvailable,
  signCouncilChallenge,
} from '../src/council-signer.js';

interface MockBehaviour {
  readonly pubkey?: string;
  readonly sign?: { r: string; s: string } | { error: string };
  readonly raw?: string; // override the response body entirely
  readonly hang?: boolean; // accept but never reply
}

function makeServer(behaviour: MockBehaviour): {
  server: Server;
  socketPath: string;
  close: () => Promise<void>;
} {
  const dir = mkdtempSync(join(tmpdir(), 'council-signer-test-'));
  const socketPath = join(dir, 'sock');
  const server = createServer((sock) => {
    let buf = '';
    sock.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      const nl = buf.indexOf('\n');
      if (nl < 0) return;
      if (behaviour.hang) return;
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);

      if (behaviour.raw !== undefined) {
        sock.write(behaviour.raw + '\n');
        sock.end();
        return;
      }

      let req: { method?: string; params?: { hash?: string } };
      try {
        req = JSON.parse(line) as { method?: string; params?: { hash?: string } };
      } catch {
        sock.write(JSON.stringify({ ok: false, error: 'parse' }) + '\n');
        sock.end();
        return;
      }

      if (req.method === 'get_pubkey') {
        sock.write(JSON.stringify({ ok: true, result: behaviour.pubkey }) + '\n');
        sock.end();
        return;
      }
      if (req.method === 'sign') {
        if (behaviour.sign && 'error' in behaviour.sign) {
          sock.write(JSON.stringify({ ok: false, error: behaviour.sign.error }) + '\n');
        } else if (behaviour.sign) {
          sock.write(JSON.stringify({ ok: true, result: behaviour.sign }) + '\n');
        } else {
          sock.write(JSON.stringify({ ok: false, error: 'no sign behaviour configured' }) + '\n');
        }
        sock.end();
        return;
      }
      sock.write(JSON.stringify({ ok: false, error: `unknown method ${req.method}` }) + '\n');
      sock.end();
    });
  });

  const closed = new Promise<void>((resolve, reject) => {
    server.listen(socketPath, () => resolve());
    server.once('error', reject);
  });
  // Block synchronously until listen is ready — the test's
  // first call would race the listen otherwise.
  void closed;

  return {
    server,
    socketPath,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          try {
            rmSync(dir, { recursive: true, force: true });
          } catch {
            // ignore
          }
          resolve();
        });
      }),
  };
}

// All tests await listen via a small helper to keep the harness
// synchronous-looking.
async function setup(
  behaviour: MockBehaviour,
): Promise<{ socketPath: string; close: () => Promise<void> }> {
  const { server, socketPath, close } = makeServer(behaviour);
  await new Promise<void>((resolve, reject) => {
    if (server.listening) {
      resolve();
      return;
    }
    server.once('listening', () => resolve());
    server.once('error', reject);
  });
  return { socketPath, close };
}

const VALID_PUBKEY = '04' + 'a'.repeat(64) + 'b'.repeat(64);
const VALID_R = '1'.repeat(64);
const VALID_S = '2'.repeat(64);
const VALID_CHALLENGE = '0'.repeat(64);

describe('isCouncilSignerAvailable', () => {
  it('returns true when a valid pubkey round-trip succeeds', async () => {
    const { socketPath, close } = await setup({ pubkey: VALID_PUBKEY });
    try {
      const ok = await isCouncilSignerAvailable(socketPath, 2_000);
      expect(ok).toBe(true);
    } finally {
      await close();
    }
  });

  it('returns false when the socket does not exist', async () => {
    const ok = await isCouncilSignerAvailable('/nonexistent/socket/path', 500);
    expect(ok).toBe(false);
  });

  it('returns false when the helper responds with an error envelope', async () => {
    const { socketPath, close } = await setup({
      raw: JSON.stringify({ ok: false, error: 'broken' }),
    });
    try {
      const ok = await isCouncilSignerAvailable(socketPath, 2_000);
      expect(ok).toBe(false);
    } finally {
      await close();
    }
  });
});

describe('getCouncilPubkey', () => {
  it('returns the 130-char hex pubkey on success', async () => {
    const { socketPath, close } = await setup({ pubkey: VALID_PUBKEY });
    try {
      const k = await getCouncilPubkey({ socketPath, timeoutMs: 2_000 });
      expect(k).toBe(VALID_PUBKEY);
    } finally {
      await close();
    }
  });

  it('throws ProtocolError on a wrong-length pubkey response', async () => {
    const { socketPath, close } = await setup({ pubkey: '04abcd' });
    try {
      await expect(getCouncilPubkey({ socketPath, timeoutMs: 2_000 })).rejects.toBeInstanceOf(
        CouncilSignerProtocolError,
      );
    } finally {
      await close();
    }
  });

  it('throws ProtocolError on a non-hex pubkey response', async () => {
    const bad = '04' + 'z'.repeat(128);
    const { socketPath, close } = await setup({ pubkey: bad });
    try {
      await expect(getCouncilPubkey({ socketPath, timeoutMs: 2_000 })).rejects.toThrow(/non-hex/);
    } finally {
      await close();
    }
  });

  it('throws ProtocolError on a non-0x04-prefix pubkey response', async () => {
    const bad = '02' + 'a'.repeat(128);
    const { socketPath, close } = await setup({ pubkey: bad });
    try {
      await expect(getCouncilPubkey({ socketPath, timeoutMs: 2_000 })).rejects.toThrow(
        /expected 130-char 0x04-prefixed/,
      );
    } finally {
      await close();
    }
  });

  it('throws UnavailableError when the socket is missing', async () => {
    await expect(
      getCouncilPubkey({ socketPath: '/nonexistent/socket', timeoutMs: 500 }),
    ).rejects.toBeInstanceOf(CouncilSignerUnavailableError);
  });
});

describe('signCouncilChallenge', () => {
  it('returns {r, s} on success', async () => {
    const { socketPath, close } = await setup({
      sign: { r: VALID_R, s: VALID_S },
    });
    try {
      const sig = await signCouncilChallenge({ socketPath, timeoutMs: 2_000 }, VALID_CHALLENGE);
      expect(sig.r).toBe(VALID_R);
      expect(sig.s).toBe(VALID_S);
    } finally {
      await close();
    }
  });

  it('refuses a wrong-length challenge before reaching the socket', async () => {
    await expect(
      signCouncilChallenge({ socketPath: '/nonexistent', timeoutMs: 100 }, 'abc'),
    ).rejects.toThrow(/64 hex chars/);
  });

  it('refuses a non-hex challenge before reaching the socket', async () => {
    await expect(
      signCouncilChallenge({ socketPath: '/nonexistent', timeoutMs: 100 }, 'z'.repeat(64)),
    ).rejects.toThrow(/64 hex chars/);
  });

  it('throws ProtocolError on a helper error envelope', async () => {
    const { socketPath, close } = await setup({
      sign: { error: 'YubiKey touch timeout' },
    });
    try {
      await expect(
        signCouncilChallenge({ socketPath, timeoutMs: 2_000 }, VALID_CHALLENGE),
      ).rejects.toThrow(/YubiKey touch timeout/);
    } finally {
      await close();
    }
  });

  it('throws ProtocolError on a malformed sign result (missing r)', async () => {
    const { socketPath, close } = await setup({
      raw: JSON.stringify({ ok: true, result: { s: VALID_S } }),
    });
    try {
      await expect(
        signCouncilChallenge({ socketPath, timeoutMs: 2_000 }, VALID_CHALLENGE),
      ).rejects.toThrow(/\{r,s\}/);
    } finally {
      await close();
    }
  });

  it('throws ProtocolError on a wrong-length r in the sign result', async () => {
    const { socketPath, close } = await setup({
      sign: { r: 'abc', s: VALID_S },
    });
    try {
      await expect(
        signCouncilChallenge({ socketPath, timeoutMs: 2_000 }, VALID_CHALLENGE),
      ).rejects.toThrow(/64-hex/);
    } finally {
      await close();
    }
  });

  it('honours the per-call timeout', async () => {
    const { socketPath, close } = await setup({ hang: true });
    try {
      await expect(
        signCouncilChallenge({ socketPath, timeoutMs: 150 }, VALID_CHALLENGE),
      ).rejects.toThrow(/timed out/);
    } finally {
      await close();
    }
  });
});

describe('defaultCouncilSignerSocketPath', () => {
  const originalXdg = process.env['XDG_RUNTIME_DIR'];
  beforeEach(() => {
    delete process.env['XDG_RUNTIME_DIR'];
  });
  afterEach(() => {
    if (originalXdg === undefined) delete process.env['XDG_RUNTIME_DIR'];
    else process.env['XDG_RUNTIME_DIR'] = originalXdg;
  });

  it('falls back to /tmp/vigil/council-signer.sock when XDG_RUNTIME_DIR is unset', () => {
    expect(defaultCouncilSignerSocketPath()).toBe('/tmp/vigil/council-signer.sock');
  });

  it('uses XDG_RUNTIME_DIR when present', () => {
    process.env['XDG_RUNTIME_DIR'] = '/run/user/1000';
    expect(defaultCouncilSignerSocketPath()).toBe('/run/user/1000/vigil/council-signer.sock');
  });
});
