import { HashChain } from '@vigil/audit-chain';
import { getDb, getPool } from '@vigil/db-postgres';
import { FabricBridge } from '@vigil/fabric-bridge';
import {
  StartupGuard,
  auditFeatureFlagsAtBoot,
  createLogger,
  errorsTotal,
  eventsConsumed,
  eventsEmitted,
  installShutdownHandler,
  initTracing,
  registerShutdown,
  shutdownTracing,
  startMetricsServer,
  type FeatureFlagAuditEmit,
} from '@vigil/observability';
import { QueueClient, STREAMS, WorkerBase, type Envelope, type HandlerOutcome } from '@vigil/queue';

const logger = createLogger({ service: 'worker-fabric-bridge' });

/**
 * worker-fabric-bridge — second cryptographic witness over the
 * Postgres `audit.actions` chain.
 *
 * Source of truth: `audit.actions` (Postgres, hash-linked).
 * Witness: Hyperledger Fabric `audit-witness` chaincode.
 *
 * Wiring: HashChain.append() (in @vigil/audit-chain) emits an
 * envelope on STREAMS.AUDIT_PUBLISH after every commit. This worker
 * consumes that stream, calls `submitCommitment(seq, body_hash)` on
 * the chaincode, and records the resulting Fabric tx id in
 * `audit.fabric_witness` (migration 0004).
 *
 * Idempotency:
 *   - chaincode `RecordCommitment` is idempotent on (seq, bodyHash);
 *     a divergence (same seq, different hash) throws — we route to
 *     the dead-letter stream + AlertManager critical.
 *   - the local audit.fabric_witness row is INSERT…ON CONFLICT DO NOTHING.
 */

import { resolveFabricEnv } from './env-gate.js';
import {
  zFabricBridgePayload as zPayload,
  type FabricBridgePayload as Payload,
} from './payload.js';

export { zPayload };
export type { Payload };

class FabricBridgeWorker extends WorkerBase<Payload> {
  constructor(
    private readonly bridge: FabricBridge,
    private readonly pgPool: Awaited<ReturnType<typeof getPool>>,
    queue: QueueClient,
  ) {
    super({
      name: 'worker-fabric-bridge',
      stream: STREAMS.AUDIT_PUBLISH,
      schema: zPayload,
      client: queue,
      logger,
      // Fabric throughput at single-peer is comfortably ~100 tx/s; we
      // stay well below endorsement contention with concurrency 4.
      concurrency: 4,
      maxRetries: 8,
    });
  }

  protected async handle(env: Envelope<Payload>): Promise<HandlerOutcome> {
    const { seq, body_hash } = env.payload;
    eventsConsumed.labels({ worker: 'worker-fabric-bridge', stream: STREAMS.AUDIT_PUBLISH }).inc();

    const outcome = await this.bridge.submitCommitment(seq, body_hash);

    if (outcome.kind === 'divergence') {
      // CRITICAL — Postgres and Fabric disagree at seq. Surface as a
      // hard error; AlertManager's HashChainBreak rule covers it once
      // the metric goes non-zero.
      errorsTotal
        .labels({
          service: 'worker-fabric-bridge',
          code: 'AUDIT_HASH_CHAIN_BROKEN',
          severity: 'fatal',
        })
        .inc();
      logger.error(
        { seq, expected: body_hash, fabric: outcome.existingBodyHash },
        'fabric-postgres-divergence',
      );
      return {
        kind: 'dead-letter',
        reason: `divergence at seq=${seq}: pg=${body_hash} fabric=${outcome.existingBodyHash}`,
      };
    }

    // Record the witness row. Idempotent at (seq).
    await this.pgPool.query(
      `INSERT INTO audit.fabric_witness (seq, body_hash, fabric_tx_id, anchored_at)
         VALUES ($1::bigint, decode($2, 'hex'), $3, NOW())
         ON CONFLICT (seq) DO NOTHING`,
      [seq, body_hash, outcome.kind === 'recorded' ? outcome.txId : 'duplicate'],
    );
    eventsEmitted.labels({ worker: 'worker-fabric-bridge', stream: 'audit.fabric_witness' }).inc();
    return { kind: 'ack' };
  }
}

async function main(): Promise<void> {
  const guard = new StartupGuard({ serviceName: 'worker-fabric-bridge', logger });
  await guard.check();

  await initTracing({ service: 'worker-fabric-bridge' });
  const metrics = await startMetricsServer();
  registerShutdown('metrics', () => metrics.close());
  installShutdownHandler(logger);
  registerShutdown('tracing', shutdownTracing);

  const queue = new QueueClient({ logger });
  await queue.ping();
  registerShutdown('queue', () => queue.close());

  const db = await getDb();
  void db; // ensures migrations have run via the pool warmup
  const pool = await getPool();

  const chain = new HashChain(pool, logger);
  const emit: FeatureFlagAuditEmit = async (event) => {
    await chain.append({
      action: event.action,
      actor: 'worker-fabric-bridge',
      subject_kind: event.subject_kind,
      subject_id: event.subject_id,
      payload: event.payload,
    });
  };
  await auditFeatureFlagsAtBoot({ service: 'worker-fabric-bridge', emit });

  // Tier-13 audit closure: refuse to start with dev defaults in
  // production/staging, and fail fast if any of the TLS/cert paths
  // are missing on disk. See env-gate.ts for the rationale.
  const fabricEnv = resolveFabricEnv(process.env);
  const { mspId, peerEndpoint, tlsRootCertPath, clientCertPath, clientPrivateKeyPath } = fabricEnv;

  const bridge = new FabricBridge(
    {
      mspId,
      peerEndpoint,
      ...(process.env.FABRIC_PEER_HOST_ALIAS && {
        peerHostAlias: process.env.FABRIC_PEER_HOST_ALIAS,
      }),
      channelName: process.env.FABRIC_CHANNEL ?? 'vigil-audit',
      chaincodeName: process.env.FABRIC_CHAINCODE ?? 'audit-witness',
      tlsRootCertPath,
      clientCertPath,
      clientPrivateKeyPath,
    },
    logger,
  );
  await bridge.connect();
  registerShutdown('fabric', () => bridge.close());

  const worker = new FabricBridgeWorker(bridge, pool, queue);
  await worker.start();
  registerShutdown('worker', () => worker.stop());

  await guard.markBootSuccess();
  logger.info('worker-fabric-bridge-ready');
}

main().catch((e: unknown) => {
  const err = e instanceof Error ? e : new Error(String(e));
  logger.error({ err_name: err.name, err_message: err.message }, 'fatal-startup');
  process.exit(1);
});
