import type { Logger } from './logger.js';
/**
 * Graceful shutdown harness.
 *
 * Workers and HTTP servers register cleanup callbacks here; on SIGTERM/SIGINT
 * the harness calls them in reverse-registration order with a hard 30s ceiling.
 */
type ShutdownCallback = () => Promise<void> | void;
export declare function registerShutdown(name: string, cb: ShutdownCallback): void;
export declare function installShutdownHandler(logger: Logger, hardTimeoutMs?: number): void;
export {};
//# sourceMappingURL=shutdown.d.ts.map