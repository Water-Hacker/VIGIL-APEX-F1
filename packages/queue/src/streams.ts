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
