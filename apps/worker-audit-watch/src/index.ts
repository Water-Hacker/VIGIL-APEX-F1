import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';

import { HashChain } from '@vigil/audit-chain';
import {
  evaluateAnomalies,
  RULE_VERSION,
  type AnomalyEvent,
  type AnomalyRuleResult,
} from '@vigil/audit-log';
import { AnomalyAlertRepo, getDb, getPool } from '@vigil/db-postgres';
import {
  LoopBackoff,
  StartupGuard,
  auditFeatureFlagsAtBoot,
  createLogger,
  installShutdownHandler,
  initTracing,
  shutdownTracing,
  startMetricsServer,
  registerShutdown,
  type FeatureFlagAuditEmit,
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
  const guard = new StartupGuard({ serviceName: 'worker-audit-watch', logger });
  await guard.check();

  await initTracing({ service: 'worker-audit-watch' });
  const metrics = await startMetricsServer();
  registerShutdown('metrics', () => metrics.close());
  installShutdownHandler(logger);
  registerShutdown('tracing', shutdownTracing);

  const db = await getDb();
  const anomalyRepo = new AnomalyAlertRepo(db);
  const pool = await getPool();
  const chain = new HashChain(pool, logger);

  const emit: FeatureFlagAuditEmit = async (event) => {
    await chain.append({
      action: event.action,
      actor: 'worker-audit-watch',
      subject_kind: event.subject_kind,
      subject_id: event.subject_id,
      payload: event.payload,
    });
  };
  await auditFeatureFlagsAtBoot({ service: 'worker-audit-watch', emit });

  const intervalMs = Number(process.env.AUDIT_WATCH_INTERVAL_MS ?? 5 * 60_000); // 5 min default
  const windowHours = Number(process.env.AUDIT_WATCH_WINDOW_HOURS ?? 24);
  // FIND-014 closure (whole-system-audit doc 10): cap on how many
  // audit.actions rows to replay each tick. 0 disables the chain
  // verify pass entirely. Default = 10 000 — enough to catch a tamper
  // attempt within a few hours of insertion on a typical traffic
  // profile without dominating the tick budget.
  const verifyRows = Number(process.env.AUDIT_WATCH_CHAIN_VERIFY_ROWS ?? 10_000);

  let stopping = false;
  registerShutdown('watch-loop', () => {
    stopping = true;
  });

  // Cursor for the chain-verify pass — advances per successful tick so
  // we don't re-verify the same prefix forever. On startup we seed it
  // from the tail to keep the first tick cheap; the architect can set
  // AUDIT_WATCH_CHAIN_VERIFY_FROM=1 to force a full-history sweep at
  // restart.
  let verifyCursor: bigint = process.env.AUDIT_WATCH_CHAIN_VERIFY_FROM
    ? BigInt(process.env.AUDIT_WATCH_CHAIN_VERIFY_FROM)
    : await (async (): Promise<bigint> => {
        const tail = await chain.tail();
        if (!tail) return 1n;
        const window = BigInt(verifyRows);
        return tail.seq > window ? BigInt(tail.seq) - window + 1n : 1n;
      })();

  await guard.markBootSuccess();
  logger.info(
    {
      intervalMs,
      windowHours,
      verifyRows,
      verifyCursor: verifyCursor.toString(),
      ruleVersion: RULE_VERSION,
    },
    'worker-audit-watch-ready',
  );

  // Mode 1.6 — adaptive sleep on consecutive failures.
  const backoff = new LoopBackoff({ initialMs: 1_000, capMs: intervalMs });
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

      // FIND-014 closure: replay a window of the global hash chain so
      // tampering — a malicious or buggy UPDATE on audit.actions — does
      // not slip past the audit-of-audit loop.
      //
      // HashChain.verify() throws on the first divergence with a
      // HashChainBrokenError; we catch it here, surface a fatal
      // `audit.hash_chain_break` row, and let the loop continue (the
      // operator must intervene; the next tick will keep emitting the
      // break event so silence cannot be confused with "all clear").
      let verifyChecked = 0;
      let verifyBreak: string | null = null;
      if (verifyRows > 0) {
        const tail = await chain.tail();
        if (tail) {
          const to = BigInt(tail.seq);
          const from = verifyCursor;
          if (to >= from) {
            const end = to - from + 1n > BigInt(verifyRows) ? from + BigInt(verifyRows) - 1n : to;
            try {
              verifyChecked = await chain.verify(Number(from), Number(end));
              verifyCursor = end + 1n;
              if (verifyCursor > to) verifyCursor = to + 1n;
            } catch (err) {
              verifyBreak = err instanceof Error ? err.message : String(err);
              await chain.append({
                action: 'audit.hash_chain_break',
                actor: 'system:worker-audit-watch',
                subject_kind: 'system',
                subject_id: 'audit-watch',
                payload: {
                  from_seq: from.toString(),
                  to_seq: end.toString(),
                  error: verifyBreak,
                  rule_version: RULE_VERSION,
                },
              });
              logger.error(
                { from: from.toString(), to: end.toString(), err: verifyBreak },
                'audit-chain-break-detected; operator intervention required',
              );
              // Do NOT advance the cursor on break — keep replaying
              // this window until the operator fixes or accepts the
              // divergence (and bumps AUDIT_WATCH_CHAIN_VERIFY_FROM).
            }
          }
        }
      }

      // Audit-of-audit — every detection cycle is itself logged with
      // the chain-verify stats so a reader can confirm the integrity
      // pass actually ran (not just the anomaly rules).
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
          chain_rows_verified: verifyChecked,
          chain_break: verifyBreak,
        },
      });

      logger.info(
        {
          events: events.length,
          alerts: alerts.length,
          ruleVersion: RULE_VERSION,
          chainRowsVerified: verifyChecked,
          chainCursor: verifyCursor.toString(),
        },
        'audit-watch-tick',
      );
      backoff.onSuccess();
    } catch (err) {
      backoff.onError();
      logger.error(
        { err, consecutiveFailures: backoff.consecutiveFailureCount },
        'audit-watch-loop-error',
      );
    }
    await sleep(backoff.nextDelayMs());
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
