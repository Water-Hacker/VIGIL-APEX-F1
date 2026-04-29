/**
 * Drizzle schema barrel — every table the MVP uses.
 *
 * Schemas (Postgres-native namespaces):
 *   source       — adapter outputs, document store, robots/proxy state
 *   entity       — canonical entities, aliases, relationships
 *   finding      — findings, signals, evidence links
 *   dossier      — dossier records, referrals
 *   governance   — proposals, votes, council members
 *   audit        — hash-chained action log + anchor commitments
 *   tip          — anonymous citizen tips
 *   calibration  — historical case ground truth + reports
 */
export * from './source.js';
export * from './entity.js';
export * from './finding.js';
export * from './dossier.js';
export * from './governance.js';
export * from './audit.js';
export * from './tip.js';
export * from './calibration.js';
export * from './certainty.js';
