/**
 * Registers the `counter-evidence.devils-advocate-narrative` prompt
 * with the global SafeLlmRouter prompt registry. AI-SAFETY-DOCTRINE-v1
 * §B.12 — every Claude call must reference a registered (name,
 * version, hash) tuple. AUDIT-027 closure: the legacy free-form
 * narrative review now goes through SafeLlmRouter just like the
 * doctrine adversarial pipeline (L4 canary, L5 schema, L9 language,
 * L11 daily-rotated canary). The full L1-L12 stack requires citations
 * which this prompt does not produce; that's a deliberate trade
 * documented in DECISION-008 (analysts still get the free-form
 * paragraph; it never feeds the engine).
 *
 * Side-effect import: `import './prompts.js'` from index.ts triggers
 * registration on module load.
 */

import { Safety } from '@vigil/llm';

const { globalPromptRegistry } = Safety;

const DEVILS_ADVOCATE_NARRATIVE_SYSTEM = `
You are a senior auditor performing a devil's-advocate review on a finding produced
by VIGIL APEX, an automated procurement-fraud detection system.

Your job: identify reasons the finding might be wrong, missing context, or have a
benign alternative explanation. Examples: emergency procurement justified by an
official decree; an exclusion clause that explains a single-bidder award; a
satellite cloud-cover false negative; a name collision in entity resolution.

Output STRICTLY the JSON schema:
{
  "concerns": ["<concern 1>", "<concern 2>", ...],
  "alternative_explanation": "<one paragraph or null>",
  "verification_steps": ["<step 1>", "<step 2>", ...]
}

If you cannot find any reason the finding might be wrong, output:
{"concerns":[],"alternative_explanation":null,"verification_steps":["Independently re-verify each numerical citation."]}

Refuse to invent context that isn't in the supplied finding. The finding is the
ONLY source — no external knowledge about named projects, entities, or
jurisdictions.
`.trim();

interface DevilsAdvocateNarrativeInput {
  readonly findingSummaryJson: string;
}

globalPromptRegistry.register({
  name: 'counter-evidence.devils-advocate-narrative',
  version: 'v1.0.0',
  description:
    "Free-form devil's-advocate paragraph for the analyst UI. Closed-context, no citations. AUDIT-027: was previously routed through raw LlmRouter; now goes through SafeLlmRouter so L4/L5/L9/L11 apply uniformly.",
  render: (input) => {
    const i = input as DevilsAdvocateNarrativeInput;
    return {
      system: DEVILS_ADVOCATE_NARRATIVE_SYSTEM,
      user: i.findingSummaryJson,
    };
  },
});
