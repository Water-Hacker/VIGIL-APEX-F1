/**
 * Stream name constants — single source of truth for every Redis stream the
 * pipeline uses. Workers reference these symbols, never strings.
 */
export const STREAMS = {
  // Ring 1
  ADAPTER_OUT: 'vigil:adapter:out',
  DOCUMENT_FETCH: 'vigil:document:fetch',
  DOCUMENT_PIN: 'vigil:document:pin',

  // Ring 2
  ENTITY_RESOLVE: 'vigil:entity:resolve',
  PATTERN_DETECT: 'vigil:pattern:detect',
  SCORE_COMPUTE: 'vigil:score:compute',
  COUNTER_EVIDENCE: 'vigil:counter:evidence',

  // Ring 3
  DOSSIER_RENDER: 'vigil:dossier:render',
  DOSSIER_DELIVER: 'vigil:dossier:deliver',

  // Ring 4
  ANCHOR_COMMIT: 'vigil:anchor:commit',
  CONAC_SFTP: 'vigil:conac:sftp',

  // Ring 5
  GOVERNANCE_EVENT: 'vigil:governance:event',
  TIP_TRIAGE: 'vigil:tip:triage',

  // Ring 5 — multi-channel tip ingestion (FRONTIER-AUDIT E1.4).
  // Telecom-gateway webhook handlers (MTN, Orange) write inbound USSD /
  // SMS / voice descriptors here. worker-tip-channels drains, encrypts
  // against the council pubkey, persists to `tip.tip`, and returns the
  // TIP-YYYY-NNNN reference via the synchronous webhook response path.
  TIP_CHANNELS_INCOMING: 'vigil:tip:channels:incoming',

  // Ring 5 — outcome feedback signal ingestion (FRONTIER-AUDIT Layer-7).
  // adapter-runner feeds (CONAC press, Cour Suprême roll, ARMP debarment,
  // ANIF bulletin, MINFI clawback) write signals here. worker-outcome-
  // feedback matches against delivered dossiers and persists outcomes.
  OUTCOME_SIGNAL: 'vigil:outcome:signal',

  // Cross-cutting
  DEAD_LETTER: 'vigil:dead-letter',
  AUDIT_PUBLISH: 'vigil:audit:publish',
  CALIBRATION_RUN: 'vigil:calibration:run',
  REALTIME_BROADCAST: 'vigil:realtime:broadcast',

  // Phase 3 — regional federation. Regional adapters write here
  // instead of ADAPTER_OUT; worker-federation-agent drains it,
  // signs, and pushes to the Yaoundé core's federation receiver.
  FEDERATION_PUSH: 'vigil:federation:push',
} as const;

export type StreamName = (typeof STREAMS)[keyof typeof STREAMS];

/** Consumer-group name for a worker on a stream. */
export const groupName = (workerName: string): string => `cg:${workerName}`;

/** Generate a unique consumer name within a group. */
export const consumerName = (workerName: string, instanceId: string): string =>
  `${workerName}-${instanceId}`;
