export { canaryFor, canaryTriggered } from './canary.js';
export {
  zCitedClaim,
  zCitedExtraction,
  validateVerbatimGrounding,
  type CitedClaim,
  type CitedExtraction,
  type SourceRecordIndex,
  type VerbatimValidationOutcome,
} from './citation.js';
export {
  defangSourceTagBoundary,
  renderClosedContext,
  type ClosedContextSource,
  type ClosedContextRender,
} from './closed-context.js';
export {
  PromptRegistry,
  globalPromptRegistry,
  type PromptTemplateEntry,
} from './prompt-registry.js';
export { ADVERSARIAL_PROMPT_NAMES, adversarialPromptsRegistered } from './prompts.js';

// FRONTIER-AUDIT Layer-1 E1.3 closures (2026-05-14):
//   Layer 13 — input-side prompt-injection scanning
//   Layer 14 — per-claim provenance attestation
//   Layer 15 — differential model agreement across provider families
export {
  scanForPromptInjection,
  shouldRefusePromptInjection,
  type PromptInjectionScanResult,
  type PromptInjectionScanOptions,
} from './prompt-injection-scan.js';
export {
  provenanceHash,
  buildProvenance,
  attestClaim,
  verifyAttestationShape,
  verifyProvenanceAgainstOriginals,
  type LlmProvenance,
  type AttestedClaim,
} from './provenance-attestation.js';
export {
  evaluateDifferentialAgreement,
  type DifferentialAgreementInput,
  type DifferentialAgreementResult,
  type DifferentialComparator,
} from './differential-agreement.js';
