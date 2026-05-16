import {
  auditFeatureFlagsAtBoot,
  createLogger,
  installShutdownHandler,
  initTracing,
  shutdownTracing,
  startMetricsServer,
  registerShutdown,
  type FeatureFlagAuditEmit,
} from '@vigil/observability';

import { createAuditBridgeServer } from './server.js';

const logger = createLogger({ service: 'audit-bridge' });

async function main(): Promise<void> {
  await initTracing({ service: 'audit-bridge' });
  const metrics = await startMetricsServer();
  registerShutdown('metrics', () => metrics.close());
  installShutdownHandler(logger);
  registerShutdown('tracing', shutdownTracing);

  const emit: FeatureFlagAuditEmit = async (event) => {
    logger.info(
      { flag: event.subject_id, payload: event.payload },
      'feature-flag-snapshot (no audit chain available)',
    );
  };
  await auditFeatureFlagsAtBoot({ service: 'audit-bridge', emit });

  const socketPath = process.env.AUDIT_BRIDGE_SOCKET ?? '/run/vigil/audit-bridge.sock';
  const server = await createAuditBridgeServer({ logger, socketPath });
  await server.start();
  registerShutdown('audit-bridge', () => server.stop());
  logger.info({ socketPath }, 'audit-bridge-ready');
}

main().catch((err: unknown) => {
  logger.error({ err }, 'fatal-startup');
  process.exit(1);
});
