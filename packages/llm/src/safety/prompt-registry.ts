import { createHash } from 'node:crypto';

/**
 * AI-SAFETY-DOCTRINE-v1 Failure Mode 12 — prompt version control.
 *
 * Every prompt template the platform uses is registered with a name +
 * semver-style version + content hash. Every Claude call records the
 * (name, version, hash) so a finding can be regenerated from the same
 * prompt that produced it, even after the prompt has been updated. The
 * registry is in-process; persistence to `llm.prompt_template` is the
 * caller's responsibility (see `CallRecordRepo` for the DB writer).
 */

export interface PromptTemplateEntry {
  readonly name: string;
  readonly version: string;
  readonly hash: string;
  readonly description: string;
  /** Renders the final system + user message for a given input. The render
   *  is deterministic; no Date.now / no Math.random allowed inside. */
  readonly render: (input: unknown) => { system: string; user: string };
}

export class PromptRegistry {
  private readonly entries = new Map<string, PromptTemplateEntry[]>();

  register(opts: {
    name: string;
    version: string;
    description: string;
    render: (input: unknown) => { system: string; user: string };
  }): PromptTemplateEntry {
    if (!/^v\d+\.\d+\.\d+$/.test(opts.version)) {
      throw new Error(`prompt version must be vX.Y.Z, got ${opts.version}`);
    }
    // Hash a canonical string snapshot of the rendered prompt for an empty
    // input, which is sufficient for registry uniqueness — the hash is for
    // identifying the *template*, not any individual call.
    const canonicalSnapshot = JSON.stringify({
      name: opts.name,
      version: opts.version,
      description: opts.description,
      render: opts.render({}),
    });
    const hash = createHash('sha256').update(canonicalSnapshot).digest('hex');
    const entry: PromptTemplateEntry = {
      name: opts.name,
      version: opts.version,
      hash,
      description: opts.description,
      render: opts.render,
    };
    const list = this.entries.get(opts.name) ?? [];
    list.push(entry);
    this.entries.set(opts.name, list);
    return entry;
  }

  /** Returns the most recently registered version of a named prompt. */
  latest(name: string): PromptTemplateEntry | null {
    const list = this.entries.get(name);
    if (!list || list.length === 0) return null;
    return list[list.length - 1] ?? null;
  }

  byVersion(name: string, version: string): PromptTemplateEntry | null {
    const list = this.entries.get(name);
    if (!list) return null;
    return list.find((e) => e.version === version) ?? null;
  }

  /** SHA-256 of the registry's entire contents — recorded on every
   *  CertaintyAssessment so a future reviewer can confirm the prompt set
   *  in use at the time of assessment. */
  registrySnapshotHash(): string {
    const all = Array.from(this.entries.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, list]) => ({
        name,
        versions: list.map((e) => ({ version: e.version, hash: e.hash })),
      }));
    return createHash('sha256').update(JSON.stringify(all)).digest('hex');
  }

  toJsonSnapshot(): Array<{ name: string; version: string; hash: string; description: string }> {
    const out: Array<{ name: string; version: string; hash: string; description: string }> = [];
    for (const [name, list] of this.entries.entries()) {
      for (const e of list) {
        out.push({ name, version: e.version, hash: e.hash, description: e.description });
      }
    }
    return out.sort((a, b) =>
      a.name === b.name ? a.version.localeCompare(b.version) : a.name.localeCompare(b.name),
    );
  }
}

/** Singleton process-wide registry. Workers register their templates on
 *  module load; the registry's snapshot hash is captured on every Claude
 *  call. */
export const globalPromptRegistry = new PromptRegistry();
