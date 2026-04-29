export { computeRecordHash } from './hash.js';
export {
  emitAudit,
  type EmitInput,
  type EmitDependencies,
  type EmitResult,
} from './emit.js';
export {
  withHaltOnFailure,
  AuditEmitterUnavailableError,
} from './halt.js';
export {
  type AuditSigner,
  DeterministicTestSigner,
  NoopSigner,
} from './signer.js';
export {
  toPublicView,
  hashPii,
  type PublicViewRow,
} from './public-view.js';
export {
  evaluateAnomalies,
  ALL_RULES,
  RULE_VERSION,
  type AnomalyEvent,
  type AnomalyRule,
  type AnomalyRuleResult,
} from './anomaly.js';
