import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';

import { HashChain } from '@vigil/audit-chain';
import {
  evaluateAnomalies,
  RULE_VERSION,
  type AnomalyEvent,
  type AnomalyRuleResult,
} from '@vigil/audit-log';
import {
  AnomalyAlertRepo,
  getDb,
  getPool,
} from '@vigil/db-postgres';
import {
  createLogger,
  installShutdownHandler,
  initTracing,
  shutdownTracing,
  startMetricsServer,
  registerShutdown,
} from '@vigil/observability';
import { sql } from 'drizzle-orm';

const logger = createLogger({ service: 'worker-audit-watch' });

/**
 * worker-audit-watch — DECISION-012 §"Anomaly Detection on the Audit
 * Log Itself".
 *
 * Polls audit.user_action_event for events in a rolling window, runs
 * every deterministic rule from @vigil/audit-log, persists triggered
 * alerts to audit.anomaly_alert, and emits an audit-of-audit row
 * (`audit.query_executed`) for each detection cycle so even the watcher
 * is watched.
 */

async function main(): Promise<void> {
  await initTracing({ service: 'worker-audit-watch' });
  const metrics = await startMetricsServer();
  registerShutdown('metrics', () => metrics.close());
  installShutdownHandler(logger);
  registerShutdown('tracing', shutdownTracing);

  const db = await getDb();
  const anomalyRepo = new AnomalyAlertRepo(db);
  const pool = await getPool();
  const chain = new HashChain(pool, logger);

  const intervalMs = Number(process.env.AUDIT_WATCH_INTERVAL_MS ?? 5 * 60_000); // 5 min default
  const windowHours = Number(process.env.AUDIT_WATCH_WINDOW_HOURS ?? 24);

  let stopping = false;
  registerShutdown('watch-loop', () => {
    stopping = true;
  });

  logger.info({ intervalMs, windowHours, ruleVersion: RULE_VERSION }, 'worker-audit-watch-ready');

  while (!stopping) {
    try {
      const since = new Date(Date.now() - windowHours * 3_600_000).toISOString();
      const rows = await db.execute(sql`
        SELECT event_id, event_type, category, timestamp_utc, actor_id, actor_role, actor_ip,
               target_resource, result_status
          FROM audit.user_action_event
         WHERE timestamp_utc >= ${since}::timestamptz
         ORDER BY timestamp_utc ASC
         LIMIT 50000
      `);
      const events: AnomalyEvent[] = (
        rows.rows as Array<{
          event_id: string;
          event_type: string;
          category: string;
          timestamp_utc: Date | string;
          actor_id: string;
          actor_role: string;
          actor_ip: string | null;
          target_resource: string;
          result_status: string;
        }>
      ).map((r) => ({
        event_id: r.event_id,
        event_type: r.event_type,
        category: r.category,
        timestamp_utc:
          r.timestamp_utc instanceof Date ? r.timestamp_utc.toISOString() : r.timestamp_utc,
        actor_id: r.actor_id,
        actor_role: r.actor_role,
        actor_ip: r.actor_ip,
        target_resource: r.target_resource,
        result_status: r.result_status,
      }));

      const alerts = evaluateAnomalies(events);
      for (const a of alerts) {
        await persistAlert(anomalyRepo, a);
      }

      // Audit-of-audit — every detection cycle is itself logged.
      await chain.append({
        action: 'audit.hash_chain_verified',
        actor: 'system:worker-audit-watch',
        subject_kind: 'system',
        subject_id: 'audit-watch',
        payload: {
          rule_version: RULE_VERSION,
          window_hours: windowHours,
          events_scanned: events.length,
          alerts_emitted: alerts.length,
        },
      });

      logger.info(
        { events: events.length, alerts: alerts.length, ruleVersion: RULE_VERSION },
        'audit-watch-tick',
      );
    } catch (err) {
      logger.error({ err }, 'audit-watch-loop-error');
    }
    await sleep(intervalMs);
  }
  logger.info('worker-audit-watch-stopping');
}

async function persistAlert(repo: AnomalyAlertRepo, alert: AnomalyRuleResult): Promise<void> {
  await repo.create({
    id: randomUUID(),
    kind: alert.kind,
    actor_id: alert.actor_id,
    window_start: new Date(alert.window_start),
    window_end: new Date(alert.window_end),
    summary_fr: alert.summary_fr,
    summary_en: alert.summary_en,
    severity: alert.severity,
    rule_version: RULE_VERSION,
    triggering_event_ids: [...alert.triggering_event_ids],
  });
}

main().catch((err: unknown) => {
  logger.error({ err }, 'fatal-startup');
  process.exit(1);
});
