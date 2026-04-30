import { Errors } from '@vigil/shared';

import type { PatternDef, SubjectInput } from './types.js';

/**
 * Singleton PatternRegistry. Patterns register at module-load time via
 * `registerPattern(...)`. Workers query `applicable(subject)` to filter.
 */
class Registry {
  private readonly byId = new Map<string, PatternDef>();
  private readonly byCategory = new Map<string, PatternDef[]>();
  private readonly bySubjectKind = new Map<string, PatternDef[]>();

  register(def: PatternDef): void {
    if (this.byId.has(def.id)) {
      throw new Errors.VigilError({
        code: 'PATTERN_DUPLICATE_ID',
        message: `Duplicate pattern: ${def.id}`,
        severity: 'fatal',
      });
    }
    this.byId.set(def.id, def);
    const cat = this.byCategory.get(def.category) ?? [];
    cat.push(def);
    this.byCategory.set(def.category, cat);
    for (const k of def.subjectKinds) {
      const arr = this.bySubjectKind.get(k) ?? [];
      arr.push(def);
      this.bySubjectKind.set(k, arr);
    }
  }

  get(id: string): PatternDef | undefined {
    return this.byId.get(id);
  }

  all(): readonly PatternDef[] {
    return [...this.byId.values()];
  }

  byCategoryLetter(letter: string): readonly PatternDef[] {
    return this.byCategory.get(letter) ?? [];
  }

  applicable(subject: SubjectInput): readonly PatternDef[] {
    return (this.bySubjectKind.get(subject.kind) ?? []).filter((p) => p.status !== 'deprecated');
  }

  applicableTo(kind: SubjectInput['kind']): readonly PatternDef[] {
    return (this.bySubjectKind.get(kind) ?? []).filter((p) => p.status !== 'deprecated');
  }

  count(): number {
    return this.byId.size;
  }
}

export const PatternRegistry = new Registry();
export const registerPattern = (def: PatternDef): void => PatternRegistry.register(def);
