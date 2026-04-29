import pino, { type Logger as PinoLogger } from 'pino';
export interface VigilLoggerOptions {
    readonly service: string;
    readonly level?: pino.LevelWithSilent;
    readonly extraBindings?: Record<string, unknown>;
}
export declare function createLogger(opts: VigilLoggerOptions): PinoLogger;
export type Logger = PinoLogger;
//# sourceMappingURL=logger.d.ts.map