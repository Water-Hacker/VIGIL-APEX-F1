import { createHash } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';

import { HashChain, PolygonAnchor, UnixSocketSignerAdapter } from '@vigil/audit-chain';
import { PublicAnchorRepo, UserActionEventRepo, getDb, getPool } from '@vigil/db-postgres';
import {
  LoopBackoff,
  createLogger,
  installShutdownHandler,
  initTracing,
  shutdownTracing,
  startMetricsServer,
  registerShutdown,
} from '@vigil/observability';

import { runHighSigAnchorLoop } from './high-sig-loop.js';

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
  const polygonContract = process.env.POLYGON_ANCHOR_CONTRACT;
  // Block-B A9 — reject anything that isn't the EVM 20-byte address
  // shape. Previous guard caught only the null-address (`0x0...0`);
  // the literal `PLACEHOLDER_DEPLOYED_AT_M1` from .env.example slipped
  // through and produced a cryptic ENS error at first interaction.
  // Now the regex pins shape: 0x + 40 hex chars, case-insensitive.
  // Null-address still fails (it's also matched as zero-only after
  // the shape check).
  const isEvmAddress = (v: string): boolean => /^0x[0-9a-fA-F]{40}$/.test(v);
  if (!polygonContract || !isEvmAddress(polygonContract) || /^0x0+$/i.test(polygonContract)) {
    throw new Error(
      `POLYGON_ANCHOR_CONTRACT is unset, null-address, or not an EVM 20-byte address (got: ${polygonContract ?? '<unset>'}); refusing to start worker-anchor. Set the deployed contract address before boot.`,
    );
  }
  const polygonRpcUrl = process.env.POLYGON_RPC_URL;
  if (!polygonRpcUrl) {
    logger.warn(
      'POLYGON_RPC_URL unset; falling back to public polygon-rpc.com — SRD §22 expects an authenticated provider (Alchemy/Infura) in production',
    );
  }
  const anchor = new PolygonAnchor({
    rpcUrl: polygonRpcUrl ?? 'https://polygon-rpc.com',
    contractAddress: polygonContract,
    signer,
    chainId: Number(process.env.POLYGON_CHAIN_ID ?? 137),
    fallbackRpcUrls: (process.env.POLYGON_RPC_FALLBACK_URLS ?? '').split(',').filter(Boolean),
    maxGasPriceGwei: Number(process.env.POLYGON_GAS_PRICE_GWEI_MAX ?? 200),
    logger,
  });

  const intervalMs = Number(process.env.AUDIT_ANCHOR_INTERVAL_MS ?? 3_600_000);
  const highSigIntervalMs = Number(process.env.AUDIT_HIGH_SIG_INTERVAL_MS ?? 5_000);
  let stopping = false;
  registerShutdown('anchor-loop', () => {
    stopping = true;
  });

  // DECISION-012 TAL-PA — fast-lane anchor for high-significance events.
  // Polls audit.user_action_event every few seconds for events flagged
  // `high_significance = true AND chain_anchor_tx IS NULL`, anchors each
  // individually, and writes the (event_id, polygon_tx_hash) mapping into
  // audit.public_anchor.
  const db = await getDb();
  const userActionRepo = new UserActionEventRepo(db);
  const publicAnchorRepo = new PublicAnchorRepo(db);
  void runHighSigAnchorLoop(
    { anchor, userActionRepo, publicAnchorRepo, logger, intervalMs: highSigIntervalMs },
    () => stopping,
  ).catch((e: unknown) => logger.error({ err: e }, 'high-sig-loop-fatal'));

  logger.info({ intervalMs, highSigIntervalMs, contract: polygonContract }, 'worker-anchor-ready');

  // Mode 1.6 — adaptive sleep on consecutive failures. Steady-state
  // cadence is intervalMs; consecutive errors back off exponentially
  // from 1s up to intervalMs. Resets on the first success.
  const backoff = new LoopBackoff({ initialMs: 1_000, capMs: intervalMs });
  while (!stopping) {
    try {
      const tail = await chain.tail();
      if (!tail) {
        logger.info('no-events-yet');
        backoff.onSuccess();
        await sleep(backoff.nextDelayMs());
        continue;
      }
      // Find the highest seq already anchored
      const r = await pool.query<{ max: number | null }>(
        `SELECT MAX(seq_to)::bigint AS max FROM audit.anchor_commitment`,
      );
      const lastAnchoredTo = r.rows[0]?.max ? Number(r.rows[0].max) : 0;

      if (tail.seq <= lastAnchoredTo) {
        backoff.onSuccess();
        await sleep(backoff.nextDelayMs());
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
      backoff.onSuccess();
    } catch (e) {
      backoff.onError();
      logger.error(
        { err: e, consecutiveFailures: backoff.consecutiveFailureCount },
        'anchor-loop-error',
      );
    }
    await sleep(backoff.nextDelayMs());
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
      next.push(
        createHash('sha256')
          .update(Buffer.concat([left, right]))
          .digest(),
      );
    }
    layer = next;
  }
  return layer[0]!.toString('hex');
}

main().catch((e: unknown) => {
  logger.error({ err: e }, 'fatal-startup');
  process.exit(1);
});
