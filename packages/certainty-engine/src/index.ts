export {
  ENGINE_VERSION,
  priorToOdds,
  oddsToProbability,
  computePosterior,
  effectiveWeights,
  independentSourceCount,
  dispatchTier,
  canonicalHashable,
  type ComputePosteriorInput,
  type ComputePosteriorOutput,
} from './bayes.js';

export {
  loadRegistries,
  IndependenceLookup,
  LikelihoodRatioLookup,
  type LoadedRegistries,
} from './registry.js';

export {
  assessFinding,
  counterfactualProbe,
  type RawSignal,
  type AssessFindingInput,
  type AssessFindingOutput,
} from './assess.js';

export {
  runAdversarial,
  ADVERSARIAL_VERSION,
  type LlmEvaluator,
  type RunAdversarialInput,
} from './adversarial.js';

export {
  createClaudeLlmEvaluator,
  type SafeRouterShape,
  type ClaudeLlmEvaluatorOptions,
} from './claude-evaluator.js';
