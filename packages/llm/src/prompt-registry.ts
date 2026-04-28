import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

import { Errors } from '@vigil/shared';

/**
 * Prompt registry — loads versioned prompt templates from disk.
 *
 * Per BUILD-V1 §27 / SRD §18.5: all prompts live in `/packages/llm/prompts/`
 * as versioned files (e.g. `dossier-narrative-fr-v3.txt`). They are NEVER
 * inlined in worker code. Worker code references prompts by ID; the LLM
 * client loads the file at call time.
 *
 * File format: `<id>.<lang>.<version>.json` containing:
 *   {
 *     "id": "document-classify",
 *     "version": "v3",
 *     "language": "en",
 *     "task": "classification",
 *     "description": "...",
 *     "input_schema": { ... JSON Schema ... },
 *     "output_schema": { ... },
 *     "system": "... actual system prompt ...",
 *     "user_template": "Document content: {{content}}",
 *     "test_cases": [ ... ]
 *   }
 */

const zPromptDef = z.object({
  id: z.string().min(2).max(80),
  version: z.string().regex(/^v\d+$/),
  language: z.enum(['en', 'fr']),
  task: z.enum([
    'extraction',
    'classification',
    'translation',
    'devils_advocate',
    'entity_resolution',
    'pattern_evidence',
    'dossier_narrative',
    'tip_classify',
  ]),
  description: z.string().min(10).max(500),
  system: z.string().min(20).max(20_000),
  user_template: z.string().min(0).max(20_000),
  templated_vars: z.array(z.string()).default([]),
  output_schema_ref: z.string().optional(),
});

export type PromptDef = z.infer<typeof zPromptDef>;

export class PromptRegistry {
  private readonly byKey = new Map<string, PromptDef>();
  private loaded = false;

  constructor(private readonly directory: string) {}

  async load(): Promise<void> {
    if (this.loaded) return;
    const files = await readdir(this.directory);
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const raw = await readFile(path.join(this.directory, file), 'utf8');
      const parsed = zPromptDef.parse(JSON.parse(raw));
      const key = `${parsed.id}@${parsed.version}.${parsed.language}`;
      this.byKey.set(key, parsed);
    }
    this.loaded = true;
  }

  get(id: string, version: string, language: 'en' | 'fr'): PromptDef {
    const key = `${id}@${version}.${language}`;
    const def = this.byKey.get(key);
    if (!def) {
      throw new Errors.VigilError({
        code: 'PROMPT_NOT_FOUND',
        message: `Prompt not found: ${key}`,
        severity: 'error',
      });
    }
    return def;
  }

  /** Render a user template — strict {{var}} substitution, throws on missing vars. */
  render(def: PromptDef, vars: Readonly<Record<string, string>>): string {
    const required = def.templated_vars;
    for (const v of required) {
      if (!(v in vars)) {
        throw new Errors.VigilError({
          code: 'PROMPT_MISSING_VAR',
          message: `Missing variable '${v}' for prompt ${def.id}@${def.version}`,
          severity: 'error',
          context: { prompt: def.id, missing: v },
        });
      }
    }
    return def.user_template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
      if (!(key in vars)) {
        throw new Errors.VigilError({
          code: 'PROMPT_UNDECLARED_VAR',
          message: `Template references undeclared variable: ${key}`,
          severity: 'error',
        });
      }
      return vars[key]!;
    });
  }
}
