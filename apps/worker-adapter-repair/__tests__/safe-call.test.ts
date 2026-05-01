/**
 * Block-B A2 — doctrine-surface regression for worker-adapter-repair.
 *
 * Pins the SafeLlmRouter migration: every PR that touches the
 * selector-rederive code path must keep the call going through
 * SafeLlmRouter, with the registered prompt name, with rich task
 * instructions, with the rederive payload as a closed-context
 * source, and with schema validation via zCandidateSelector.
 *
 * Source-grep style — same rationale as the worker-tip-triage and
 * worker-anchor source-grep regressions.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const INDEX_TS = readFileSync(join(REPO_ROOT, 'apps/worker-adapter-repair/src/index.ts'), 'utf8');
const PROMPTS_TS = readFileSync(
  join(REPO_ROOT, 'apps/worker-adapter-repair/src/prompts.ts'),
  'utf8',
);

describe('worker-adapter-repair — SafeLlmRouter migration (Block-B A2)', () => {
  it('imports SafeLlmRouter + Safety from @vigil/llm', () => {
    expect(INDEX_TS).toMatch(/import\s+\{[^}]*\bSafeLlmRouter\b[^}]*\}\s+from\s+'@vigil\/llm'/);
    expect(INDEX_TS).toMatch(/import\s+\{[^}]*\bSafety\b[^}]*\}\s+from\s+'@vigil\/llm'/);
  });

  it('imports the registered prompt name (via prompts.js side-effect)', () => {
    expect(INDEX_TS).toMatch(/SELECTOR_REDERIVE_TASK/);
    expect(INDEX_TS).toMatch(/from\s+'\.\/prompts\.js'/);
  });

  it('generateProposal routes through safe.call (NOT raw llm.call)', () => {
    expect(INDEX_TS).toMatch(/safe\.call</);
    expect(INDEX_TS).not.toMatch(/llm\.call</);
  });

  it('safe.call carries the registered prompt name', () => {
    expect(INDEX_TS).toMatch(/promptName:\s*'adapter-repair\.selector-rederive'/);
  });

  it('rederive payload is passed as a closed-context source (NOT inlined)', () => {
    // L4 prompt-injection defence: scraped HTML lands inside a
    // <source_document> tag. The doctrine system preamble disclaims
    // any instruction-shaped content inside that tag.
    expect(INDEX_TS).toMatch(/sources:\s*\[\s*\{[^]*?id:\s*`selector-rederive:\$\{source\.id\}`/);
    expect(INDEX_TS).toMatch(/text:\s*selectorRederiveUserPrompt\(/);
  });

  it('schema validation via zCandidateSelector is preserved (L5)', () => {
    expect(INDEX_TS).toMatch(/responseSchema:\s*zCandidateSelector/);
  });

  it('main() asserts adversarial prompts registered before instantiating SafeLlmRouter', () => {
    expect(INDEX_TS).toMatch(/Safety\.adversarialPromptsRegistered\(\)/);
    expect(INDEX_TS).toMatch(/AI-Safety canonical prompts missing/);
  });

  it('main() wires CallRecordRepo as the SafeLlmRouter sink', () => {
    expect(INDEX_TS).toMatch(/CallRecordRepo/);
    expect(INDEX_TS).toMatch(/new SafeLlmRouter\(llm,\s*logger,\s*\{[\s\S]*record:/);
    expect(INDEX_TS).toMatch(/callRecordRepo\.record/);
  });

  it('main() reads modelId from env with the canonical default', () => {
    expect(INDEX_TS).toMatch(/process\.env\.ADAPTER_REPAIR_MODEL/);
    expect(INDEX_TS).toMatch(/'claude-sonnet-4-6'/);
  });

  it('prompts.ts registers adapter-repair.selector-rederive via globalPromptRegistry', () => {
    expect(PROMPTS_TS).toMatch(/globalPromptRegistry\.register\(/);
    expect(PROMPTS_TS).toMatch(/name:\s*'adapter-repair\.selector-rederive'/);
    expect(PROMPTS_TS).toMatch(/version:\s*'v1\.0\.0'/);
  });

  it('SELECTOR_REDERIVE_TASK retains conservative-selector + rationale rules', () => {
    // Saliency check: the rules moved from the system prompt
    // (pre-migration) to the task field. The doctrine system
    // preamble's rule 4 ("Output STRICTLY the JSON schema") provides
    // the structural floor; zCandidateSelector enforces it.
    expect(PROMPTS_TS).toMatch(/Be conservative/);
    expect(PROMPTS_TS).toMatch(/MUST cite the HTML elements you keyed on/);
    expect(PROMPTS_TS).toMatch(/Do NOT invent selectors that new_html doesn't match/);
  });
});
