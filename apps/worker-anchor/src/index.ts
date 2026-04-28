import { createHash } from 'node:crypto';
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
      // Merkle root over the body_hash leaves in [fromSeq, toSeq].
      // The audit-chain is itself hash-linked (each row carries the previous
      // row's body_hash via prev_hash), so a Merkle commitment at the range
      // tip plus the verifier's chain walk gives O(log n) inclusion proofs
      // for any single event in the anchored window — matches SRD §17 where
      // the anchor must be a CRYPTOGRAPHIC root, not just the tail hash.
      const rootHash = await computeMerkleRootForRange(pool, fromSeq, toSeq);

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

/**
 * Compute the Merkle root of the body_hash values for audit.actions rows in
 * [fromSeq, toSeq] inclusive. SHA-256 is the leaf and node hash; an odd-sized
 * layer duplicates its last node (Bitcoin-style) — documented in SRD §17.4.
 */
async function computeMerkleRootForRange(
  pool: Awaited<ReturnType<typeof getPool>>,
  fromSeq: number,
  toSeq: number,
): Promise<string> {
  const r = await pool.query<{ body_hash: Buffer }>(
    `SELECT body_hash FROM audit.actions
      WHERE seq BETWEEN $1 AND $2
      ORDER BY seq ASC`,
    [fromSeq, toSeq],
  );
  if (r.rows.length === 0) {
    return createHash('sha256').update('').digest('hex');
  }
  let layer: Buffer[] = r.rows.map((row) => row.body_hash);
  while (layer.length > 1) {
    const next: Buffer[] = [];
    for (let i = 0; i < layer.length; i += 2) {
      const left = layer[i]!;
      const right = i + 1 < layer.length ? layer[i + 1]! : left;
      next.push(createHash('sha256').update(Buffer.concat([left, right])).digest());
    }
    layer = next;
  }
  return layer[0]!.toString('hex');
}

main().catch((e: unknown) => {
  logger.error({ err: e }, 'fatal-startup');
  process.exit(1);
});
