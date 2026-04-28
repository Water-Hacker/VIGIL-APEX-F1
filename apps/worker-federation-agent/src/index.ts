import {
  ALL_REGION_CODES,
  FederationStreamClient,
  type RegionCode,
} from '@vigil/federation-stream';
import {
  createLogger,
  installShutdownHandler,
  initTracing,
  registerShutdown,
  shutdownTracing,
  startMetricsServer,
} from '@vigil/observability';
import { QueueClient } from '@vigil/queue';

import { FederationAgentWorker } from './worker.js';

const logger = createLogger({ service: 'worker-federation-agent' });

/**
 * worker-federation-agent — regional Phase-3 component.
 *
 * Required env vars (set by the regional Helm chart's
 * federation-agent Deployment, see infra/k8s/charts/regional-node):
 *
 *   VIGIL_REGION_CODE          two-letter region (CE, LT, NW, ...)
 *   VIGIL_SIGNING_KEY_ID       Vault PKI key id, e.g. "CE:1"
 *   FEDERATION_CORE_ENDPOINT   host:port (e.g. vigil-federation.core.vigilapex.cm:9443)
 *   FEDERATION_TLS_ROOT        path to the Yaoundé core's TLS root cert
 *   FEDERATION_SIGNING_KEY     path to the regional ed25519 PEM private key
 *   REDIS_URL                  inherited by QueueClient
 *
 * Optional:
 *   FEDERATION_BATCH_SIZE      default 256
 *   FEDERATION_BATCH_MS        default 2000
 */

function readRegion(): RegionCode {
  const raw = process.env.VIGIL_REGION_CODE;
  if (!raw) {
    throw new Error('VIGIL_REGION_CODE is required');
  }
  if (!(ALL_REGION_CODES as readonly string[]).includes(raw)) {
    throw new Error(`VIGIL_REGION_CODE=${raw} is not a known region`);
  }
  return raw as RegionCode;
}

async function main(): Promise<void> {
  await initTracing({ service: 'worker-federation-agent' });
  const metrics = await startMetricsServer();
  registerShutdown('metrics', () => metrics.close());
  installShutdownHandler(logger);
  registerShutdown('tracing', shutdownTracing);

  const region = readRegion();
  const signingKeyId = process.env.VIGIL_SIGNING_KEY_ID;
  const coreEndpoint = process.env.FEDERATION_CORE_ENDPOINT;
  const tlsRootCertPath = process.env.FEDERATION_TLS_ROOT;
  const signingPrivateKeyPath = process.env.FEDERATION_SIGNING_KEY;

  if (!signingKeyId || !coreEndpoint || !tlsRootCertPath || !signingPrivateKeyPath) {
    throw new Error(
      'VIGIL_SIGNING_KEY_ID, FEDERATION_CORE_ENDPOINT, FEDERATION_TLS_ROOT, and FEDERATION_SIGNING_KEY are all required',
    );
  }

  const queue = new QueueClient({ logger });
  await queue.ping();
  registerShutdown('queue', () => queue.close());

  const client = new FederationStreamClient({
    coreEndpoint,
    tlsRootCertPath,
    region,
    signingKeyId,
    signingPrivateKeyPath,
    batchSize: Number(process.env.FEDERATION_BATCH_SIZE ?? 256),
    batchIntervalMs: Number(process.env.FEDERATION_BATCH_MS ?? 2000),
    logger,
  });
  client.start();
  registerShutdown('federation-client', () => client.close());

  const worker = new FederationAgentWorker({ client, queue, logger, region });
  await worker.start();
  registerShutdown('worker', () => worker.stop());
  logger.info({ region, signingKeyId, coreEndpoint }, 'worker-federation-agent-ready');
}

main().catch((e: unknown) => {
  logger.error({ err: e }, 'fatal-startup');
  process.exit(1);
});
