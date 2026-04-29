/**
 * 2-of-3 outage-attestation quorum logic.
 *
 * Per TRUTH §B: 3 sentinel VPS (Helsinki, Tokyo, NYC) probe the Yaoundé
 * dashboard + Hetzner ingestion VPS independently. If two of three report
 * "down" within the same 5-minute window, the on-host coordinator
 * declares an outage and emits a `system.health_degraded` audit-of-audit
 * row.
 *
 * The pure function lives here so it is unit-testable without dragging
 * in the full sentinel CLI dependencies.
 */

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
