/**
 * @vigil/adapters — adapter base + 26 source adapters.
 *
 * SRD §11. Each adapter implements `Adapter` and is registered in
 * `infra/sources.json`. The `AdapterRunner` (apps/adapter-runner) loads them
 * on startup and schedules per cron.
 */
export * from './base.js';
export * from './registry.js';
export * from './proxy.js';
export * from './fingerprint.js';
export * from './first-contact.js';
export * from './rate-limit.js';
export * from './robots.js';
export * from './backoff.js';
