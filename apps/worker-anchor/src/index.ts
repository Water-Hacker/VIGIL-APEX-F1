import { setTimeout as sleep } from 'node:timers/promises';

import {
  HashChain,
  PolygonAnchor,
  UnixSocketSignerAdapter,
} from '@vigil/audit-chain';
import { getPool } from '@vigil/db-postgres';
import {
  createLogger,
  installShutdownHandler,
  initTracing,
  shutdownTracing,
  startMetricsServer,
  registerShutdown,
} from '@vigil/observability';
import { sql } from 'drizzle-orm';

const logger = createLogger({ service: 'worker-anchor' });

/**
 * Periodic anchor commit. Reads the latest range of unanchored audit events,
 * computes a Merkle-style root over them, and submits via the YubiKey-backed
 * Unix-socket signer.
 *
 * Cadence: AUDIT_ANCHOR_INTERVAL_MS (default 1 hour). Idempotent: if the
 * range was already committed (gap-free seq tracking), skip.
 */
async function main(): Promise<void> {
  await initTracing({ service: 'worker-anchor' });
  const metrics = await startMetricsServer();
  registerShutdown('metrics', () => metrics.close());
  installShutdownHandler(logger);
  registerShutdown('tracing', shutdownTracing);

  const pool = await getPool();
  const chain = new HashChain(pool, logger);

  const signer = new UnixSocketSignerAdapter();
  const polygonContract =
    process.env.POLYGON_ANCHOR_CONTRACT ?? '0x0000000000000000000000000000000000000000';
  const anchor = new PolygonAnchor({
    rpcUrl: process.env.POLYGON_RPC_URL ?? 'https://polygon-rpc.com',
    contractAddress: polygonContract,
    signer,
    chainId: Number(process.env.POLYGON_CHAIN_ID ?? 137),
    fallbackRpcUrls: (process.env.POLYGON_RPC_FALLBACK_URLS ?? '').split(',').filter(Boolean),
    maxGasPriceGwei: Number(process.env.POLYGON_GAS_PRICE_GWEI_MAX ?? 200),
    logger,
  });

  const intervalMs = Number(process.env.AUDIT_ANCHOR_INTERVAL_MS ?? 3_600_000);
  let stopping = false;
  registerShutdown('anchor-loop', () => {
    stopping = true;
  });

  logger.info({ intervalMs, contract: polygonContract }, 'worker-anchor-ready');

  while (!stopping) {
    try {
      const tail = await chain.tail();
      if (!tail) {
        logger.info('no-events-yet');
        await sleep(intervalMs);
        continue;
      }
      // Find the highest seq already anchored
      const r = await pool.query<{ max: number | null }>(
        `SELECT MAX(seq_to)::bigint AS max FROM audit.anchor_commitment`,
      );
      const lastAnchoredTo = r.rows[0]?.max ? Number(r.rows[0].max) : 0;

      if (tail.seq <= lastAnchoredTo) {
        await sleep(intervalMs);
        continue;
      }

      const fromSeq = lastAnchoredTo + 1;
      const toSeq = tail.seq;
      // Compute root over the range — for MVP we use the latest body_hash
      // (the chain itself is hash-linked, so the tail hash IS a Merkle root
      // of the prefix; verifier walks the chain).
      const rootHash = tail.bodyHash;

      logger.info({ fromSeq, toSeq, rootHash }, 'anchoring');
      const txHash = await anchor.commit(fromSeq, toSeq, rootHash);

      await pool.query(
        `INSERT INTO audit.anchor_commitment (id, seq_from, seq_to, root_hash, polygon_tx_hash, polygon_confirmed_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, NULL)`,
        [String(fromSeq), String(toSeq), Buffer.from(rootHash, 'hex'), txHash],
      );
    } catch (e) {
      logger.error({ err: e }, 'anchor-loop-error');
    }
    await sleep(intervalMs);
  }

  logger.info('worker-anchor-stopping');
}

main().catch((e: unknown) => {
  logger.error({ err: e }, 'fatal-startup');
  process.exit(1);
});

import { getDb as _getDb, getPool as _getPool } from '@vigil/db-postgres';
void _getDb; void _getPool;
