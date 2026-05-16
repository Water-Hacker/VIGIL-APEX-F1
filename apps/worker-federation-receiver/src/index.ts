import { FederationStreamServer } from '@vigil/federation-stream';
import {
  StartupGuard,
  auditFeatureFlagsAtBoot,
  createLogger,
  installShutdownHandler,
  initTracing,
  registerShutdown,
  shutdownTracing,
  startMetricsServer,
  type FeatureFlagAuditEmit,
} from '@vigil/observability';
import { QueueClient, STREAMS, startRedisStreamScraper } from '@vigil/queue';
import IORedis from 'ioredis';

import { FederationReceiverHandlers } from './handlers.js';
import { DirectoryKeyResolver, LayeredKeyResolver, VaultPkiKeyResolver } from './key-resolver.js';

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
  const guard = new StartupGuard({ serviceName: 'worker-federation-receiver', logger });
  await guard.check();

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

  const scraper = startRedisStreamScraper(queue, {
    streams: [STREAMS.ADAPTER_OUT],
    logger,
  });
  registerShutdown('redis-stream-scraper', () => scraper.stop());

  const emit: FeatureFlagAuditEmit = async (event) => {
    logger.info(
      { flag: event.subject_id, payload: event.payload },
      'feature-flag-snapshot (no audit chain available)',
    );
  };
  await auditFeatureFlagsAtBoot({ service: 'worker-federation-receiver', emit });

  const redis = new IORedis(process.env.REDIS_URL ?? 'redis://vigil-redis:6379');
  registerShutdown('redis', async () => {
    redis.disconnect();
  });

  // The directory resolver is always present — it carries the bootstrap
  // pubkeys the architect copied during the per-region cutover ceremony.
  const directoryResolver = new DirectoryKeyResolver(keyDir, logger);
  const loaded = await directoryResolver.load();
  if (loaded === 0) {
    logger.warn(
      { keyDir },
      'federation-key-resolver-empty (no per-region pubkeys loaded; receiver may reject envelopes until Vault PKI succeeds)',
    );
  }

  // VaultPkiKeyResolver — primary, live source of truth. Enabled when
  // VAULT_ADDR + VAULT_TOKEN_FILE are configured (post-R9 cutover).
  // The directory layer remains as a deterministic fallback so the
  // receiver keeps verifying envelopes during a Vault outage.
  const vaultAddr = process.env.VAULT_ADDR;
  const vaultTokenFile = process.env.VAULT_TOKEN_FILE;
  const vaultEnabled = vaultAddr !== undefined && vaultTokenFile !== undefined;
  let keyResolver;
  if (vaultEnabled) {
    const { readFile } = await import('node:fs/promises');
    const token = (await readFile(vaultTokenFile, 'utf8')).trim();
    const ttlMs = Number(process.env.FEDERATION_KEY_CACHE_TTL_MS ?? 3_600_000);
    const httpTimeoutMs = Number(process.env.FEDERATION_KEY_HTTP_TIMEOUT_MS ?? 5_000);
    const namespace = process.env.VAULT_NAMESPACE;
    const vaultResolver = new VaultPkiKeyResolver({
      vaultAddr,
      token,
      cacheTtlMs: ttlMs,
      httpTimeoutMs,
      logger,
      ...(namespace !== undefined && { namespace }),
    });
    keyResolver = new LayeredKeyResolver([vaultResolver, directoryResolver]);
    logger.info(
      { vaultAddr, ttlMs, httpTimeoutMs },
      'federation-key-resolver-layered (vault primary, directory fallback)',
    );
  } else {
    keyResolver = directoryResolver;
    logger.info(
      'federation-key-resolver-directory-only (set VAULT_ADDR + VAULT_TOKEN_FILE to enable Vault PKI)',
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

  await guard.markBootSuccess();
  logger.info({ listenAddress, keysLoaded: loaded }, 'worker-federation-receiver-ready');
}

main().catch((e: unknown) => {
  logger.error({ err: e }, 'fatal-startup');
  process.exit(1);
});
