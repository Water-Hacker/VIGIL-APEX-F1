import type { Logger } from './logger.js';

/**
 * Graceful shutdown harness.
 *
 * Workers and HTTP servers register cleanup callbacks here; on SIGTERM/SIGINT
 * the harness calls them in reverse-registration order with a hard 30s ceiling.
 */

type ShutdownCallback = () => Promise<void> | void;

const callbacks: Array<{ name: string; cb: ShutdownCallback }> = [];
let installed = false;
let shuttingDown = false;

export function registerShutdown(name: string, cb: ShutdownCallback): void {
  callbacks.push({ name, cb });
}

export function installShutdownHandler(logger: Logger, hardTimeoutMs = 30_000): void {
  if (installed) return;
  installed = true;

  const handler = (signal: NodeJS.Signals): void => {
    if (shuttingDown) {
      logger.warn({ signal }, 'second-signal-during-shutdown; forcing exit');
      process.exit(1);
    }
    shuttingDown = true;
    logger.info({ signal }, 'graceful-shutdown-start');

    const timer = setTimeout(() => {
      logger.error({ hardTimeoutMs }, 'graceful-shutdown-hard-timeout');
      process.exit(1);
    }, hardTimeoutMs);
    timer.unref();

    void (async (): Promise<void> => {
      for (const { name, cb } of [...callbacks].reverse()) {
        try {
          await cb();
          logger.info({ name }, 'shutdown-callback-ok');
        } catch (e) {
          logger.error({ name, err: e }, 'shutdown-callback-failed');
        }
      }
      clearTimeout(timer);
      logger.info('graceful-shutdown-complete');
      process.exit(0);
    })();
  };

  process.on('SIGTERM', handler);
  process.on('SIGINT', handler);
}
