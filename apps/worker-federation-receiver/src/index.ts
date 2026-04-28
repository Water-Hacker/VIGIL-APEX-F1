import { FederationStreamServer } from '@vigil/federation-stream';
import {
  createLogger,
  installShutdownHandler,
  initTracing,
  registerShutdown,
  shutdownTracing,
  startMetricsServer,
} from '@vigil/observability';
import { QueueClient } from '@vigil/queue';
import IORedis from 'ioredis';

import { FederationReceiverHandlers } from './handlers.js';
import { DirectoryKeyResolver } from './key-resolver.js';

const logger = createLogger({ service: 'worker-federation-receiver' });

/**
 * worker-federation-receiver — core-side Phase-3 component.
 *
 * Required env vars:
 *   FEDERATION_LISTEN          host:port (default 0.0.0.0:9443)
 *   FEDERATION_TLS_CERT        path to the core's gRPC TLS cert
 *   FEDERATION_TLS_KEY         path to the core's gRPC TLS key
 *   FEDERATION_KEY_DIR         directory of <REGION>:<seq>.pem pubkeys
 *                              (loaded at boot by DirectoryKeyResolver)
 *   REDIS_URL                  inherited by QueueClient + ioredis
 *
 * Optional:
 *   FEDERATION_CLIENT_CA       path to mTLS client CA (turns mTLS on
 *                              when set; matches the regional Vault
 *                              subordinate's published intermediate)
 *   FEDERATION_THROTTLE_HINT_MS  uniform backpressure hint (default 0)
 */

async function main(): Promise<void> {
  await initTracing({ service: 'worker-federation-receiver' });
  const metrics = await startMetricsServer();
  registerShutdown('metrics', () => metrics.close());
  installShutdownHandler(logger);
  registerShutdown('tracing', shutdownTracing);

  const listenAddress = process.env.FEDERATION_LISTEN ?? '0.0.0.0:9443';
  const tlsCertPath = process.env.FEDERATION_TLS_CERT;
  const tlsKeyPath = process.env.FEDERATION_TLS_KEY;
  const keyDir = process.env.FEDERATION_KEY_DIR;

  if (!tlsCertPath || !tlsKeyPath || !keyDir) {
    throw new Error(
      'FEDERATION_TLS_CERT, FEDERATION_TLS_KEY, and FEDERATION_KEY_DIR are all required',
    );
  }

  const queue = new QueueClient({ logger });
  await queue.ping();
  registerShutdown('queue', () => queue.close());

  const redis = new IORedis(process.env.REDIS_URL ?? 'redis://vigil-redis:6379');
  registerShutdown('redis', async () => {
    redis.disconnect();
  });

  const keyResolver = new DirectoryKeyResolver(keyDir, logger);
  const loaded = await keyResolver.load();
  if (loaded === 0) {
    logger.warn(
      { keyDir },
      'federation-key-resolver-empty (no per-region pubkeys loaded; receiver will reject every envelope)',
    );
  }

  const handlers = new FederationReceiverHandlers({
    queue,
    redis,
    logger,
    throttleHintMs: Number(process.env.FEDERATION_THROTTLE_HINT_MS ?? 0),
  });

  const serverOpts: ConstructorParameters<typeof FederationStreamServer>[0] = {
    listenAddress,
    tlsCertPath,
    tlsKeyPath,
    keyResolver,
    handlers,
    logger,
  };
  if (process.env.FEDERATION_CLIENT_CA) {
    (serverOpts as { clientCaPath?: string }).clientCaPath = process.env.FEDERATION_CLIENT_CA;
  }

  const server = new FederationStreamServer(serverOpts);
  await server.start();
  registerShutdown('federation-server', () => server.stop());
  logger.info({ listenAddress, keysLoaded: loaded }, 'worker-federation-receiver-ready');
}

main().catch((e: unknown) => {
  logger.error({ err: e }, 'fatal-startup');
  process.exit(1);
});
