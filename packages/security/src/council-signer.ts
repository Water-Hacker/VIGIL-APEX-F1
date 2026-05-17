import { createConnection, type Socket } from 'node:net';
import { setTimeout as wait } from 'node:timers/promises';

/**
 * Node-side client for the local `vigil-council-signer` service.
 *
 * W-10 partial closure: the dashboard's council-vote flow prefers
 * the native helper when present, else falls back to WebAuthn (see
 * `fido.ts`). This module is the boundary that decides "do we have
 * a native signer available for this user?".
 *
 * The service listens on a per-user Unix socket at
 * `$XDG_RUNTIME_DIR/vigil/council-signer.sock` (mode 0600). The
 * dashboard server-component reaches it through a localhost-only
 * Tauri/Electron bridge — never directly from the browser (the
 * socket is on the council member's workstation, not on the
 * dashboard host).
 *
 * Wire protocol:
 *
 *   → {"method":"get_pubkey","params":{}}\n
 *   ← {"ok":true,"result":"04…(130 hex chars)"}\n
 *
 *   → {"method":"sign","params":{"hash":"<64 hex chars>"}}\n
 *   ← {"ok":true,"result":{"r":"<64 hex>","s":"<64 hex>"}}\n
 *
 * Errors:
 *   ← {"ok":false,"error":"<msg>"}\n
 *
 * Pure NDJSON: one line in, one line out per request.
 */

const DEFAULT_TIMEOUT_MS = 90_000; // Council vote signing requires a physical touch; 90 s is the operator-friendly upper bound.
const HEX_RE = /^[0-9a-fA-F]+$/;

export interface CouncilSignerOptions {
  /** Absolute path to the per-user Unix socket. */
  readonly socketPath: string;
  /** Per-request timeout. Default 90 s (touch + helper latency). */
  readonly timeoutMs?: number;
}

export interface CouncilSignature {
  /** 64-hex r scalar. */
  readonly r: string;
  /** 64-hex s scalar (low-S normalised by the helper). */
  readonly s: string;
}

export class CouncilSignerUnavailableError extends Error {
  override readonly name = 'CouncilSignerUnavailableError';
  readonly socketPath: string;
  constructor(socketPath: string, cause: unknown) {
    super(`council-signer socket unavailable at ${socketPath}: ${String(cause)}`);
    this.socketPath = socketPath;
  }
}

export class CouncilSignerProtocolError extends Error {
  override readonly name = 'CouncilSignerProtocolError';
  constructor(message: string) {
    super(message);
  }
}

/**
 * Fire one NDJSON request, await one line back, hang up. The socket
 * is per-request rather than per-session because (1) requests are
 * rare (one per council vote), and (2) the helper validates state
 * fresh on every call — no session affinity to preserve.
 */
async function callOnce(
  opts: CouncilSignerOptions,
  request: { method: string; params: Record<string, unknown> },
): Promise<unknown> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return new Promise((resolve, reject) => {
    let sock: Socket | null = null;
    const timer = setTimeout(() => {
      sock?.destroy(new Error('timeout'));
      reject(new CouncilSignerProtocolError(`council-signer call timed out after ${timeoutMs} ms`));
    }, timeoutMs);

    try {
      sock = createConnection({ path: opts.socketPath });
    } catch (e) {
      clearTimeout(timer);
      reject(new CouncilSignerUnavailableError(opts.socketPath, e));
      return;
    }

    const chunks: Buffer[] = [];

    sock.once('error', (e) => {
      clearTimeout(timer);
      reject(new CouncilSignerUnavailableError(opts.socketPath, e));
    });

    sock.once('connect', () => {
      const line = JSON.stringify(request) + '\n';
      sock!.write(line);
    });

    sock.on('data', (buf) => {
      chunks.push(buf);
      // Look for the first newline — one request, one response line.
      const joined = Buffer.concat(chunks).toString('utf8');
      const nl = joined.indexOf('\n');
      if (nl < 0) return;
      const lineStr = joined.slice(0, nl);
      sock!.end();
      clearTimeout(timer);
      try {
        const obj = JSON.parse(lineStr) as { ok: boolean; result?: unknown; error?: string };
        if (!obj.ok) {
          reject(new CouncilSignerProtocolError(obj.error ?? 'helper reported failure'));
          return;
        }
        resolve(obj.result);
      } catch (e) {
        reject(new CouncilSignerProtocolError(`malformed JSON response: ${String(e)}`));
      }
    });

    sock.on('close', () => {
      // Either we already resolved/rejected via 'data' or 'error',
      // or the helper closed without sending a complete line.
      clearTimeout(timer);
      if (chunks.length === 0 || !Buffer.concat(chunks).toString('utf8').includes('\n')) {
        reject(new CouncilSignerProtocolError('helper closed connection without responding'));
      }
    });
  });
}

/**
 * Probe — is the local council-signer service reachable?
 *
 * The dashboard calls this at the start of the council-vote flow to
 * decide whether to enable the "Sign with YubiKey (native)" button
 * or fall straight to the WebAuthn fallback. Returns true iff a
 * `get_pubkey` round-trip succeeds within `timeoutMs` (default 1 s).
 *
 * NEVER throws — a missing service is the expected normal case for
 * users on the WebAuthn fallback path.
 */
export async function isCouncilSignerAvailable(
  socketPath: string,
  timeoutMs = 1_000,
): Promise<boolean> {
  try {
    await callOnce({ socketPath, timeoutMs }, { method: 'get_pubkey', params: {} });
    return true;
  } catch {
    return false;
  }
}

/**
 * Fetch the council member's public key (130 hex chars,
 * uncompressed P-256 point). Throws on unavailable / malformed.
 */
export async function getCouncilPubkey(opts: CouncilSignerOptions): Promise<string> {
  const result = await callOnce(opts, { method: 'get_pubkey', params: {} });
  if (typeof result !== 'string' || result.length !== 130 || !result.startsWith('04')) {
    throw new CouncilSignerProtocolError(
      `expected 130-char 0x04-prefixed pubkey hex; got ${typeof result === 'string' ? `${result.length} chars` : typeof result}`,
    );
  }
  if (!HEX_RE.test(result)) {
    throw new CouncilSignerProtocolError('pubkey response contains non-hex characters');
  }
  return result;
}

/**
 * Sign a 32-byte SHA-256 challenge digest. Triggers a YubiKey touch
 * on the council member's workstation. Returns the (r, s) scalar
 * pair as 64-hex strings each (low-S normalised by the helper).
 */
export async function signCouncilChallenge(
  opts: CouncilSignerOptions,
  challengeHashHex: string,
): Promise<CouncilSignature> {
  if (challengeHashHex.length !== 64 || !HEX_RE.test(challengeHashHex)) {
    throw new CouncilSignerProtocolError(
      'challengeHashHex must be 64 hex chars (32-byte SHA-256 digest)',
    );
  }
  const result = await callOnce(opts, {
    method: 'sign',
    params: { hash: challengeHashHex },
  });
  if (
    typeof result !== 'object' ||
    result === null ||
    typeof (result as { r?: unknown }).r !== 'string' ||
    typeof (result as { s?: unknown }).s !== 'string'
  ) {
    throw new CouncilSignerProtocolError(
      `expected {r,s} object response; got ${typeof result === 'object' ? JSON.stringify(result) : typeof result}`,
    );
  }
  const r = (result as { r: string }).r;
  const s = (result as { s: string }).s;
  if (r.length !== 64 || s.length !== 64 || !HEX_RE.test(r) || !HEX_RE.test(s)) {
    throw new CouncilSignerProtocolError(`r or s is not a 64-hex string`);
  }
  return { r, s };
}

/**
 * Default per-user socket path. Mirrors the helper's compiled-in
 * default — both must agree or the bridge cannot find the service.
 */
export function defaultCouncilSignerSocketPath(): string {
  const xdg = process.env['XDG_RUNTIME_DIR'] ?? '/tmp';
  return `${xdg}/vigil/council-signer.sock`;
}

/**
 * Exported for the integration test harness — exercises the
 * timeout + reconnect path without needing a live socket. Production
 * callers should use the higher-level helpers above.
 */
export const __internal = { callOnce, wait };
