/**
 * 2-of-3 outage-attestation quorum logic + orchestration.
 *
 * Per TRUTH §B: 3 sentinel VPS (Helsinki, Tokyo, NYC) probe the Yaoundé
 * dashboard + Hetzner ingestion VPS independently. If two of three report
 * "down" within the same 5-minute window, the on-host coordinator
 * declares an outage and emits a `system.health_degraded` audit-of-audit
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

function httpJson<T>(opts: RequestOptions, body?: string): Promise<{ status: number; body: T }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(opts, (res) => {
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

export async function probeSentinel(
  endpoint: SentinelEndpoint,
  target: string,
): Promise<SentinelReport> {
  try {
    const u = new URL(`/probe?target=${encodeURIComponent(target)}`, endpoint.url);
    const { status, body } = await httpJson<{ outcome: SentinelOutcome }>({
      hostname: u.hostname,
      port: u.port || 80,
      path: `${u.pathname}${u.search}`,
      method: 'GET',
    });
    if (
      status !== 200 ||
      !body ||
      (body.outcome !== 'up' && body.outcome !== 'down' && body.outcome !== 'unknown')
    ) {
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
  } catch {
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
    action: 'system.health_degraded',
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
 * `system.health_degraded` audit-of-audit row to the audit-bridge UDS.
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
