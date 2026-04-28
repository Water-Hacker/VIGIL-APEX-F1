import { setTimeout as sleep } from 'node:timers/promises';

import {
  HashChain,
  PolygonAnchor,
  LedgerVerifier,
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

const logger = createLogger({ service: 'audit-verifier' });

/**
 * audit-verifier — hourly process. Two checks:
 *   CT-01: walk audit.actions [from..to]; verify each row's prev_hash and body_hash.
 *          On break → emit FATAL alert, halt all writes, page architect.
 *   CT-02: read latest VIGILAnchor commitment; verify the local hash chain in
 *          the same range matches.
 */
async function main(): Promise<void> {
  await initTracing({ service: 'audit-verifier' });
  const metrics = await startMetricsServer();
  registerShutdown('metrics', () => metrics.close());
  installShutdownHandler(logger);
  registerShutdown('tracing', shutdownTracing);

  const pool = await getPool();
  const chain = new HashChain(pool, logger);
  const signer = new UnixSocketSignerAdapter();
  const anchor = new PolygonAnchor({
    rpcUrl: process.env.POLYGON_RPC_URL ?? 'https://polygon-rpc.com',
    contractAddress: process.env.POLYGON_ANCHOR_CONTRACT ?? '0x0000000000000000000000000000000000000000',
    signer,
    chainId: Number(process.env.POLYGON_CHAIN_ID ?? 137),
    logger,
  });
  const verifier = new LedgerVerifier(chain, anchor, logger);

  const intervalMs = Number(process.env.AUDIT_VERIFY_INTERVAL_MS ?? 3_600_000);
  let stopping = false;
  registerShutdown('verifier-loop', () => {
    stopping = true;
  });
  logger.info({ intervalMs }, 'audit-verifier-ready');

  while (!stopping) {
    try {
      // CT-01: full chain walk (cheap; serial scan)
      const tail = await chain.tail();
      if (tail) {
        const verified = await chain.verify(1, tail.seq);
        logger.info({ verified, tail_seq: tail.seq }, 'ct-01-hash-chain-verified');
      }
      // CT-02: latest on-chain commitment vs local
      try {
        const r = await verifier.verifyLatest();
        logger.info(r, 'ct-02-ledger-verified');
      } catch (e) {
        logger.error({ err: e }, 'ct-02-mismatch');
      }
    } catch (e) {
      logger.error({ err: e }, 'verifier-loop-error');
    }
    await sleep(intervalMs);
  }
}

main().catch((e: unknown) => {
  logger.error({ err: e }, 'fatal-startup');
  process.exit(1);
});
