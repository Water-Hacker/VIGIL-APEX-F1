"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * @vigil/observability — root barrel.
 *
 * Per SRD §15.6: every worker exposes `/metrics` (Prometheus), structured
 * JSON logs via pino with `trace_id, span_id, event_id, worker` propagated,
 * and OpenTelemetry traces over OTLP/HTTP.
 */
__exportStar(require("./logger.js"), exports);
__exportStar(require("./metrics.js"), exports);
__exportStar(require("./tracing.js"), exports);
__exportStar(require("./correlation.js"), exports);
__exportStar(require("./shutdown.js"), exports);
//# sourceMappingURL=index.js.map