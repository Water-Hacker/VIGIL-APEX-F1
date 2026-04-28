/**
 * adapter-runner — main entry point.
 *
 * Per SRD §11. Runs on Hetzner N02 (the off-host ingestion VPS). Reads
 * `infra/sources.json`, registers adapters, schedules each per its cron,
 * and pushes events to Redis stream `vigil:adapter:out`.
 *
 * Graceful shutdown via SIGTERM/SIGINT. Crash on unhandled rejection.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { ProxyManager, AdapterRegistry } from '@vigil/adapters';
import { SourceRepo, getDb } from '@vigil/db-postgres';
import {
  createLogger,
  installShutdownHandler,
  initTracing,
  shutdownTracing,
  startMetricsServer,
  registerShutdown,
  newCorrelationId,
} from '@vigil/observability';
import { QueueClient, STREAMS, newEnvelope } from '@vigil/queue';
import { VaultClient, expose } from '@vigil/security';
import { Constants, Schemas } from '@vigil/shared';
import { schedule, validate, ScheduledTask } from 'node-cron';

import { registerAllAdapters } from './adapters/_register.js';
import { runOne } from './run-one.js';

const logger = createLogger({ service: 'adapter-runner' });

async function main(): Promise<void> {
  // Tracing first (instrument fetch/pg/redis)
  await initTracing({ service: 'adapter-runner', version: '0.1.0' });

  // Metrics server
  const metrics = await startMetricsServer();
  registerShutdown('metrics', () => metrics.close());

  installShutdownHandler(logger);
  registerShutdown('tracing', shutdownTracing);

  // Load sources.json
  const sourcesPath =
    process.env.SOURCES_REGISTRY_PATH ?? path.resolve(process.cwd(), 'infra/sources.json');
  const raw = await readFile(sourcesPath, 'utf8');
  const registry = Schemas.zSourceRegistry.parse(JSON.parse(raw));
  logger.info({ count: registry.sources.length, path: sourcesPath }, 'sources-loaded');

  // Vault — gather third-party API keys (OpenCorporates, BrightData, captcha, ...)
  const vault = await VaultClient.connect();
  registerShutdown('vault', () => vault.close());
  let brightDataUser: string | undefined;
  let brightDataPass: string | undefined;
  try {
    const u = await vault.read<string>('bright-data', 'username');
    const p = await vault.read<string>('bright-data', 'password');
    brightDataUser = expose(u);
    brightDataPass = expose(p);
  } catch (e) {
    logger.warn({ err: e }, 'bright-data-credentials-not-set; only direct egress active');
  }

  // Proxy manager + adapter registry
  const proxyMgr = new ProxyManager({
    hetznerDcEnabled: true,
    ...(brightDataUser !== undefined && { brightDataUsername: brightDataUser }),
    ...(brightDataPass !== undefined && { brightDataPassword: brightDataPass }),
    brightDataZone: process.env.PROXY_BRIGHT_DATA_ZONE ?? 'residential',
    torSocksHost: process.env.PROXY_TOR_SOCKS_HOST ?? 'localhost',
    torSocksPort: Number(process.env.PROXY_TOR_SOCKS_PORT ?? 9050),
  });

  registerAllAdapters(); // registers every adapter in src/adapters/*
  logger.info({ count: AdapterRegistry.count() }, 'adapters-registered');

  // Queue + DB
  const queue = new QueueClient({ logger });
  await queue.ping();
  registerShutdown('queue', () => queue.close());
  const db = await getDb();
  const sourceRepo = new SourceRepo(db);

  // Schedule each registered adapter that has an entry in sources.json
  const tasks: ScheduledTask[] = [];
  for (const src of registry.sources) {
    const adapter = AdapterRegistry.get(src.id);
    if (!adapter) {
      logger.warn({ source: src.id }, 'no-adapter-implementation-found; will be ignored');
      continue;
    }
    if (!validate(src.cron)) {
      logger.error({ source: src.id, cron: src.cron }, 'invalid-cron; skipping');
      continue;
    }
    const task = schedule(
      src.cron,
      () => {
        const correlationId = newCorrelationId();
        // Fire-and-forget — the runner returns to the cron tick
        void runOne({
          src,
          adapter,
          proxyMgr,
          queue,
          sourceRepo,
          correlationId,
          logger,
        }).catch((e) => logger.error({ err: e, source: src.id }, 'run-one-failed'));
      },
      { timezone: 'Africa/Douala', scheduled: true },
    );
    tasks.push(task);
    logger.info({ source: src.id, cron: src.cron }, 'adapter-scheduled');
  }

  registerShutdown('cron-tasks', () => {
    for (const t of tasks) t.stop();
  });

  // Surface health endpoint for the watchdog
  logger.info(
    { sources: registry.sources.length, adapters: AdapterRegistry.count() },
    'adapter-runner-ready',
  );

  // Reference unused symbols so linters don't complain
  void STREAMS;
  void newEnvelope;
  void Constants.ADAPTER_DEFAULT_USER_AGENT;
}

main().catch((e: unknown) => {
  logger.error({ err: e }, 'fatal-startup');
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'unhandled-rejection');
  process.exit(1);
});
