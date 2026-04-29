"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createLogger = createLogger;
const api_1 = require("@opentelemetry/api");
const pino_1 = __importDefault(require("pino"));
const correlation_js_1 = require("./correlation.js");
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
function correlationMixin() {
    const out = {};
    const span = api_1.trace.getSpan(api_1.context.active());
    if (span) {
        const sc = span.spanContext();
        if (sc.traceId !== '00000000000000000000000000000000') {
            out['trace_id'] = sc.traceId;
            out['span_id'] = sc.spanId;
        }
    }
    const cid = (0, correlation_js_1.getCorrelationId)();
    if (cid)
        out['correlation_id'] = cid;
    const wname = (0, correlation_js_1.getWorkerName)();
    if (wname)
        out['worker'] = wname;
    return out;
}
function createLogger(opts) {
    const baseOpts = {
        level: opts.level ?? process.env.LOG_LEVEL ?? 'info',
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
        timestamp: pino_1.default.stdTimeFunctions.isoTime,
        formatters: {
            level: (label) => ({ level: label }),
            bindings: (b) => ({ pid: b['pid'], hostname: b['hostname'] }),
        },
        mixin: correlationMixin,
    };
    if (isProd) {
        return (0, pino_1.default)(baseOpts);
    }
    return (0, pino_1.default)({
        ...baseOpts,
        transport: {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'SYS:standard' },
        },
    });
}
//# sourceMappingURL=logger.js.map