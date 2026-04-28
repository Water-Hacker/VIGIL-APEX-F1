/**
 * @vigil/queue — Redis Streams idempotent-consumer base.
 *
 * SRD §15 contract: every worker class follows the same external contract:
 *   1. Consume from a single Redis stream in a named consumer group
 *   2. Process each event through a stateless handler function
 *   3. Persist results to PostgreSQL within a transaction
 *   4. Emit one or more downstream events to other streams AFTER tx commits
 *   5. ACK the input event LAST
 *
 * This ordering (DB commit → stream emit → ACK) gives at-least-once semantics
 * with deterministic dedup_keys at the next consumer.
 */
export * from './client.js';
export * from './worker.js';
export * from './streams.js';
export * from './types.js';
