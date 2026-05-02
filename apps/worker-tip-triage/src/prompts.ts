/**
 * SafeLlmRouter prompt registration for worker-tip-triage.
 *
 * Registers `tip-triage.paraphrase` with the global prompt registry
 * so SafeLlmRouter can record (name, version, hash, model_id) on
 * every call (AI-SAFETY-DOCTRINE-v1 §B.12, L11 call-record audit).
 *
 * Side-effect import: `import './prompts.js'` from index.ts triggers
 * registration on module load. Pattern matches worker-counter-evidence's
 * own prompts.ts.
 *
 * Block-E E.2 split (2026-05-02): `TIP_PARAPHRASE_TASK` moved to
 * `./prompt-tasks.ts` (pure constants, no module side-effects) so
 * `triage-flow.ts` and the E2E test can import the task string
 * without pulling `@vigil/llm` into the import graph. This file
 * imports + re-exports the constant for backward-compat.
 *
 * Doctrine layer mapping for the migrated path:
 *   L1 hallucination (citations)        — N/A (paraphrase, not extraction)
 *   L4 prompt injection (system rules)  — uniform via doctrine preamble
 *   L4 schema validation (zParaphrase)  — preserved
 *   L9 prompt-version pin               — NEW (was absent pre-migration)
 *   L11 daily canary                    — NEW (was absent)
 *   L11 call-record audit               — NEW (was absent)
 */

import { Safety } from '@vigil/llm';

import { TIP_PARAPHRASE_TASK } from './prompt-tasks.js';

export { TIP_PARAPHRASE_TASK };

const { globalPromptRegistry } = Safety;

globalPromptRegistry.register({
  name: 'tip-triage.paraphrase',
  version: 'v1.0.0',
  description:
    'Operator-triage paraphrase + classification of a decrypted citizen tip. Strips PII; preserves allegation substance. Block-B A2 migration: was previously routed through raw LlmRouter; now goes through SafeLlmRouter so L4/L5/L9/L11 apply uniformly.',
  render: () => ({
    system:
      '<doctrine preamble — closed-context render performed by SafeLlmRouter. The body of this prompt is the task description above; the system rules come from AI-SAFETY-DOCTRINE-v1 DEFAULT_PREAMBLE.>',
    user: TIP_PARAPHRASE_TASK,
  }),
});
