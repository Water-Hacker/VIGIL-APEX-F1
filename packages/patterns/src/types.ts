import type { Schemas, Ids } from '@vigil/shared';

/**
 * PatternDef — the canonical interface every pattern implements.
 *
 * Per SRD §21.1.1 / BUILD-V1 §12.1. Patterns are PURE functions of their
 * inputs; they read from Postgres + Neo4j but never query external sources
 * directly. They MUST NOT mutate state — they emit `PatternResult` for the
 * worker to persist.
 */

export type PatternStatus = 'shadow' | 'live' | 'deprecated';

export interface PatternDef<TSubject = SubjectInput> {
  readonly id: Ids.PatternId;
  readonly category: 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H';
  readonly subjectKinds: ReadonlyArray<'Tender' | 'Company' | 'Person' | 'Project' | 'Payment'>;
  readonly title_fr: string;
  readonly title_en: string;
  readonly description_fr: string;
  readonly description_en: string;
  /** Default prior for the Bayesian engine (SRD §19.3). */
  readonly defaultPrior: number;
  /** Default contribution weight per signal (0–1). */
  readonly defaultWeight: number;
  /** Lifecycle. */
  readonly status: PatternStatus;
  /** Detection function — pure. */
  detect(subject: TSubject, ctx: PatternContext): Promise<Schemas.PatternResult>;
}

export interface SubjectInput {
  readonly kind: 'Tender' | 'Company' | 'Person' | 'Project' | 'Payment';
  /** Canonical entity (when subject is Tender, this is the contracting authority). */
  readonly canonical: Schemas.EntityCanonical | null;
  /** Related entities one hop in Neo4j. */
  readonly related: ReadonlyArray<Schemas.EntityCanonical>;
  /** Recent events involving the subject. */
  readonly events: ReadonlyArray<Schemas.SourceEvent>;
  /** Prior findings on the subject. */
  readonly priorFindings: ReadonlyArray<Schemas.Finding>;
  /** Optional pre-computed metrics (PageRank, community). */
  readonly metrics?: {
    pageRank?: number;
    communityId?: number;
  };
}

export interface PatternContext {
  readonly now: Date;
  readonly logger: { info: (m: string, c?: unknown) => void; warn: (m: string, c?: unknown) => void };
  /** Read-only DB / graph handles, scoped to this pattern's needs. */
  readonly graph: PatternGraphReader;
}

export interface PatternGraphReader {
  /** Cypher single-row read. */
  cypher<T extends Record<string, unknown>>(query: string, params?: Record<string, unknown>): Promise<T[]>;
}
