/**
 * Hand-mirrored TS shapes of the proto messages in
 * `proto/federation.proto`. Kept in sync manually because we use
 * @grpc/proto-loader (dynamic loading) — there is no codegen step.
 *
 * If you change a field in the .proto, update this file in the
 * same commit.
 */

export const ALL_REGION_CODES = ['CE', 'LT', 'NW', 'SW', 'OU', 'SU', 'ES', 'EN', 'NO', 'AD'] as const;
export type RegionCode = (typeof ALL_REGION_CODES)[number];

export interface EventEnvelopeUnsigned {
  readonly envelopeId: string;
  readonly region: RegionCode;
  readonly sourceId: string;
  readonly dedupKey: string;
  readonly payload: Uint8Array;
  readonly observedAtMs: number;
}

export interface EventEnvelope extends EventEnvelopeUnsigned {
  readonly signature: Uint8Array;
  readonly signingKeyId: string;
}

export type RejectionCode =
  | 'SIGNATURE_INVALID'
  | 'REGION_MISMATCH'
  | 'REPLAY_WINDOW'
  | 'KEY_UNKNOWN'
  | 'DEDUP_COLLISION'
  | 'PAYLOAD_TOO_LARGE';

export interface RejectedEnvelope {
  readonly envelopeId: string;
  readonly code: RejectionCode;
  readonly detail?: string;
}

export interface PushAck {
  readonly accepted: readonly string[];
  readonly rejected: readonly RejectedEnvelope[];
  readonly ackedAtMs: number;
}

export interface HealthBeaconRequest {
  readonly region: RegionCode;
  readonly agentNowMs: number;
  readonly agentSeqTotal: number;
}

export interface HealthBeaconReply {
  readonly lastObservedAtMs: number;
  readonly coreNowMs: number;
  readonly throttleHintMs: number;
}

/**
 * Replay-window defaults. The receiver uses these unless overridden
 * by FederationStreamServerOptions.replayWindow.
 *
 * Forward window: 60 s — the agent's clock may be slightly ahead
 *   of the core (NTP drift). Anything more than 60 s in the future
 *   is treated as a clock-skew attack.
 * Backward window: 7 d — the federation queue retainHours default
 *   is 168 h, so 7 d aligns with how far back an agent can
 *   legitimately replay a backlog after a partition.
 */
export const DEFAULT_FORWARD_WINDOW_MS = 60_000;
export const DEFAULT_BACKWARD_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Per-envelope payload size cap. The federation-receiver rejects
 * envelopes whose `payload` exceeds this. Adapter producers that
 * need to ship larger blobs must shard at the adapter layer (the
 * federation stream is event-shaped, not blob-shaped).
 */
export const MAX_PAYLOAD_BYTES = 256 * 1024;
