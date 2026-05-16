/**
 * 2-of-3 outage-attestation quorum logic + orchestration.
 *
 * Per TRUTH §B: 3 sentinel VPS (Helsinki, Tokyo, NYC) probe the Yaoundé
 * dashboard + Hetzner ingestion VPS independently. If two of three report
 * "down" within the same 5-minute window, the on-host coordinator
 * declares an outage and emits a `sentinel.quorum_outage` audit-of-audit
 * row.
 *
 * The pure `quorumDecide` lives here with the orchestration helpers
 * (`probeSentinel`, `emitOutageAuditRow`, `runSentinelQuorum`) so the
 * integration test under `__tests__/sentinel-quorum-integration.test.ts`
 * can drive them against real localhost mocks. The CLI shim under
 * `scripts/sentinel-quorum.ts` re-exports them.
 *
 * Implementation note: HTTP and UDS paths use node's built-in `http`
 * module (which natively supports `socketPath`) rather than undici — the
 * observability package does not list undici as a dependency, and adding
 * one for a single UDS POST would be unnecessary weight.
 */

import { request as httpRequest, type RequestOptions } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { URL } from 'node:url';

export type SentinelOutcome = 'up' | 'down' | 'unknown';

export interface SentinelReport {
  readonly site: 'helsinki' | 'tokyo' | 'nyc';
  readonly target: string;
  readonly outcome: SentinelOutcome;
  readonly observed_at: string;
}

export interface QuorumDecision {
  readonly decision: 'up' | 'down' | 'inconclusive';
  readonly up: number;
  readonly down: number;
  readonly unknown: number;
  readonly attesting_sites: readonly string[];
}

export interface SentinelEndpoint {
  readonly site: 'helsinki' | 'tokyo' | 'nyc';
  readonly url: string;
}

/**
 * Reduce sentinel reports for a single target into a 2-of-3 quorum decision.
 * - 2+ sites report `down` ⇒ `down` (with attesting_sites = those sites).
 * - 2+ sites report `up`   ⇒ `up`   (with attesting_sites = those sites).
 * - Otherwise (1+ unknown, mixed)  ⇒ `inconclusive`.
 */
export function quorumDecide(reports: ReadonlyArray<SentinelReport>): QuorumDecision {
  const up = reports.filter((r) => r.outcome === 'up').length;
  const down = reports.filter((r) => r.outcome === 'down').length;
  const unknown = reports.filter((r) => r.outcome === 'unknown').length;
  if (down >= 2) {
    return {
      decision: 'down',
      up,
      down,
      unknown,
      attesting_sites: reports.filter((r) => r.outcome === 'down').map((r) => r.site),
    };
  }
  if (up >= 2) {
    return {
      decision: 'up',
      up,
      down,
      unknown,
      attesting_sites: reports.filter((r) => r.outcome === 'up').map((r) => r.site),
    };
  }
  return { decision: 'inconclusive', up, down, unknown, attesting_sites: [] };
}

/**
 * Tier-3 audit hardening: pick http vs https module based on the
 * `protocol` field in opts. The prior version always used `http`, so
 * any https:// sentinel URL silently failed (wrong-protocol on port
 * 443) and the probe became a permanent "unknown" — undermining the
 * 2-of-3 quorum that the whole TAL-PA "watcher is watched" doctrine
 * rests on. UDS calls (socketPath) keep using http (Unix sockets are
 * scheme-agnostic at the wire level; the audit-bridge speaks plain
 * HTTP on its UDS).
 */
function httpJson<T>(opts: RequestOptions, body?: string): Promise<{ status: number; body: T }> {
  const useHttps = opts.protocol === 'https:';
  const requestFn = useHttps ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const req = requestFn(opts, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        try {
          const parsed = raw ? (JSON.parse(raw) as T) : ({} as T);
          resolve({ status: res.statusCode ?? 0, body: parsed });
        } catch {
          resolve({ status: res.statusCode ?? 0, body: { _raw: raw } as unknown as T });
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(10_000, () => req.destroy(new Error('sentinel-quorum http timeout')));
    if (body !== undefined) req.write(body);
    req.end();
  });
}

/**
 * Optional sink for probe-error observability. Tier-3 audit: pre-fix
 * the catch block swallowed all errors with no log; a permanently-down
 * sentinel (DNS broken, cert expired, firewall) just became "unknown"
 * forever and the operator had no signal. An injectable error-sink
 * lets callers (e.g. scripts/sentinel-quorum.ts) wire pino without
 * making this module depend on a logger implementation.
 */
export interface ProbeErrorSink {
  onProbeError(site: SentinelEndpoint['site'], target: string, err: Error): void;
  onProbeUnexpectedResponse(
    site: SentinelEndpoint['site'],
    target: string,
    status: number,
    bodyOutcome: unknown,
  ): void;
}

let probeErrorSink: ProbeErrorSink = {
  onProbeError(site, target, err) {
    // eslint-disable-next-line no-console
    console.error(
      `sentinel-quorum: probe ${site} → ${target} failed (${err.name}: ${err.message})`,
    );
  },
  onProbeUnexpectedResponse(site, target, status, bodyOutcome) {
    // eslint-disable-next-line no-console
    console.warn(
      `sentinel-quorum: probe ${site} → ${target} returned status=${status} outcome=${JSON.stringify(bodyOutcome)}`,
    );
  },
};

/** Inject a structured sink. Call once at boot from scripts/sentinel-quorum.ts. */
export function setProbeErrorSink(sink: ProbeErrorSink): void {
  probeErrorSink = sink;
}

export async function probeSentinel(
  endpoint: SentinelEndpoint,
  target: string,
): Promise<SentinelReport> {
  try {
    const u = new URL(`/probe?target=${encodeURIComponent(target)}`, endpoint.url);
    const useHttps = u.protocol === 'https:';
    const { status, body } = await httpJson<{ outcome: SentinelOutcome }>({
      protocol: u.protocol,
      hostname: u.hostname,
      port: u.port || (useHttps ? 443 : 80),
      path: `${u.pathname}${u.search}`,
      method: 'GET',
    });
    if (
      status !== 200 ||
      !body ||
      (body.outcome !== 'up' && body.outcome !== 'down' && body.outcome !== 'unknown')
    ) {
      probeErrorSink.onProbeUnexpectedResponse(endpoint.site, target, status, body?.outcome);
      return {
        site: endpoint.site,
        target,
        outcome: 'unknown',
        observed_at: new Date().toISOString(),
      };
    }
    return {
      site: endpoint.site,
      target,
      outcome: body.outcome,
      observed_at: new Date().toISOString(),
    };
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    probeErrorSink.onProbeError(endpoint.site, target, err);
    return {
      site: endpoint.site,
      target,
      outcome: 'unknown',
      observed_at: new Date().toISOString(),
    };
  }
}

export async function emitOutageAuditRow(
  decision: QuorumDecision,
  target: string,
  socketPath: string = process.env.AUDIT_BRIDGE_SOCKET ?? '/run/vigil/audit-bridge.sock',
): Promise<void> {
  const payload = JSON.stringify({
    action: 'sentinel.quorum_outage',
    actor: 'system:sentinel-quorum',
    subject_kind: 'system',
    subject_id: target,
    payload: {
      decision: decision.decision,
      up: decision.up,
      down: decision.down,
      unknown: decision.unknown,
      attesting_sites: decision.attesting_sites,
    },
  });
  try {
    const { status } = await httpJson<unknown>(
      {
        socketPath,
        path: '/append',
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(payload, 'utf8'),
        },
      },
      payload,
    );
    if (status >= 400) {
      // eslint-disable-next-line no-console
      console.error(`audit-bridge POST returned ${status}`);
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('audit-bridge unreachable:', e);
  }
}

export interface RunSentinelQuorumOptions {
  readonly endpoints: ReadonlyArray<SentinelEndpoint>;
  readonly target: string;
  readonly auditSocketPath?: string;
  readonly probe?: (e: SentinelEndpoint, t: string) => Promise<SentinelReport>;
  readonly emit?: (d: QuorumDecision, t: string, sock: string) => Promise<void>;
}

export interface RunSentinelQuorumResult {
  readonly target: string;
  readonly decision: QuorumDecision;
  readonly emitted: boolean;
}

/**
 * Probe each endpoint, reduce to a 2-of-3 quorum, and (if `down`) emit a
 * `sentinel.quorum_outage` audit-of-audit row to the audit-bridge UDS.
 *
 * Dependencies are injectable so the integration test can run against
 * localhost mocks without touching the production audit-bridge socket.
 */
export async function runSentinelQuorum(
  opts: RunSentinelQuorumOptions,
): Promise<RunSentinelQuorumResult> {
  const probe = opts.probe ?? probeSentinel;
  const emit = opts.emit ?? emitOutageAuditRow;
  const sock =
    opts.auditSocketPath ?? process.env.AUDIT_BRIDGE_SOCKET ?? '/run/vigil/audit-bridge.sock';
  const reports = await Promise.all(opts.endpoints.map((e) => probe(e, opts.target)));
  const decision = quorumDecide(reports);
  let emitted = false;
  if (decision.decision === 'down') {
    await emit(decision, opts.target, sock);
    emitted = true;
  }
  return { target: opts.target, decision, emitted };
}
