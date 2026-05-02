/**
 * Block-D follow-up — doctrine-surface regression for worker-entity.
 *
 * Pins the SafeLlmRouter migration: every PR that touches the entity
 * alias-resolution code path must keep the call going through
 * SafeLlmRouter, with the registered prompt name, with the doctrine-
 * instruction-only task content, with the candidate aliases as a
 * closed-context source (NOT inline in the user prompt), and with
 * schema validation via zErResp.
 *
 * Source-grep style (precedent: worker-tip-triage/__tests__/safe-
 * call.test.ts, contract-address-guard, mou-gate-regression). The
 * worker's main() is a singleton entrypoint; mocking it would mean
 * rewriting half the file. The grep pins the contract surface a
 * future PR cannot weaken without explicit signal.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const INDEX_TS = readFileSync(join(REPO_ROOT, 'apps/worker-entity/src/index.ts'), 'utf8');
const PROMPTS_TS = readFileSync(join(REPO_ROOT, 'apps/worker-entity/src/prompts.ts'), 'utf8');

describe('worker-entity — SafeLlmRouter migration (Block-D follow-up)', () => {
  it('imports SafeLlmRouter + Safety from @vigil/llm', () => {
    expect(INDEX_TS).toMatch(/import\s+\{[^}]*\bSafeLlmRouter\b[^}]*\}\s+from\s+'@vigil\/llm'/);
    expect(INDEX_TS).toMatch(/import\s+\{[^}]*\bSafety\b[^}]*\}\s+from\s+'@vigil\/llm'/);
  });

  it('imports the registered prompt as side-effect (registers on module load)', () => {
    expect(INDEX_TS).toMatch(/from\s+'\.\/prompts\.js'/);
    expect(INDEX_TS).toMatch(/ENTITY_RESOLVE_ALIASES_PROMPT_NAME/);
    expect(INDEX_TS).toMatch(/ENTITY_RESOLVE_ALIASES_TASK/);
  });

  it('handler routes through safe.call (NOT raw llm.call)', () => {
    expect(INDEX_TS).toMatch(/this\.safe\.call</);
    expect(INDEX_TS).not.toMatch(/this\.llm\.call</);
  });

  it('safe.call carries the registered prompt name', () => {
    // Either via the named constant or the literal string — both
    // are acceptable, but at least one of them must appear in the
    // safe.call invocation.
    expect(INDEX_TS).toMatch(
      /promptName:\s*(?:ENTITY_RESOLVE_ALIASES_PROMPT_NAME|'entity\.resolve-aliases')/,
    );
  });

  it('aliases are passed as a closed-context source (NOT inlined into the user prompt)', () => {
    // L4 prompt-injection defence: alias strings MUST land inside a
    // <source_document> tag via the sources array, not pasted into a
    // user template that the model treats as instructions.
    expect(INDEX_TS).toMatch(/sources:\s*\[\s*\{[\s\S]*?id:\s*'aliases-pending-resolution'/);
    // Aliases are joined into the source `text` field; the doctrine
    // task body must NOT contain the aliases inline. Non-greedy
    // multi-line match — the arrow function contains nested parens.
    expect(INDEX_TS).toMatch(/unresolved\.map\([\s\S]*?\.join\(/);
  });

  it('safe.call response is validated via zErResp schema', () => {
    expect(INDEX_TS).toMatch(/responseSchema:\s*zErResp/);
  });

  it('prompt registry side-effect: prompts.ts registers entity.resolve-aliases', () => {
    expect(PROMPTS_TS).toMatch(/globalPromptRegistry\.register/);
    expect(PROMPTS_TS).toMatch(/name:\s*ENTITY_RESOLVE_ALIASES_PROMPT_NAME/);
    expect(PROMPTS_TS).toMatch(/version:\s*'v1\.0\.0'/);
  });

  it("ENTITY_RESOLVE_ALIASES_TASK is doctrine-instruction-only (does NOT contain the literal 'Aliases:' label inline format)", () => {
    // The pre-migration shape inlined aliases under "Aliases:\n1. foo\n2. bar".
    // After migration, the user task references the source_document tag
    // and the task itself does NOT contain numbered alias lines.
    expect(PROMPTS_TS).toMatch(/<source_document id="aliases-pending-resolution">/);
    // Task may mention the WORD "aliases" (it does — "From the aliases inside …") but
    // must not embed a numbered list literal in the task text itself.
    expect(PROMPTS_TS).not.toMatch(/'Aliases:\\n'/);
  });

  it('central registry no longer carries entity.resolve-aliases', () => {
    const central = readFileSync(join(REPO_ROOT, 'packages/llm/src/safety/prompts.ts'), 'utf8');
    // The prompt may be MENTIONED in the file header documenting the
    // doctrine-vs-worker-level rule, but it must NOT be registered
    // here (no `name: 'entity.resolve-aliases'` inside a register call).
    expect(central).not.toMatch(/name:\s*'entity\.resolve-aliases'/);
  });
});
