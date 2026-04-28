/**
 * @vigil/db-postgres — Drizzle ORM schema + repos for VIGIL APEX Postgres.
 *
 * The Drizzle schema is the SOURCE of truth for the Postgres DDL.
 * Migrations are forward-only; rolling back means writing a new migration
 * that undoes (per SRD §07.1).
 */
export * from './client.js';
export * as schema from './schema/index.js';
export * from './repos/audit.js';
export * from './repos/dossier.js';
export * from './repos/entity.js';
export * from './repos/finding.js';
export * from './repos/source.js';
export * from './repos/governance.js';
export * from './repos/tip.js';
export * from './repos/calibration.js';
