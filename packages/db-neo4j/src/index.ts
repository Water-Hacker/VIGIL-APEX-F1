/**
 * @vigil/db-neo4j — Bolt client + custom GDS.
 *
 * Per SRD §08: Postgres is authoritative; Neo4j is rebuilt from Postgres.
 * Neo4j Community Edition lacks the official GDS library, so we reimplement
 * what we need in TypeScript.
 */
export * from './client.js';
export * from './gds/page-rank.js';
export * from './gds/louvain.js';
export * from './gds/node-similarity.js';
export * from './queries.js';
