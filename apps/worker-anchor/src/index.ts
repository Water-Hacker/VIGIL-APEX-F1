import { createHash } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';

import { HashChain, PolygonAnchor, UnixSocketSignerAdapter } from '@vigil/audit-chain';
import { PublicAnchorRepo, UserActionEventRepo, getDb, getPool } from '@vigil/db-postgres';
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
  const guard = new StartupGuard({ serviceName: 'worker-anchor', logger });
  await guard.check();

  await initTracing({ service: 'worker-anchor' });
  const metrics = await startMetricsServer();
  registerShutdown('metrics', () => metrics.close());
  installShutdownHandler(logger);
  registerShutdown('tracing', shutdownTracing);

  const pool = await getPool();
  const chain = new HashChain(pool, logger);

  const emit: FeatureFlagAuditEmit = async (event) => {
    await chain.append({
      action: event.action,
      actor: 'worker-anchor',
      subject_kind: event.subject_kind,
      subject_id: event.subject_id,
      payload: event.payload,
    });
  };
  await auditFeatureFlagsAtBoot({ service: 'worker-anchor', emit });

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

  // Tier-24 audit closure: validate the env-driven numeric configuration
  // BEFORE the loop starts. Pre-fix `Number('foo')` returned NaN, which
  // made `sleep(NaN)` return immediately and turned the loop into a
  // busy-wait. The signer would then be hammered with anchor commits
  // until the operator noticed via grafana. Validate at boot instead.
  const parsePositiveIntEnv = (name: string, defaultMs: number, minMs: number): number => {
    const raw = process.env[name];
    if (raw === undefined || raw === '') return defaultMs;
    const n = Number(raw);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < minMs) {
      throw new Error(
        `${name}=${JSON.stringify(raw)} must be an integer >= ${minMs}ms; refusing to start worker-anchor`,
      );
    }
    return n;
  };
  const intervalMs = parsePositiveIntEnv('AUDIT_ANCHOR_INTERVAL_MS', 3_600_000, 1_000);
  const highSigIntervalMs = parsePositiveIntEnv('AUDIT_HIGH_SIG_INTERVAL_MS', 5_000, 1_000);
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
  ).catch((e: unknown) => {
    const err = e instanceof Error ? e : new Error(String(e));
    logger.error({ err_name: err.name, err_message: err.message }, 'high-sig-loop-fatal');
  });

  // Tier-53 audit closure — boot-time chain↔DB cursor reconciliation.
  //
  // The Tier-11 audit flag at the commit-loop body documented a class
  // of bug where `anchor.commit()` succeeds on-chain but the
  // subsequent DB INSERT into `audit.anchor_commitment` fails (DB
  // outage, connection drop, SERIALIZABLE conflict). The on-chain
  // contract's contiguity guard (`fromSeq != lastToSeq + 1`) prevents
  // a true duplicate-commit on retry — instead the retry REVERTS, the
  // catch block logs an error, the loop backs off, and ultimately
  // wedges: every subsequent attempt reverts with the same reason.
  //
  // This is operationally silent without manual log inspection. The
  // detector below reads the on-chain lastToSeq (via totalCommitments
  // + getCommitment) and compares to the DB's max(seq_to). If they
  // diverge, a fatal-level structured log fires WITH BOTH VALUES so
  // the on-call operator sees the divergence + the exact reconciliation
  // command they need to run.
  //
  // We do NOT auto-backfill — the recovery requires architect review
  // of which on-chain commitments to import (an attacker who gained
  // committer access could have written spurious rows). The detector
  // is the gate; the recovery is a manual ceremony.
  try {
    const chainTotal = await anchor.totalCommitments();
    let chainLastToSeq = 0;
    if (chainTotal > 0) {
      const lastCommit = await anchor.getCommitment(chainTotal - 1);
      chainLastToSeq = lastCommit.toSeq;
    }
    const dbCursor = await pool.query<{ max: number | null }>(
      `SELECT MAX(seq_to)::bigint AS max FROM audit.anchor_commitment
        WHERE polygon_tx_hash IS NOT NULL`,
    );
    const dbLastToSeq = dbCursor.rows[0]?.max ? Number(dbCursor.rows[0].max) : 0;
    if (chainLastToSeq !== dbLastToSeq) {
      logger.fatal(
        {
          chain_last_to_seq: chainLastToSeq,
          db_last_to_seq: dbLastToSeq,
          chain_total_commitments: chainTotal,
          divergence: chainLastToSeq - dbLastToSeq,
        },
        'anchor-cursor-divergence; manual reconciliation required before steady-state loop is safe',
      );
      // Stay alive so the operator can investigate via logs + metrics;
      // do NOT throw — exiting the worker would just hide the alert.
      // The loop below WILL keep trying and reverting until the
      // reconciliation is done, which is the correct fail-loud posture.
    } else {
      logger.info(
        { chain_last_to_seq: chainLastToSeq, db_last_to_seq: dbLastToSeq },
        'anchor-cursor-reconciled',
      );
    }
  } catch (e) {
    // Reconciliation read failed (RPC down, etc.). Log warn and
    // proceed — the loop's own error handling covers the steady state.
    const err = e instanceof Error ? e : new Error(String(e));
    logger.warn(
      { err_name: err.name, err_message: err.message },
      'anchor-cursor-reconciliation-skipped',
    );
  }

  await guard.markBootSuccess();
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
      // Tier-24 audit closure: cap the per-tick anchor range so a long
      // outage (signer down, network split) does not produce a single
      // mega-batch that loads N×32 bytes of body_hashes + N nodes of
      // the Merkle tree into the worker's heap. 100_000 seqs ≈ 3.2 MB
      // of leaves + ~6.4 MB of tree memory — bounded regardless of
      // chain length. If the unanchored range exceeds the cap, the
      // next loop tick picks up the remainder.
      const MAX_ANCHOR_BATCH_SEQS = 100_000;
      const toSeq = Math.min(tail.seq, fromSeq + MAX_ANCHOR_BATCH_SEQS - 1);
      if (toSeq < tail.seq) {
        logger.info(
          { fromSeq, toSeq, chainTail: tail.seq, capped: true },
          'anchor-batch-capped; remainder will land on next tick',
        );
      }
      // Merkle root over the body_hash leaves in [fromSeq, toSeq].
      // The audit-chain is itself hash-linked (each row carries the previous
      // row's body_hash via prev_hash), so a Merkle commitment at the range
      // tip plus the verifier's chain walk gives O(log n) inclusion proofs
      // for any single event in the anchored window — matches SRD §17 where
      // the anchor must be a CRYPTOGRAPHIC root, not just the tail hash.
      const rootHash = await computeMerkleRootForRange(pool, fromSeq, toSeq);

      logger.info({ fromSeq, toSeq, rootHash }, 'anchoring');
      const txHash = await anchor.commit(fromSeq, toSeq, rootHash);

      // Tier-11 audit FLAG (NOT fixed in this PR — needs architect
      // input on VIGILAnchor.sol uniqueness semantics):
      //
      // Race: if anchor.commit() succeeds and this INSERT then fails
      // (DB outage / connection drop / SERIALIZABLE conflict), the
      // on-chain anchor is committed but there is no local
      // anchor_commitment row. The MAX(seq_to) check at the top of
      // the loop will not see the missing range; the next tick will
      // re-anchor [fromSeq, toSeq] → duplicate on-chain commit.
      //
      // Mitigations to consider:
      //   (a) pre-insert with polygon_tx_hash=NULL BEFORE commit, then
      //       UPDATE the tx_hash on success. Failure leaves a row
      //       with null tx_hash but the range is claimed (lastAnchored
      //       advances). A separate recovery worker scans null-tx
      //       rows and either retries or marks dead.
      //   (b) make VIGILAnchor.sol revert on a re-commit of the same
      //       (fromSeq, toSeq) tuple. Each duplicate would then fail
      //       on-chain with a clear revert reason rather than land as
      //       two distinct commitments.
      //
      // Both are larger changes. Logged as a known gap.
      await pool.query(
        `INSERT INTO audit.anchor_commitment (id, seq_from, seq_to, root_hash, polygon_tx_hash, polygon_confirmed_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, NULL)`,
        [String(fromSeq), String(toSeq), Buffer.from(rootHash, 'hex'), txHash],
      );
      backoff.onSuccess();
    } catch (e) {
      backoff.onError();
      const err = e instanceof Error ? e : new Error(String(e));
      logger.error(
        {
          err_name: err.name,
          err_message: err.message,
          consecutiveFailures: backoff.consecutiveFailureCount,
        },
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
  const err = e instanceof Error ? e : new Error(String(e));
  logger.error({ err_name: err.name, err_message: err.message }, 'fatal-startup');
  process.exit(1);
});
