import { HashChain } from '@vigil/audit-chain';
import { DossierRepo, FindingRepo, GovernanceRepo, getDb, getPool } from '@vigil/db-postgres';
import { GovernanceReadClient } from '@vigil/governance';
import {
  createLogger,
  installShutdownHandler,
  initTracing,
  shutdownTracing,
  startMetricsServer,
  registerShutdown,
} from '@vigil/observability';
import { QueueClient } from '@vigil/queue';

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
  await initTracing({ service: 'worker-governance' });
  const metrics = await startMetricsServer();
  registerShutdown('metrics', () => metrics.close());
  installShutdownHandler(logger);
  registerShutdown('tracing', shutdownTracing);

  const contractAddress =
    process.env.POLYGON_GOVERNANCE_CONTRACT ?? '0x0000000000000000000000000000000000000000';
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
  registerShutdown('queue', () => queue.close());

  const client = new GovernanceReadClient(rpcUrl, contractAddress, logger);

  // Vote-ceremony handlers extracted to ./vote-ceremony.ts so the
  // full ceremony flow is testable with mocked deps. See
  // apps/worker-governance/__tests__/council-vote-e2e.test.ts.
  const unsubscribe = client.watch(
    bindWatch({ repo, findingRepo, dossierRepo, chain, queue, logger }),
  );
  registerShutdown('unsubscribe', () => unsubscribe());

  logger.info({ contract: contractAddress }, 'worker-governance-ready');
}

main().catch((e: unknown) => {
  logger.error({ err: e }, 'fatal-startup');
  process.exit(1);
});
