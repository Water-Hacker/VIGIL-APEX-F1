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

import { ProxyManager, AdapterRegistry, DailyRateLimiter, RobotsChecker } from '@vigil/adapters';
import {
  CalibrationAuditRepo,
  CallRecordRepo,
  PublicExportRepo,
  SatelliteRequestRepo,
  SourceRepo,
  VerbatimAuditRepo,
  getDb,
  getPool,
} from '@vigil/db-postgres';
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
import { SatelliteClient } from '@vigil/satellite-client';
import { VaultClient, expose } from '@vigil/security';
import { Constants, Schemas } from '@vigil/shared';
import { schedule, validate, ScheduledTask } from 'node-cron';

import { registerAllAdapters } from './adapters/_register.js';
import { runOne } from './run-one.js';
import {
  currentQuarterWindow,
  runCalibrationAudit,
} from './triggers/calibration-audit-runner.js';
import { runQuarterlyAuditExport } from './triggers/quarterly-audit-export.js';
import {
  defaultProviderChain,
  runSatelliteTrigger,
} from './triggers/satellite-trigger.js';
import { runVerbatimAuditSampler } from './triggers/verbatim-audit-sampler.js';

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

  // Proxy manager + adapter registry. Tor egress requires explicit host
  // configuration; refusing to silently fall back to localhost prevents the
  // tier-3 escalation path from "succeeding" against a local socket that
  // doesn't exist (silent ECONNREFUSED → adapter-down).
  const torEnabled = process.env.PROXY_TOR_ENABLED === '1';
  if (torEnabled && !process.env.PROXY_TOR_SOCKS_HOST) {
    throw new Error(
      'PROXY_TOR_ENABLED=1 requires PROXY_TOR_SOCKS_HOST; refusing to default to localhost',
    );
  }
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

  // Tier 3 hardening — rate-limit + robots.txt enforcement (Tier 3, W-13).
  const rateLimiter = new DailyRateLimiter(queue.redis);
  const robotsChecker = new RobotsChecker(queue.redis);

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
          rateLimiter,
          robotsChecker,
        }).catch((e) => logger.error({ err: e, source: src.id }, 'run-one-failed'));
      },
      { timezone: 'Africa/Douala', scheduled: true },
    );
    tasks.push(task);
    logger.info({ source: src.id, cron: src.cron }, 'adapter-scheduled');
  }

  // DECISION-010 — satellite-trigger cron. Daily by default. Can be disabled
  // entirely with SATELLITE_TRIGGER_ENABLED=false.
  const satelliteTriggerEnabled =
    (process.env.SATELLITE_TRIGGER_ENABLED ?? 'true').toLowerCase() !== 'false';
  if (satelliteTriggerEnabled) {
    const cron = process.env.SATELLITE_TRIGGER_CRON ?? '0 2 * * *'; // 02:00 Africa/Douala
    if (validate(cron)) {
      const satelliteClient = new SatelliteClient(queue);
      const trackingRepo = new SatelliteRequestRepo(db);
      const bufferMeters = Number(process.env.SATELLITE_AOI_BUFFER_METERS ?? '500');
      const maxCloudPct = Number(process.env.SATELLITE_MAX_CLOUD_PCT ?? '20');
      const maxCostUsd = Number(process.env.SATELLITE_MAX_COST_PER_REQUEST_USD ?? '0');
      const providers = defaultProviderChain();
      const satelliteTask = schedule(
        cron,
        () => {
          void runSatelliteTrigger({
            db,
            satellite: satelliteClient,
            trackingRepo,
            logger,
            bufferMeters,
            maxCloudPct,
            maxCostUsd,
            providers,
          }).catch((e) => logger.error({ err: e }, 'satellite-trigger-failed'));
        },
        { timezone: 'Africa/Douala', scheduled: true },
      );
      tasks.push(satelliteTask);
      logger.info({ cron, providers, bufferMeters }, 'satellite-trigger-scheduled');

  // DECISION-011 — verbatim audit sampler. Daily 5% sampler.
  const sampleEnabled = (process.env.VERBATIM_SAMPLER_ENABLED ?? 'true').toLowerCase() !== 'false';
  if (sampleEnabled) {
    const cron = process.env.VERBATIM_SAMPLER_CRON ?? '15 3 * * *'; // 03:15 daily
    if (validate(cron)) {
      const callRecords = new CallRecordRepo(db);
      const verbatim = new VerbatimAuditRepo(db);
      const fraction = Number(process.env.VERBATIM_SAMPLER_FRACTION ?? '0.05');
      const samplerTask = schedule(
        cron,
        () => {
          void runVerbatimAuditSampler({
            db,
            callRecords,
            verbatim,
            logger,
            fraction,
            windowHours: 24,
          }).catch((e) => logger.error({ err: e }, 'verbatim-sampler-failed'));
        },
        { timezone: 'Africa/Douala', scheduled: true },
      );
      tasks.push(samplerTask);
      logger.info({ cron, fraction }, 'verbatim-audit-sampler-scheduled');
    }
  }

  // DECISION-011 — calibration audit runner. Quarterly (1st of next month after quarter end).
  const calEnabled = (process.env.CALIBRATION_AUDIT_ENABLED ?? 'true').toLowerCase() !== 'false';
  if (calEnabled) {
    const cron = process.env.CALIBRATION_AUDIT_CRON ?? '0 4 1 1,4,7,10 *'; // 04:00 first day of each quarter
    if (validate(cron)) {
      const auditRepo = new CalibrationAuditRepo(db);
      const calTask = schedule(
        cron,
        () => {
          void (async () => {
            // Audit the just-completed quarter.
            const now = new Date();
            const lastQuarterRef = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15));
            const window = currentQuarterWindow(lastQuarterRef);
            try {
              const pool = await getPool();
              await runCalibrationAudit({
                db,
                pool,
                audit: auditRepo,
                logger,
                periodLabel: window.periodLabel,
                periodStart: window.periodStart,
                periodEnd: window.periodEnd,
              });
            } catch (err) {
              logger.error({ err }, 'calibration-audit-failed');
            }
          })();
        },
        { timezone: 'Africa/Douala', scheduled: true },
      );
      tasks.push(calTask);
      logger.info({ cron }, 'calibration-audit-runner-scheduled');
    }
  }

  // DECISION-012 — TAL-PA quarterly anonymised export. Pins the prior
  // quarter's audit log to IPFS and emits an audit-of-audit row.
  const exportEnabled =
    (process.env.AUDIT_PUBLIC_EXPORT_ENABLED ?? 'true').toLowerCase() !== 'false';
  if (exportEnabled) {
    const exportCron = process.env.AUDIT_PUBLIC_EXPORT_CRON ?? '0 5 1 1,4,7,10 *';
    if (validate(exportCron)) {
      const exportRepo = new PublicExportRepo(db);
      const exportTask = schedule(
        exportCron,
        () => {
          void (async () => {
            try {
              const pool = await getPool();
              await runQuarterlyAuditExport({ db, pool, exportRepo, logger });
            } catch (err) {
              logger.error({ err }, 'audit-public-export-failed');
            }
          })();
        },
        { timezone: 'Africa/Douala', scheduled: true },
      );
      tasks.push(exportTask);
      logger.info({ cron: exportCron }, 'audit-public-export-scheduled');
    } else {
      logger.error({ cron: exportCron }, 'invalid-audit-public-export-cron; trigger disabled');
    }
  }
    } else {
      logger.error({ cron }, 'invalid-satellite-trigger-cron; trigger disabled');
    }
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
