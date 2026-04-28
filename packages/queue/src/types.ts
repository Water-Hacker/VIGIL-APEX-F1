import type { StreamName } from './streams.js';

/* =============================================================================
 * Envelope — every message on every stream is an Envelope<TPayload>.
 *
 * The envelope carries metadata (correlation, idempotency, timestamps); the
 * payload is opaque to the queue layer and validated by Zod at the worker.
 * ===========================================================================*/

export interface Envelope<TPayload> {
  /** Globally unique event ID (UUID). */
  readonly id: string;
  /** Deterministic per-input dedup key — same input ⇒ same key (SRD §11.5). */
  readonly dedup_key: string;
  /** Correlation ID propagated end-to-end. */
  readonly correlation_id: string;
  /** Producing worker / app name. */
  readonly producer: string;
  /** ISO timestamp when produced. */
  readonly produced_at: string;
  /** Schema version for the payload — bumped on breaking changes. */
  readonly schema_version: number;
  readonly payload: TPayload;
}

/** A pending message claimed from a stream — payload is still raw bytes. */
export interface ClaimedMessage {
  readonly stream: StreamName;
  /** Redis Streams ID, e.g. '1726512000000-0'. */
  readonly id: string;
  /** Raw envelope JSON; the worker parses + validates before calling handler. */
  readonly raw: string;
  /** Number of times this message has been delivered. */
  readonly delivery_count: number;
}

/** Result of a handler invocation. */
export type HandlerOutcome =
  | { kind: 'ack' } // success — XACK and move on
  | { kind: 'retry'; reason: string; delay_ms?: number } // transient failure
  | { kind: 'dead-letter'; reason: string }; // permanent — push to DLQ

export interface WorkerHandler<T> {
  (envelope: Envelope<T>): Promise<HandlerOutcome>;
}
