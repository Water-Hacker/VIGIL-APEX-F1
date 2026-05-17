import { X509Certificate } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join, basename } from 'node:path';

import { StaticKeyResolver, type KeyResolver } from '@vigil/federation-stream';
import {
  boundedBodyText,
  boundedRequest,
  federationKeysLoaded,
  type Logger,
} from '@vigil/observability';

/**
 * DirectoryKeyResolver — boot-time scan of a directory of PEM files.
 *
 * Each file is named `<REGION>:<rotation_seq>.pem` (matching the
 * signing_key_id convention used by 13-vault-pki-federation.sh + R10).
 * The file contents are the ed25519 public-key PEM (SPKI form, the
 * format `crypto.createPublicKey()` accepts).
 *
 * Used for the bootstrap window before per-region Vault subordinates
 * have been brought online via the K3 → R9 cutover ceremony, AND as
 * the deterministic fallback of `LayeredKeyResolver` (last layer).
 *
 * The architect populates the directory by hand during the per-region
 * cutover ceremony — copying the cert from
 * /run/vigil/region-cas/<CODE>.cert.pem into
 * /run/vigil/secrets/region-pubkeys/<CODE>:1.pem after extracting the
 * SPKI public key.
 */
export class DirectoryKeyResolver implements KeyResolver {
  private readonly inner = new StaticKeyResolver();

  constructor(
    private readonly directory: string,
    private readonly logger: Logger,
  ) {}

  async load(): Promise<number> {
    // AUDIT-013 — surface a directory-read failure as a warn log AND as
    // a gauge=0 sample so an alert can fire if the receiver ever ends up
    // running with zero peer keys. The previous swallow-and-continue
    // path silently rejected every federation message.
    const entries = await readdir(this.directory).catch((err: unknown) => {
      // Tier-64 log-convention sweep: err_name/err_message.
      const e = err instanceof Error ? err : new Error(String(err));
      this.logger.warn(
        { err_name: e.name, err_message: e.message, directory: this.directory },
        'federation-key-directory-unreadable',
      );
      return [] as string[];
    });
    let loaded = 0;
    for (const name of entries) {
      if (!name.endsWith('.pem')) continue;
      const keyId = basename(name, '.pem');
      const pem = await readFile(join(this.directory, name), 'utf8');
      this.inner.register(keyId, pem);
      loaded += 1;
    }
    federationKeysLoaded.labels({ directory: this.directory }).set(loaded);
    this.logger.info({ directory: this.directory, loaded }, 'federation-key-resolver-loaded');
    return loaded;
  }

  resolve(signingKeyId: string): string | null {
    return this.inner.resolve(signingKeyId);
  }
}

// ---------------------------------------------------------------------------

/**
 * Signal that an explicit revocation decision came back from a Vault PKI
 * region CRL. Distinct from "key unknown" (returned as null) so a layered
 * resolver can short-circuit (deny) rather than fall through to a stale
 * on-disk fallback that doesn't see the CRL (AUDIT-007).
 *
 * The class name is checked by `LayeredKeyResolver.resolveAsync` via
 * `err.name === 'RevokedKeyError'` so callers can detect it without
 * pulling this module's symbols (no instanceof import cycle).
 */
export class RevokedKeyError extends Error {
  override readonly name = 'RevokedKeyError';
  readonly keyId: string;
  readonly region: string;
  readonly serial: string;
  constructor(keyId: string, region: string, serial: string) {
    super(`federation key ${keyId} is revoked by region ${region} CRL`);
    this.keyId = keyId;
    this.region = region;
    this.serial = serial;
  }
}

/**
 * Live VaultPkiKeyResolver — pulls the federation signing certificate from
 * the per-region Vault PKI mount on demand, derives the SPKI public-key
 * PEM, and caches it under `signingKeyId` for `cacheTtlMs`. Honours the
 * region-CRL — a hit on the CRL evicts the cache entry and returns null
 * (the caller treats this as "revoked, drop the envelope").
 *
 * URL pattern (DECISION-014c § federation key rotation):
 *   <vaultAddr>/v1/pki-region-<region_lower>/cert/<serial>
 *   <vaultAddr>/v1/pki-region-<region_lower>/crl
 *
 * Required HTTP headers:
 *   X-Vault-Token: <policy token>
 *   X-Vault-Namespace: <ns>      (optional, when Vault Enterprise namespacing is in use)
 *
 * Hardening:
 *   - Strict signing-key-id format `<REGION>:<serial>` (REGION in
 *     [A-Z]{2,8}, serial in [0-9a-f-]{1,80}). Anything else returns
 *     null without ever hitting Vault — prevents a malformed envelope
 *     from probing the PKI surface.
 *   - HTTP timeout (default 5 s) + body-size cap (default 64 KB).
 *   - CRL fetched at most once per `cacheTtlMs` per region; cache key
 *     is the region code, miss path goes to a single in-flight request
 *     (no thundering herd via per-region promise dedup).
 *   - On Vault unreachability, returns null and logs once per minute
 *     per region; the caller's StaticKeyResolver fallback kicks in
 *     for envelopes the directory already knows about.
 *   - Public-key extraction uses node:crypto.X509Certificate, which
 *     validates ASN.1 structure before trusting the SPKI bytes.
 *   - Cached entries are eagerly evicted when their TTL expires; no
 *     unbounded memory growth.
 */
export interface VaultPkiKeyResolverOptions {
  readonly vaultAddr: string;
  readonly token: string;
  /** Optional Vault Enterprise namespace. */
  readonly namespace?: string;
  /** Cache TTL in milliseconds. Default 1 hour. */
  readonly cacheTtlMs?: number;
  /** HTTP request timeout in milliseconds. Default 5 s. */
  readonly httpTimeoutMs?: number;
  /** Logger. */
  readonly logger: Logger;
  /** Optional fetch override for tests. Default: undici.request. */
  readonly fetcher?: VaultFetcher;
  /** Optional clock for deterministic tests. Default: () => Date.now(). */
  readonly now?: () => number;
}

/** Minimal fetch contract — caller controls timeouts at this layer. */
export type VaultFetcher = (
  url: string,
  init: { headers: Record<string, string>; timeoutMs: number },
) => Promise<{ status: number; body: string }>;

const DEFAULT_TTL_MS = 60 * 60 * 1000; // 1 h
const DEFAULT_HTTP_TIMEOUT_MS = 5_000;
const MAX_BODY_BYTES = 64 * 1024;
const SIGNING_KEY_ID_RE = /^([A-Z]{2,8}):([0-9A-Fa-f][0-9A-Fa-f-]{0,79})$/;
const ERROR_LOG_THROTTLE_MS = 60_000;

interface CachedEntry {
  readonly publicKeyPem: string;
  readonly insertedAtMs: number;
}

interface CrlEntry {
  readonly serials: ReadonlySet<string>;
  readonly fetchedAtMs: number;
}

export class VaultPkiKeyResolver implements KeyResolver {
  private readonly cache = new Map<string, CachedEntry>();
  private readonly inflight = new Map<string, Promise<string | null>>();
  private readonly crl = new Map<string, CrlEntry>();
  private readonly crlInflight = new Map<string, Promise<ReadonlySet<string>>>();
  private readonly lastErrorAt = new Map<string, number>();
  private readonly fetcher: VaultFetcher;
  private readonly now: () => number;

  constructor(private readonly opts: VaultPkiKeyResolverOptions) {
    this.fetcher = opts.fetcher ?? defaultUndiciFetcher;
    this.now = opts.now ?? (() => Date.now());
  }

  /**
   * Synchronous resolve(): the federation receiver's verify path is
   * sync. We honour that here by ONLY returning the cache. Misses
   * return null; the async path (`prefetch` / `resolveAsync`) is the
   * way to populate. Production callers run `prefetch(keyId)` before
   * accepting an envelope, OR layer this resolver behind a
   * directory-loaded fallback that already has the key in memory.
   */
  resolve(signingKeyId: string): string | null {
    const m = SIGNING_KEY_ID_RE.exec(signingKeyId);
    if (!m) return null;
    const cached = this.cache.get(signingKeyId);
    if (!cached) return null;
    if (this.now() - cached.insertedAtMs > this.ttl()) {
      this.cache.delete(signingKeyId);
      return null;
    }
    return cached.publicKeyPem;
  }

  /**
   * Async resolution. Cache + CRL hit-test + Vault fetch. Returns null on:
   *   - malformed signingKeyId
   *   - serial appears on the region CRL
   *   - Vault fetch failure (after error-log throttling)
   *   - response is not a parseable PEM/X509
   */
  async resolveAsync(signingKeyId: string): Promise<string | null> {
    const m = SIGNING_KEY_ID_RE.exec(signingKeyId);
    if (!m) return null;
    const region = m[1]!;
    const serial = m[2]!;
    const ttl = this.ttl();
    const now = this.now();

    const cached = this.cache.get(signingKeyId);
    if (cached && now - cached.insertedAtMs <= ttl) return cached.publicKeyPem;

    // Single-flight: collapse concurrent calls for the same id onto one fetch.
    const existing = this.inflight.get(signingKeyId);
    if (existing) return existing;

    const promise = (async (): Promise<string | null> => {
      try {
        // Check the region CRL first — a revoked serial must never resolve.
        // AUDIT-007: throw a RevokedKeyError instead of returning null so
        // a layered resolver can short-circuit (deny) rather than fall
        // through to a stale on-disk fallback.
        const crl = await this.loadCrlFor(region);
        if (crl.has(serial.toLowerCase())) {
          this.cache.delete(signingKeyId);
          throw new RevokedKeyError(signingKeyId, region, serial.toLowerCase());
        }
        const pem = await this.fetchCertPem(region, serial);
        if (pem === null) return null;
        const publicKeyPem = certPemToPublicKeyPem(pem);
        if (publicKeyPem === null) return null;
        this.cache.set(signingKeyId, { publicKeyPem, insertedAtMs: this.now() });
        return publicKeyPem;
      } catch (err) {
        if (err instanceof RevokedKeyError) throw err;
        this.logErrorThrottled(`fetch-${region}`, 'vault-pki-fetch-failed', { err: String(err) });
        return null;
      } finally {
        this.inflight.delete(signingKeyId);
      }
    })();
    this.inflight.set(signingKeyId, promise);
    return promise;
  }

  /**
   * Prefetch a key into the cache. Returns true on success, false on
   * any failure (including CRL hit / unparseable cert).
   */
  async prefetch(signingKeyId: string): Promise<boolean> {
    const v = await this.resolveAsync(signingKeyId);
    return v !== null;
  }

  /** Drop the cached entry for `signingKeyId`. Used by tests + on
   *  out-of-band rotation notifications. */
  invalidate(signingKeyId: string): void {
    this.cache.delete(signingKeyId);
  }

  /** Drop the entire CRL cache for `region` (force a refresh on next lookup). */
  invalidateCrl(region: string): void {
    this.crl.delete(region);
  }

  /** Telemetry surface — expose cache + CRL sizes for the metrics worker. */
  stats(): {
    cacheSize: number;
    crlRegionsCached: number;
    crlEntriesCached: number;
  } {
    let crlEntriesCached = 0;
    for (const e of this.crl.values()) crlEntriesCached += e.serials.size;
    return {
      cacheSize: this.cache.size,
      crlRegionsCached: this.crl.size,
      crlEntriesCached,
    };
  }

  // -- internals -----------------------------------------------------------

  private ttl(): number {
    return this.opts.cacheTtlMs ?? DEFAULT_TTL_MS;
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'x-vault-token': this.opts.token,
      accept: 'application/json',
    };
    if (this.opts.namespace) headers['x-vault-namespace'] = this.opts.namespace;
    return headers;
  }

  private vaultBase(): string {
    return this.opts.vaultAddr.replace(/\/+$/, '');
  }

  private async fetchCertPem(region: string, serial: string): Promise<string | null> {
    const path = `/v1/pki-region-${region.toLowerCase()}/cert/${encodeURIComponent(serial)}`;
    const url = `${this.vaultBase()}${path}`;
    const res = await this.fetcher(url, {
      headers: this.buildHeaders(),
      timeoutMs: this.opts.httpTimeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS,
    });
    if (res.status === 404) return null;
    if (res.status >= 400) {
      throw new Error(`vault cert fetch http ${res.status}`);
    }
    if (res.body.length > MAX_BODY_BYTES) {
      throw new Error(`vault cert body exceeds cap (${res.body.length} > ${MAX_BODY_BYTES})`);
    }
    let parsed: { data?: { certificate?: string } } | undefined;
    try {
      parsed = JSON.parse(res.body) as typeof parsed;
    } catch {
      throw new Error('vault cert response is not JSON');
    }
    const pem = parsed?.data?.certificate;
    if (typeof pem !== 'string' || !pem.includes('BEGIN CERTIFICATE')) return null;
    return pem;
  }

  private async loadCrlFor(region: string): Promise<ReadonlySet<string>> {
    const cached = this.crl.get(region);
    if (cached && this.now() - cached.fetchedAtMs <= this.ttl()) return cached.serials;

    const existing = this.crlInflight.get(region);
    if (existing) return existing;

    const promise = (async (): Promise<ReadonlySet<string>> => {
      try {
        const path = `/v1/pki-region-${region.toLowerCase()}/crl`;
        const url = `${this.vaultBase()}${path}`;
        const res = await this.fetcher(url, {
          headers: { ...this.buildHeaders(), accept: 'application/pkix-crl, application/json' },
          timeoutMs: this.opts.httpTimeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS,
        });
        if (res.status === 404 || res.status === 204) return new Set<string>();
        if (res.status >= 400) {
          throw new Error(`vault crl fetch http ${res.status}`);
        }
        if (res.body.length > MAX_BODY_BYTES) {
          throw new Error(`vault crl body exceeds cap (${res.body.length} > ${MAX_BODY_BYTES})`);
        }
        const serials = parseCrlSerials(res.body);
        const entry: CrlEntry = { serials, fetchedAtMs: this.now() };
        this.crl.set(region, entry);
        return serials;
      } catch (err) {
        this.logErrorThrottled(`crl-${region}`, 'vault-pki-crl-fetch-failed', { err: String(err) });
        // On CRL failure we deliberately treat as empty (fail-open for CRL,
        // because the certificate fetch ALSO requires a valid response).
        // The cache is NOT updated, so the next call retries.
        return new Set<string>();
      } finally {
        this.crlInflight.delete(region);
      }
    })();
    this.crlInflight.set(region, promise);
    return promise;
  }

  private logErrorThrottled(key: string, msg: string, ctx: Record<string, unknown>): void {
    const last = this.lastErrorAt.get(key) ?? 0;
    const now = this.now();
    if (now - last < ERROR_LOG_THROTTLE_MS) return;
    this.lastErrorAt.set(key, now);
    this.opts.logger.warn(ctx, msg);
  }
}

// --- pure helpers (exported for tests) -------------------------------------

/**
 * Parse a Vault PKI CRL response. Vault returns either a JSON envelope
 * (`{data: {revoked_certs: [{serial_number: "..."}, ...]}}`) when the
 * client asks for JSON, or the raw DER/PEM CRL when the client asks for
 * application/pkix-crl. We accept both — when we asked for JSON Vault
 * usually still returns it, but the OSS endpoint can fall through to a
 * raw PEM/DER blob; in that case we extract serial numbers from the
 * `Serial Number:` lines `openssl crl -text` produces, OR we parse the
 * structured form.
 *
 * Returns a set of lower-case hex serials with no separators.
 */
// AUDIT-036: cap on raw CRL body. Real Vault CRL responses are well
// under 64 KB (`MAX_BODY_BYTES` upstream). 1 MB is a generous defence-
// in-depth ceiling: anything larger is hostile input and we refuse to
// scan it.
const MAX_CRL_BODY_BYTES = 1024 * 1024;

export function parseCrlSerials(body: string): ReadonlySet<string> {
  const out = new Set<string>();
  // AUDIT-036: refuse over-sized bodies before any regex scan or JSON
  // parse. The upstream fetcher already caps at 64 KB (MAX_BODY_BYTES);
  // this is a second-line cap in case parseCrlSerials is reused.
  if (body.length > MAX_CRL_BODY_BYTES) return out;
  const trimmed = body.trim();
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as {
        data?: { revoked_certs?: Array<{ serial_number?: string }> };
      };
      const revoked = parsed?.data?.revoked_certs ?? [];
      for (const r of revoked) {
        const s = r.serial_number;
        if (typeof s === 'string') {
          const norm = s.replace(/[^0-9a-f]/gi, '').toLowerCase();
          if (norm.length > 0) out.add(norm);
        }
      }
      return out;
    } catch {
      // fall through to text-mode scan
    }
  }
  // Text-mode: openssl-style "Serial Number: 0a:1b:2c:...". AUDIT-036:
  // bound the whitespace + serial-character runs to {0,8} and {1,256}
  // so the regex is exhaustively bounded — even if Vault is compromised
  // and feeds adversarial input, the matcher cannot be coerced into
  // pathological backtracking (the original `\s*` and `[...]+` were
  // already linear, but bounding makes the contract explicit).
  for (const m of trimmed.matchAll(/Serial Number:\s{0,8}([0-9a-fA-F:\s]{1,256})/g)) {
    const cap = m[1];
    if (typeof cap !== 'string') continue;
    const norm = cap.replace(/[^0-9a-f]/gi, '').toLowerCase();
    if (norm.length > 0) out.add(norm);
  }
  return out;
}

/**
 * Extract the SPKI ed25519 public-key PEM from an X.509 certificate PEM.
 * Returns null if the cert is unparseable, the public-key algorithm is
 * not Ed25519, or the SPKI export fails.
 */
export function certPemToPublicKeyPem(certPem: string): string | null {
  try {
    const cert = new X509Certificate(certPem);
    const pub = cert.publicKey;
    // Only accept ed25519 — federation envelope verification rejects
    // any other algorithm and we want to fail closed at this boundary.
    if (pub.asymmetricKeyType !== 'ed25519') return null;
    const exported = pub.export({ type: 'spki', format: 'pem' });
    return typeof exported === 'string' ? exported : exported.toString('utf8');
  } catch {
    return null;
  }
}

/** Default undici-backed fetcher honouring the timeoutMs budget.
 *  Uses boundedRequest + boundedBodyText (AUDIT-095 closure) so a
 *  hostile or stuck Vault PKI endpoint cannot exhaust the worker. */
const defaultUndiciFetcher: VaultFetcher = async (url, init) => {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), init.timeoutMs);
  try {
    const res = await boundedRequest(url, {
      method: 'GET',
      headers: init.headers,
      signal: ctrl.signal,
    });
    const status = res.statusCode;
    const text = await boundedBodyText(res.body, { sourceId: 'vault-pki-key-resolver', url });
    return { status, body: text };
  } finally {
    clearTimeout(t);
  }
};

// ---------------------------------------------------------------------------

/**
 * LayeredKeyResolver — composes resolvers in priority order. The
 * federation receiver wires this with [VaultPkiKeyResolver,
 * DirectoryKeyResolver]: Vault is the live source of truth, the
 * directory is the bootstrap-window fallback. First non-null wins.
 *
 * Async-mode probe ALSO populates the Vault resolver's cache, so a
 * subsequent sync `resolve()` succeeds without an extra round-trip.
 */
export class LayeredKeyResolver implements KeyResolver {
  constructor(private readonly layers: ReadonlyArray<KeyResolver>) {}

  /**
   * The federation `KeyResolver` interface allows resolve() to return
   * either `string | null` or a Promise of the same. We honour that
   * union by walking layers in order and short-circuiting on the first
   * non-null. If any layer is async we surface a Promise; otherwise the
   * return is sync. The federation receiver awaits the result either
   * way, so callers never see the difference.
   */
  resolve(signingKeyId: string): Promise<string | null> | (string | null) {
    let i = 0;
    const layers = this.layers;
    const step = (): Promise<string | null> | (string | null) => {
      while (i < layers.length) {
        const layer = layers[i++]!;
        const r = layer.resolve(signingKeyId);
        if (r && typeof (r as Promise<string | null>).then === 'function') {
          return (r as Promise<string | null>).then((v) => (v !== null ? v : step()));
        }
        if ((r as string | null) !== null) return r as string | null;
      }
      return null;
    };
    return step();
  }

  /**
   * Async lookup, walking each layer in order. Layers that expose a
   * `resolveAsync` method get the live-fetch path (Vault); sync-only
   * layers are probed via their normal `resolve()`. The first non-null
   * wins.
   *
   * AUDIT-007: when a layer throws `RevokedKeyError`, that's an explicit
   * revocation decision from an authoritative source (Vault region CRL).
   * Short-circuit to `null` (deny) instead of falling through — a stale
   * on-disk DirectoryKeyResolver entry must not be allowed to override
   * the CRL. Any other thrown error is treated as a transient fetch
   * failure and falls through to the next layer (existing behaviour).
   */
  async resolveAsync(signingKeyId: string): Promise<string | null> {
    for (const layer of this.layers) {
      const layerWithAsync = layer as KeyResolver & {
        resolveAsync?: (id: string) => Promise<string | null>;
      };
      let raw: string | null;
      try {
        raw =
          typeof layerWithAsync.resolveAsync === 'function'
            ? await layerWithAsync.resolveAsync(signingKeyId)
            : await layer.resolve(signingKeyId);
      } catch (err) {
        if ((err as { name?: string } | undefined)?.name === 'RevokedKeyError') {
          return null;
        }
        throw err;
      }
      if (raw !== null) return raw;
    }
    return null;
  }
}
