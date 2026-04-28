import { context, trace } from '@opentelemetry/api';
import pino, { type Logger as PinoLogger, type LoggerOptions } from 'pino';

import { getCorrelationId, getWorkerName } from './correlation.js';

/**
 * Structured logger for VIGIL APEX.
 *
 * Always JSON in production. Pretty in development. Every log line includes:
 *   - service: the calling app/package name
 *   - phase: VIGIL_PHASE (0..6)
 *   - trace_id / span_id: from active OTel context if any
 *   - hostname, pid, ts
 *
 * SRD §15.6 contract.
 */

const isProd = process.env.NODE_ENV === 'production';

export interface VigilLoggerOptions {
  readonly service: string;
  readonly level?: pino.LevelWithSilent;
  readonly extraBindings?: Record<string, unknown>;
}

/**
 * Mixin that injects OTel trace_id / span_id AND the AsyncLocalStorage
 * correlation_id into every record (Phase E5). The correlation_id
 * crosses Redis envelope boundaries (worker reads `envelope.correlation_id`
 * and calls `withCorrelation(...)` before invoking the handler), so a
 * single tip submission can be followed across worker-document →
 * worker-entity → worker-pattern → worker-score → worker-counter-evidence
 * → worker-dossier → worker-anchor → worker-conac-sftp without trace
 * gaps when the OTel exporter isn't reachable.
 */
function correlationMixin(): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  const span = trace.getSpan(context.active());
  if (span) {
    const sc = span.spanContext();
    if (sc.traceId !== '00000000000000000000000000000000') {
      out['trace_id'] = sc.traceId;
      out['span_id'] = sc.spanId;
    }
  }
  const cid = getCorrelationId();
  if (cid) out['correlation_id'] = cid;
  const wname = getWorkerName();
  if (wname) out['worker'] = wname;
  return out;
}

export function createLogger(opts: VigilLoggerOptions): PinoLogger {
  const baseOpts: LoggerOptions = {
    level: opts.level ?? (process.env.LOG_LEVEL as pino.Level | undefined) ?? 'info',
    base: {
      service: opts.service,
      phase: process.env.VIGIL_PHASE ?? '0',
      env: process.env.NODE_ENV ?? 'development',
      ...opts.extraBindings,
    },
    redact: {
      paths: [
        'password',
        '*.password',
        'token',
        '*.token',
        'authorization',
        'headers.authorization',
        'headers["x-api-key"]',
        'pin',
        '*.pin',
        '*.private_key',
        '*.private_key_b64',
        'secret',
        '*.secret',
      ],
      censor: '[REDACTED]',
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: (label) => ({ level: label }),
      bindings: (b) => ({ pid: b['pid'], hostname: b['hostname'] }),
    },
    mixin: correlationMixin,
  };

  if (isProd) {
    return pino(baseOpts);
  }

  return pino({
    ...baseOpts,
    transport: {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'SYS:standard' },
    },
  });
}

export type Logger = PinoLogger;
