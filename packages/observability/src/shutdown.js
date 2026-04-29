"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerShutdown = registerShutdown;
exports.installShutdownHandler = installShutdownHandler;
const callbacks = [];
let installed = false;
let shuttingDown = false;
function registerShutdown(name, cb) {
    callbacks.push({ name, cb });
}
function installShutdownHandler(logger, hardTimeoutMs = 30_000) {
    if (installed)
        return;
    installed = true;
    const handler = (signal) => {
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
        void (async () => {
            for (const { name, cb } of [...callbacks].reverse()) {
                try {
                    await cb();
                    logger.info({ name }, 'shutdown-callback-ok');
                }
                catch (e) {
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
//# sourceMappingURL=shutdown.js.map