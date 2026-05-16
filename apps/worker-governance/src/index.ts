import { HashChain } from '@vigil/audit-chain';
import { DossierRepo, FindingRepo, GovernanceRepo, getDb, getPool } from '@vigil/db-postgres';
import { GovernanceReadClient } from '@vigil/governance';
import {
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
import { QueueClient, STREAMS, startRedisStreamScraper } from '@vigil/queue';

import { bindWatch } from './vote-ceremony.js';

const logger = createLogger({ service: 'worker-governance' });

/**
 * worker-governance — listens to VIGILGovernance contract events and projects
 * them into the Postgres governance schema. Also writes audit-chain entries
 * for every council action.
 *
 * On reconnect, it does NOT re-replay history — the audit chain is the
 * canonical record; this worker is a read-projection cache.
 */
async function main(): Promise<void> {
  const guard = new StartupGuard({ serviceName: 'worker-governance', logger });
  await guard.check();

  await initTracing({ service: 'worker-governance' });
  const metrics = await startMetricsServer();
  registerShutdown('metrics', () => metrics.close());
  installShutdownHandler(logger);
  registerShutdown('tracing', shutdownTracing);

  // Tier-12 council audit closure: validate the contract address shape.
  // worker-anchor (the write-side) refuses to boot on a malformed
  // address; the watch-side worker-governance previously accepted
  // anything that wasn't the zero address. A typo like
  // POLYGON_GOVERNANCE_CONTRACT=0x123 would have been accepted here and
  // crashed deep inside the GovernanceReadClient when it first tried
  // to subscribe. Fail at boot with a clear message instead.
  const contractAddress =
    process.env.POLYGON_GOVERNANCE_CONTRACT ?? '0x0000000000000000000000000000000000000000';
  const isEvmAddress = (v: string): boolean => /^0x[0-9a-fA-F]{40}$/.test(v);
  if (!isEvmAddress(contractAddress)) {
    throw new Error(
      `POLYGON_GOVERNANCE_CONTRACT=${JSON.stringify(contractAddress)} is not a valid EVM 20-byte address; refusing to start worker-governance`,
    );
  }
  if (contractAddress === '0x0000000000000000000000000000000000000000') {
    logger.warn('POLYGON_GOVERNANCE_CONTRACT not deployed; running in idle mode');
  }

  const rpcUrl = process.env.POLYGON_RPC_URL ?? 'https://polygon-rpc.com';
  const db = await getDb();
  const repo = new GovernanceRepo(db);
  const findingRepo = new FindingRepo(db);
  const dossierRepo = new DossierRepo(db);
  const pool = await getPool();
  const chain = new HashChain(pool, logger);

  // Queue client for DOSSIER_RENDER publication on escalation.
  const queue = new QueueClient({ logger });
  await queue.ping();
  registerShutdown('queue', () => queue.close());

  const scraper = startRedisStreamScraper(queue, {
    streams: [STREAMS.DOSSIER_RENDER],
    logger,
  });
  registerShutdown('redis-stream-scraper', () => scraper.stop());

  const emit: FeatureFlagAuditEmit = async (event) => {
    await chain.append({
      action: event.action,
      actor: 'worker-governance',
      subject_kind: event.subject_kind,
      subject_id: event.subject_id,
      payload: event.payload,
    });
  };
  await auditFeatureFlagsAtBoot({ service: 'worker-governance', emit });

  const client = new GovernanceReadClient(rpcUrl, contractAddress, logger);

  // Vote-ceremony handlers extracted to ./vote-ceremony.ts so the
  // full ceremony flow is testable with mocked deps. See
  // apps/worker-governance/__tests__/council-vote-e2e.test.ts.
  const unsubscribe = client.watch(
    bindWatch({ repo, findingRepo, dossierRepo, chain, queue, logger }),
  );
  registerShutdown('unsubscribe', () => unsubscribe());

  await guard.markBootSuccess();
  logger.info({ contract: contractAddress }, 'worker-governance-ready');
}

main().catch((e: unknown) => {
  const err = e instanceof Error ? e : new Error(String(e));
  logger.error({ err_name: err.name, err_message: err.message }, 'fatal-startup');
  process.exit(1);
});
