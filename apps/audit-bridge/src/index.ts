import {
  createLogger,
  installShutdownHandler,
  initTracing,
  shutdownTracing,
  startMetricsServer,
  registerShutdown,
} from '@vigil/observability';

import { createAuditBridgeServer } from './server.js';

const logger = createLogger({ service: 'audit-bridge' });

async function main(): Promise<void> {
  await initTracing({ service: 'audit-bridge' });
  const metrics = await startMetricsServer();
  registerShutdown('metrics', () => metrics.close());
  installShutdownHandler(logger);
  registerShutdown('tracing', shutdownTracing);

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
