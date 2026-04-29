"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.withCorrelation = withCorrelation;
exports.getCorrelationId = getCorrelationId;
exports.getWorkerName = getWorkerName;
exports.newCorrelationId = newCorrelationId;
const node_async_hooks_1 = require("node:async_hooks");
const node_crypto_1 = require("node:crypto");
const als = new node_async_hooks_1.AsyncLocalStorage();
function withCorrelation(correlationId, worker, fn) {
    return als.run({ correlationId, ...(worker !== undefined && { worker }) }, fn);
}
function getCorrelationId() {
    return als.getStore()?.correlationId;
}
function getWorkerName() {
    return als.getStore()?.worker;
}
function newCorrelationId() {
    return (0, node_crypto_1.randomUUID)();
}
//# sourceMappingURL=correlation.js.map