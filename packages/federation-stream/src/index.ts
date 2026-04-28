/**
 * @vigil/federation-stream — Phase-3 federation event stream.
 *
 * Three consumers:
 *   - apps/worker-federation-agent (regional) — uses
 *     FederationStreamClient to push signed envelopes to the core.
 *   - apps/worker-federation-receiver (core) — uses
 *     FederationStreamServer to receive, verify, and forward into
 *     the core's ingestion pipeline.
 *   - apps/audit-verifier — uses the canonical signing helpers in
 *     sign.ts to re-verify archived envelopes against the
 *     subordinate CAs that signed them.
 *
 * The .proto file in proto/federation.proto is authoritative. Any
 * change to the wire format requires an architect decision in
 * docs/decisions/log.md AND a coordinated rotation of every
 * regional federation-agent.
 */

export {
  ALL_REGION_CODES,
  DEFAULT_BACKWARD_WINDOW_MS,
  DEFAULT_FORWARD_WINDOW_MS,
  MAX_PAYLOAD_BYTES,
  type EventEnvelope,
  type EventEnvelopeUnsigned,
  type HealthBeaconReply,
  type HealthBeaconRequest,
  type PushAck,
  type RegionCode,
  type RejectedEnvelope,
  type RejectionCode,
} from './types.js';

export {
  canonicalSigningBytes,
  signEnvelope,
  verifyEnvelope,
} from './sign.js';

export {
  StaticKeyResolver,
  verifyEnvelopeWithPolicy,
  type KeyResolver,
  type ReceiverPolicy,
  type VerificationResult,
} from './verify.js';

export {
  FederationStreamClient,
  type FederationClientOptions,
} from './client.js';

export {
  FederationStreamServer,
  type FederationServerOptions,
  type ReceiverHandlers,
} from './server.js';
