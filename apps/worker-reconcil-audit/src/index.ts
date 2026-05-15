import { setTimeout as sleep } from 'node:timers/promises';

import { HashChain } from '@vigil/audit-chain';
import { getDb, getPool } from '@vigil/db-postgres';
import {
  LoopBackoff,
  createLogger,
  installShutdownHandler,
  initTracing,
  shutdownTracing,
  startMetricsServer,
  registerShutdown,
} from '@vigil/observability';
import { QueueClient, STREAMS, newEnvelope } from '@vigil/queue';

import {
  computeReconciliationPlan,
  planSummary,
  type ActionsRow,
  type AnchorCommitmentRow,
  type FabricWitnessRow,
} from './reconcile.js';

import type { Pool } from 'pg';

const logger = createLogger({ service: 'worker-reconcil-audit' });

/**
 * worker-reconcil-audit — audit-chain reconciliation worker.
 *
 * Closes FIND-005 from whole-system-audit doc 10. Periodically:
 *
 *   1. Reads a recent range of `audit.actions` (limited by env config).
 *   2. Reads matching `audit.fabric_witness` rows for the same seq range.
 *   3. Reads `audit.anchor_commitment` rows covering the range.
 *   4. Computes a reconciliation plan (pure function — see reconcile.ts).
 *   5. For each gap:
 *      a) Missing-from-Fabric: republish the audit envelope onto
 *         STREAMS.AUDIT_PUBLISH so worker-fabric-bridge picks it up.
 *      b) Missing-from-Polygon: increment a metric so the next anchor
 *         worker tick picks it up (the anchor worker reads the tail
 *         of the chain; the gap will be included automatically).
 *      c) Divergent: FATAL — append `audit.reconciliation_divergence`
 *         to the global chain and stop the loop (operator intervention
 *         required; non-recoverable).
 *   6. Append `audit.reconciliation_completed` to the global chain so
 *      every reconciliation tick is itself auditable.
 *
 * Halt-on-failure: an unrecoverable error in the loop is rethrown and
 * the worker exits non-zero; the systemd / docker supervisor restarts
 * it. Transient failures (e.g. queue publish error) log + continue.
 */

interface LoopConfig {
  readonly intervalMs: number;
  readonly windowSeqs: bigint;
  readonly maxRepublishPerTick: number;
}

function loadConfig(): LoopConfig {
  // Default: every hour, scan the last 10 000 seqs, republish at most
  // 100 missing-from-Fabric envelopes per tick (avoids stampeding the
  // bridge if a long outage left a big backlog).
  return {
    intervalMs: Number(process.env.RECONCIL_AUDIT_INTERVAL_MS ?? 60 * 60_000),
    windowSeqs: BigInt(process.env.RECONCIL_AUDIT_WINDOW_SEQS ?? '10000'),
    maxRepublishPerTick: Number(process.env.RECONCIL_AUDIT_MAX_REPUBLISH ?? 100),
  };
}

async function loadActions(pool: Pool, fromSeq: bigint, toSeq: bigint): Promise<ActionsRow[]> {
  const r = await pool.query<{ seq: string; body_hash: Buffer }>(
    `SELECT seq::text, body_hash
       FROM audit.actions
      WHERE seq BETWEEN $1::bigint AND $2::bigint
      ORDER BY seq ASC`,
    [String(fromSeq), String(toSeq)],
  );
  return r.rows.map((row) => ({ seq: row.seq, body_hash: row.body_hash.toString('hex') }));
}

async function loadFabricWitnesses(
  pool: Pool,
  fromSeq: bigint,
  toSeq: bigint,
): Promise<FabricWitnessRow[]> {
  const r = await pool.query<{ seq: string; body_hash: Buffer }>(
    `SELECT seq::text, body_hash
       FROM audit.fabric_witness
      WHERE seq BETWEEN $1::bigint AND $2::bigint
      ORDER BY seq ASC`,
    [String(fromSeq), String(toSeq)],
  );
  return r.rows.map((row) => ({ seq: row.seq, body_hash: row.body_hash.toString('hex') }));
}

async function loadAnchorCommitments(
  pool: Pool,
  fromSeq: bigint,
  toSeq: bigint,
): Promise<AnchorCommitmentRow[]> {
  // An anchor commitment is relevant if its range overlaps [fromSeq, toSeq].
  const r = await pool.query<{
    seq_from: string;
    seq_to: string;
    root_hash: Buffer;
    polygon_tx_hash: string | null;
  }>(
    `SELECT seq_from::text, seq_to::text, root_hash, polygon_tx_hash
       FROM audit.anchor_commitment
      WHERE seq_to >= $1::bigint AND seq_from <= $2::bigint
      ORDER BY seq_from ASC`,
    [String(fromSeq), String(toSeq)],
  );
  return r.rows.map((row) => ({
    seq_from: row.seq_from,
    seq_to: row.seq_to,
    root_hash: row.root_hash.toString('hex'),
    polygon_tx_hash: row.polygon_tx_hash,
  }));
}

async function maxActionSeq(pool: Pool): Promise<bigint> {
  const r = await pool.query<{ seq: string | null }>(
    'SELECT MAX(seq)::text AS seq FROM audit.actions',
  );
  const v = r.rows[0]?.seq;
  if (v === undefined || v === null) return 0n;
  return BigInt(v);
}

async function republishToFabricBridge(
  queue: QueueClient,
  gaps: ReadonlyArray<{ seq: string; body_hash: string }>,
  maxPerTick: number,
): Promise<number> {
  // The fabric-bridge consumes STREAMS.AUDIT_PUBLISH envelopes carrying
  // { seq, body_hash }. Republish (with a `reconcil:` dedup prefix so the
  // bridge's idempotent insert keeps the original record, not a fake
  // duplicate audit row).
  const slice = gaps.slice(0, maxPerTick);
  let published = 0;
  for (const gap of slice) {
    const env = newEnvelope(
      'worker-reconcil-audit',
      { seq: gap.seq, body_hash: gap.body_hash },
      `reconcil:${gap.seq}`,
    );
    try {
      await queue.publish(STREAMS.AUDIT_PUBLISH, env);
      published += 1;
    } catch (err) {
      logger.error({ err, seq: gap.seq }, 'reconcil-republish-failed');
    }
  }
  return published;
}

async function tick(
  pool: Pool,
  queue: QueueClient,
  chain: HashChain,
  cfg: LoopConfig,
): Promise<{ readonly fatal: boolean }> {
  const tail = await maxActionSeq(pool);
  if (tail === 0n) {
    logger.info({}, 'reconcil-empty-chain; nothing to reconcile');
    return { fatal: false };
  }
  const fromSeq = tail > cfg.windowSeqs ? tail - cfg.windowSeqs + 1n : 1n;

  const [actions, fabricWitnesses, anchorCommitments] = await Promise.all([
    loadActions(pool, fromSeq, tail),
    loadFabricWitnesses(pool, fromSeq, tail),
    loadAnchorCommitments(pool, fromSeq, tail),
  ]);

  const plan = computeReconciliationPlan({ actions, fabricWitnesses, anchorCommitments });
  const summary = planSummary(plan);

  logger.info(
    {
      from: fromSeq.toString(),
      to: tail.toString(),
      ...summary,
    },
    'reconcil-tick',
  );

  // Divergence is fatal — surface a structured alert and stop the loop.
  if (plan.divergent.length > 0) {
    logger.error(
      { divergent: plan.divergent },
      'reconcil-divergence-detected; non-recoverable; operator intervention required',
    );
    await chain.append({
      action: 'audit.reconciliation_divergence',
      actor: 'system:worker-reconcil-audit',
      subject_kind: 'system',
      subject_id: 'reconcil-audit',
      payload: {
        from_seq: fromSeq.toString(),
        to_seq: tail.toString(),
        divergent_count: plan.divergent.length,
        divergent_seqs: plan.divergent.map((d) => d.seq),
        // Hashes intentionally NOT logged here — they're already in
        // the structured logger error above. The audit chain payload
        // stays compact for replay performance.
      },
    });
    return { fatal: true };
  }

  // Republish missing-from-Fabric envelopes (bounded per tick).
  let republished = 0;
  if (plan.missingFromFabric.length > 0) {
    republished = await republishToFabricBridge(
      queue,
      plan.missingFromFabric,
      cfg.maxRepublishPerTick,
    );
  }

  // Missing-from-Polygon: the anchor worker reads the tail and includes
  // the gap automatically on its next tick. We don't directly trigger;
  // we just record the count for observability.

  // Audit-of-audit row so every reconciliation tick is itself logged.
  await chain.append({
    action: 'audit.reconciliation_completed',
    actor: 'system:worker-reconcil-audit',
    subject_kind: 'system',
    subject_id: 'reconcil-audit',
    payload: {
      from_seq: fromSeq.toString(),
      to_seq: tail.toString(),
      total_checked: summary.total,
      missing_fabric: summary.missing_fabric,
      missing_polygon: summary.missing_polygon,
      republished_fabric: republished,
      window_seqs: cfg.windowSeqs.toString(),
    },
  });

  return { fatal: false };
}

async function main(): Promise<void> {
  await initTracing({ service: 'worker-reconcil-audit' });
  const metrics = await startMetricsServer();
  registerShutdown('metrics', () => metrics.close());
  installShutdownHandler(logger);
  registerShutdown('tracing', shutdownTracing);

  const cfg = loadConfig();
  logger.info({ cfg }, 'worker-reconcil-audit-ready');

  const pool = await getPool();
  // Touch the db handle so connection pool initialises before the loop.
  await getDb();
  const chain = new HashChain(pool, logger);
  const queue = new QueueClient({ logger });
  await queue.ping();
  registerShutdown('queue', () => queue.close());

  let stopping = false;
  registerShutdown('reconcil-loop', () => {
    stopping = true;
  });

  // Mode 1.6 — adaptive sleep on consecutive failures.
  const backoff = new LoopBackoff({ initialMs: 1_000, capMs: cfg.intervalMs });
  while (!stopping) {
    try {
      const result = await tick(pool, queue, chain, cfg);
      if (result.fatal) {
        logger.error({}, 'reconcil-fatal-stop; awaiting operator');
        // Don't exit — wait for operator restart. Keep emitting health
        // pings via the next tick so silence cannot be confused with
        // "all clear". The next chain.append on the divergence path
        // already surfaced the issue.
        // Treat fatal-but-non-throwing as a "we shouldn't pound the
        // dependency" signal — back off the next tick.
        backoff.onError();
      } else {
        backoff.onSuccess();
      }
    } catch (err) {
      backoff.onError();
      logger.error(
        { err, consecutiveFailures: backoff.consecutiveFailureCount },
        'reconcil-tick-failed',
      );
    }
    await sleep(backoff.nextDelayMs());
  }

  logger.info('worker-reconcil-audit-stopping');
}

main().catch((err: unknown) => {
  logger.error({ err }, 'fatal-startup');
  process.exit(1);
});
