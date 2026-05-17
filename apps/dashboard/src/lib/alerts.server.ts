import 'server-only';

import { AnomalyAlertRepo, getDb } from '@vigil/db-postgres';
import { type Schemas } from '@vigil/shared';
import { sql } from 'drizzle-orm';

/**
 * Server-side data layer for the /alerts operator surface.
 *
 * The page surfaces rows from `audit.anomaly_alert`, written by
 * worker-audit-watch (see DECISION-012 §"Anomaly Detection on the
 * Audit Log Itself") when one of the deterministic anomaly rules
 * (fishing-query, after-hours-dossier-access, etc.) fires against a
 * rolling window of TAL-PA user-action events.
 *
 * `AlertRow` doubles as the JSON event the `/api/alerts/stream`
 * route emits when new rows appear. Keeps the client island schema-
 * aligned with the initial server render.
 *
 * Two ways the page populates:
 *
 *   1. Initial render: `listAlerts({ states, sinceIso, limit })`
 *      reads the most recent rows from Postgres on each request.
 *   2. Live updates: client island opens an EventSource to
 *      `/api/alerts/stream`, which polls every `STREAM_POLL_MS`
 *      (default 5 s) and emits any row whose `detected_at >
 *      lastSeen`.
 *
 * The acknowledge / dismiss actions go through
 * `/api/alerts/[id]/acknowledge` and emit a TAL-PA `status.changed`
 * event BEFORE mutating the row, so the audit chain captures every
 * operator-driven state change (no "dark periods" per TAL-PA
 * doctrine).
 *
 * UI-only mode (`VIGIL_UI_ONLY=1`) returns a synthetic, deterministic
 * set covering every severity bucket and every operational state so
 * reviewers exercise the surface without a live Postgres.
 */

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

export type AlertSeverity = 'info' | 'low' | 'medium' | 'high' | 'critical';
export type AlertState = 'open' | 'acknowledged' | 'dismissed' | 'promoted_to_finding';

export const ALL_SEVERITIES: ReadonlyArray<AlertSeverity> = [
  'info',
  'low',
  'medium',
  'high',
  'critical',
];
export const ALL_STATES: ReadonlyArray<AlertState> = [
  'open',
  'acknowledged',
  'dismissed',
  'promoted_to_finding',
];

export interface AlertRow {
  readonly id: string;
  readonly kind: Schemas.AnomalyKind;
  readonly actor_id: string;
  readonly summary_fr: string;
  readonly summary_en: string;
  readonly severity: AlertSeverity;
  readonly rule_version: string;
  readonly triggering_event_count: number;
  readonly window_start: string;
  readonly window_end: string;
  readonly detected_at: string;
  readonly state: AlertState;
}

export interface ListAlertsOpts {
  readonly states?: ReadonlyArray<AlertState>;
  readonly severities?: ReadonlyArray<AlertSeverity>;
  readonly sinceIso?: string;
  readonly limit?: number;
}

export interface AlertCounts {
  readonly open: number;
  readonly acknowledged: number;
  readonly dismissed: number;
  readonly promoted: number;
  readonly bySeverity: Readonly<Record<AlertSeverity, number>>;
}

/**
 * Read alerts from `audit.anomaly_alert`, ordered newest-first.
 * Filters compose with AND. The default `limit` of 100 is safe for
 * the operator UI; raising it past `MAX_LIMIT` is silently capped.
 *
 * `sinceIso` is the SSE-cursor primitive: pass the previous max
 * `detected_at` to get only NEW rows. Polling at 5 s + this filter
 * keeps the round-trip O(new-alerts), not O(table).
 */
export async function listAlerts(opts: ListAlertsOpts = {}): Promise<ReadonlyArray<AlertRow>> {
  const limit = Math.min(opts.limit ?? DEFAULT_LIMIT, MAX_LIMIT);

  if (process.env.VIGIL_UI_ONLY === '1') {
    return filterSynth(SYNTH_ALERTS, opts).slice(0, limit);
  }

  // Validate filter values BEFORE building SQL — the values flow into
  // a parameterised query already, but we still want a typed
  // error rather than a Postgres CHECK violation at execution time.
  if (opts.states) {
    for (const s of opts.states) {
      if (!ALL_STATES.includes(s)) throw new Error(`unknown alert state '${s}'`);
    }
  }
  if (opts.severities) {
    for (const s of opts.severities) {
      if (!ALL_SEVERITIES.includes(s)) throw new Error(`unknown alert severity '${s}'`);
    }
  }

  const db = await getDb();
  const where: ReturnType<typeof sql>[] = [];
  if (opts.states && opts.states.length > 0) {
    where.push(
      sql`state = ANY(${sql`ARRAY[${sql.join(
        opts.states.map((s) => sql`${s}`),
        sql`, `,
      )}]::text[]`})`,
    );
  }
  if (opts.severities && opts.severities.length > 0) {
    where.push(
      sql`severity = ANY(${sql`ARRAY[${sql.join(
        opts.severities.map((s) => sql`${s}`),
        sql`, `,
      )}]::text[]`})`,
    );
  }
  if (opts.sinceIso) {
    where.push(sql`detected_at > ${opts.sinceIso}::timestamptz`);
  }
  const whereClause = where.length > 0 ? sql`WHERE ${sql.join(where, sql` AND `)}` : sql``;

  const r = await db.execute(sql`
    SELECT id::text,
           kind,
           actor_id,
           summary_fr,
           summary_en,
           severity,
           rule_version,
           COALESCE(array_length(triggering_event_ids, 1), 0)::int AS triggering_event_count,
           window_start::text,
           window_end::text,
           detected_at::text,
           state
      FROM audit.anomaly_alert
     ${whereClause}
     ORDER BY detected_at DESC
     LIMIT ${limit}
  `);

  return r.rows.map((row) => ({
    id: String(row['id']),
    kind: String(row['kind']) as Schemas.AnomalyKind,
    actor_id: String(row['actor_id']),
    summary_fr: String(row['summary_fr']),
    summary_en: String(row['summary_en']),
    severity: String(row['severity']) as AlertSeverity,
    rule_version: String(row['rule_version']),
    triggering_event_count: Number(row['triggering_event_count']),
    window_start: String(row['window_start']),
    window_end: String(row['window_end']),
    detected_at: String(row['detected_at']),
    state: String(row['state']) as AlertState,
  }));
}

/**
 * Counts for the page summary header — single round trip via GROUP BY.
 */
export async function countAlerts(): Promise<AlertCounts> {
  if (process.env.VIGIL_UI_ONLY === '1') {
    return countsFromRows(SYNTH_ALERTS);
  }
  const db = await getDb();
  const r = await db.execute(sql`
    SELECT state, severity, COUNT(*)::int AS n
      FROM audit.anomaly_alert
     GROUP BY state, severity
  `);
  return countsFromTuples(
    r.rows.map((row) => ({
      state: String(row['state']) as AlertState,
      severity: String(row['severity']) as AlertSeverity,
      n: Number(row['n'] ?? 0),
    })),
  );
}

/**
 * Fetch a single alert by id — used by the acknowledge route to
 * verify existence and pull state info into the audit-action payload.
 */
export async function getAlertById(id: string): Promise<AlertRow | null> {
  if (process.env.VIGIL_UI_ONLY === '1') {
    return SYNTH_ALERTS.find((a) => a.id === id) ?? null;
  }
  const db = await getDb();
  const r = await db.execute(sql`
    SELECT id::text,
           kind,
           actor_id,
           summary_fr,
           summary_en,
           severity,
           rule_version,
           COALESCE(array_length(triggering_event_ids, 1), 0)::int AS triggering_event_count,
           window_start::text,
           window_end::text,
           detected_at::text,
           state
      FROM audit.anomaly_alert
     WHERE id = ${id}::uuid
     LIMIT 1
  `);
  const row = r.rows[0];
  if (!row) return null;
  return {
    id: String(row['id']),
    kind: String(row['kind']) as Schemas.AnomalyKind,
    actor_id: String(row['actor_id']),
    summary_fr: String(row['summary_fr']),
    summary_en: String(row['summary_en']),
    severity: String(row['severity']) as AlertSeverity,
    rule_version: String(row['rule_version']),
    triggering_event_count: Number(row['triggering_event_count']),
    window_start: String(row['window_start']),
    window_end: String(row['window_end']),
    detected_at: String(row['detected_at']),
    state: String(row['state']) as AlertState,
  };
}

/**
 * Transition an alert to a new state. Returns the row as it stands
 * after the update so the caller can echo it back in the audit
 * payload AND in the HTTP response.
 *
 * Throws `AlertNotFoundError` if the alert does not exist OR
 * `AlertNoOpTransitionError` if the target state is equal to the
 * current state (no-op transitions are caller bugs and need to
 * surface as 409s, not silent 200s).
 */
export async function transitionAlertState(id: string, toState: AlertState): Promise<AlertRow> {
  if (process.env.VIGIL_UI_ONLY === '1') {
    const i = SYNTH_ALERTS.findIndex((a) => a.id === id);
    if (i < 0) throw new AlertNotFoundError(id);
    const cur = SYNTH_ALERTS[i]!;
    if (cur.state === toState) throw new AlertNoOpTransitionError(id, toState);
    const next: AlertRow = { ...cur, state: toState };
    SYNTH_ALERTS[i] = next;
    return next;
  }
  const before = await getAlertById(id);
  if (!before) throw new AlertNotFoundError(id);
  if (before.state === toState) throw new AlertNoOpTransitionError(id, toState);
  const db = await getDb();
  const repo = new AnomalyAlertRepo(db);
  await repo.setState(id, toState);
  const after = await getAlertById(id);
  if (!after) throw new AlertNotFoundError(id); // raced delete; treat as 404
  return after;
}

export class AlertNotFoundError extends Error {
  override readonly name = 'AlertNotFoundError';
  readonly alertId: string;
  constructor(id: string) {
    super(`alert ${id} not found`);
    this.alertId = id;
  }
}

export class AlertNoOpTransitionError extends Error {
  override readonly name = 'AlertNoOpTransitionError';
  readonly alertId: string;
  readonly state: AlertState;
  constructor(id: string, state: AlertState) {
    super(`alert ${id} already in state '${state}'`);
    this.alertId = id;
    this.state = state;
  }
}

/* =============================================================================
 * UI-only synthetic dataset.
 *
 * Mutable on purpose: transitionAlertState mutates the array so a
 * reviewer sees the state change persist across page reloads within
 * the same dev process. Deterministic enough that the test suite
 * asserts exact counts.
 * ===========================================================================*/

const SYNTH_ALERTS: AlertRow[] = [
  {
    id: '00000000-0000-0000-0000-000000000001',
    kind: 'after_hours_dossier_access',
    actor_id: 'operator:armand.tchounkeu',
    summary_fr:
      "Accès dossier hors heures (02h17 UTC) — 4 dossiers en 6 minutes par un opérateur n'étant pas de garde.",
    summary_en:
      'After-hours dossier access (02:17 UTC) — 4 dossiers in 6 minutes by an operator not on shift.',
    severity: 'critical',
    rule_version: 'v1.0.0',
    triggering_event_count: 4,
    window_start: '2026-05-16T02:17:00.000Z',
    window_end: '2026-05-16T02:23:00.000Z',
    detected_at: '2026-05-16T02:28:00.000Z',
    state: 'open',
  },
  {
    id: '00000000-0000-0000-0000-000000000002',
    kind: 'auth_burst_new_ip',
    actor_id: 'analyst:noemie.aboubakar',
    summary_fr:
      "12 tentatives d'authentification depuis 41.205.180.0/24 (jamais vu) en 90 secondes — succès au 11e essai.",
    summary_en:
      '12 auth attempts from 41.205.180.0/24 (never-seen) in 90 seconds — success on attempt 11.',
    severity: 'high',
    rule_version: 'v1.0.0',
    triggering_event_count: 12,
    window_start: '2026-05-15T18:42:00.000Z',
    window_end: '2026-05-15T18:43:30.000Z',
    detected_at: '2026-05-15T18:44:10.000Z',
    state: 'open',
  },
  {
    id: '00000000-0000-0000-0000-000000000003',
    kind: 'fishing_query_pattern',
    actor_id: 'analyst:david.eyenga',
    summary_fr:
      "Recherches répétées sur l'entité 'MTN Cameroon Marchés Publics' sans création d'enquête (8 requêtes en 2 jours).",
    summary_en:
      "Repeated searches on entity 'MTN Cameroon Marchés Publics' without case-file creation (8 queries over 2 days).",
    severity: 'medium',
    rule_version: 'v1.0.0',
    triggering_event_count: 8,
    window_start: '2026-05-13T08:00:00.000Z',
    window_end: '2026-05-15T17:00:00.000Z',
    detected_at: '2026-05-15T17:05:00.000Z',
    state: 'open',
  },
  {
    id: '00000000-0000-0000-0000-000000000004',
    kind: 'council_repeated_abstention',
    actor_id: 'council_member:abouem-a-tchoyi',
    summary_fr:
      '5 abstentions consécutives sur des dossiers impliquant des entités de la région Centre.',
    summary_en: '5 consecutive abstentions on dossiers concerning Centre-region entities.',
    severity: 'medium',
    rule_version: 'v1.0.0',
    triggering_event_count: 5,
    window_start: '2026-05-09T10:00:00.000Z',
    window_end: '2026-05-15T16:00:00.000Z',
    detected_at: '2026-05-15T16:30:00.000Z',
    state: 'acknowledged',
  },
  {
    id: '00000000-0000-0000-0000-000000000005',
    kind: 'export_volume_spike',
    actor_id: 'auditor:fatima.bouba',
    summary_fr: 'Exportation CSV: 12 fichiers en 1 heure (médiane personnelle: 1.4/h sur 90j).',
    summary_en: 'CSV exports: 12 files in 1 hour (personal 90-day median: 1.4/h).',
    severity: 'low',
    rule_version: 'v1.0.0',
    triggering_event_count: 12,
    window_start: '2026-05-15T13:00:00.000Z',
    window_end: '2026-05-15T14:00:00.000Z',
    detected_at: '2026-05-15T14:02:00.000Z',
    state: 'dismissed',
  },
  {
    id: '00000000-0000-0000-0000-000000000006',
    kind: 'dossier_view_no_signature',
    actor_id: 'operator:claude.mbarga',
    summary_fr:
      'Dossier VA-2026-0048 ouvert 7 fois sans signature ni vote — comportement de "lecture seule prolongée".',
    summary_en:
      'Dossier VA-2026-0048 opened 7 times with no signature or vote — prolonged read-only behaviour.',
    severity: 'info',
    rule_version: 'v1.0.0',
    triggering_event_count: 7,
    window_start: '2026-05-14T09:00:00.000Z',
    window_end: '2026-05-15T15:00:00.000Z',
    detected_at: '2026-05-15T15:10:00.000Z',
    state: 'open',
  },
  {
    id: '00000000-0000-0000-0000-000000000007',
    kind: 'yubikey_geographic_improbable',
    actor_id: 'council_member:therese.kouoh',
    summary_fr:
      'Activation YubiKey à Yaoundé (10h12 UTC) puis Douala (10h18 UTC) — déplacement physique improbable.',
    summary_en:
      'YubiKey activation in Yaoundé (10:12 UTC) then Douala (10:18 UTC) — physically improbable transit.',
    severity: 'high',
    rule_version: 'v1.0.0',
    triggering_event_count: 2,
    window_start: '2026-05-15T10:12:00.000Z',
    window_end: '2026-05-15T10:18:00.000Z',
    detected_at: '2026-05-15T10:20:00.000Z',
    state: 'promoted_to_finding',
  },
];

function filterSynth(rows: ReadonlyArray<AlertRow>, opts: ListAlertsOpts): AlertRow[] {
  let out = [...rows];
  if (opts.states && opts.states.length > 0) {
    const set = new Set(opts.states);
    out = out.filter((r) => set.has(r.state));
  }
  if (opts.severities && opts.severities.length > 0) {
    const set = new Set(opts.severities);
    out = out.filter((r) => set.has(r.severity));
  }
  if (opts.sinceIso) {
    const cut = opts.sinceIso;
    out = out.filter((r) => r.detected_at > cut);
  }
  // Newest first — same contract as the SQL path.
  out.sort((a, b) => (a.detected_at < b.detected_at ? 1 : a.detected_at > b.detected_at ? -1 : 0));
  return out;
}

function countsFromRows(rows: ReadonlyArray<AlertRow>): AlertCounts {
  return countsFromTuples(rows.map((r) => ({ state: r.state, severity: r.severity, n: 1 })));
}

function countsFromTuples(
  tuples: ReadonlyArray<{ state: AlertState; severity: AlertSeverity; n: number }>,
): AlertCounts {
  const byState: Record<AlertState, number> = {
    open: 0,
    acknowledged: 0,
    dismissed: 0,
    promoted_to_finding: 0,
  };
  const bySev: Record<AlertSeverity, number> = {
    info: 0,
    low: 0,
    medium: 0,
    high: 0,
    critical: 0,
  };
  for (const t of tuples) {
    if (t.state in byState) byState[t.state] += t.n;
    if (t.severity in bySev) bySev[t.severity] += t.n;
  }
  return {
    open: byState.open,
    acknowledged: byState.acknowledged,
    dismissed: byState.dismissed,
    promoted: byState.promoted_to_finding,
    bySeverity: bySev,
  };
}
