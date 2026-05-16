import { createHash } from 'node:crypto';

import {
  adapterRowsEmitted,
  adapterRunsTotal,
  createLogger,
  errorsTotal,
  type Logger,
} from '@vigil/observability';
import { Errors, Ids } from '@vigil/shared';

import { dumpFirstContactHtml } from './first-contact.js';

import type { ProxyEndpoint } from './proxy.js';
import type { Schemas } from '@vigil/shared';

/**
 * Adapter — every of the 26 source adapters subclasses this.
 *
 * Lifecycle:
 *   run() = load robots → fetch (via proxy) → parse → emit events → upsert health
 *
 * Idempotency:
 *   Every emitted event has a deterministic dedup_key derived from (source_id,
 *   stable hash of the canonical row). Re-runs of the same content produce the
 *   same key and are dropped by the Postgres unique constraint.
 *
 * First-contact protocol (SRD §10.5 / BUILD-V2 §43):
 *   On parse failure, the live HTML is archived to `infra/sites/<id>/...html`
 *   and an alert is raised. The adapter does NOT silently update its selectors.
 */

export interface AdapterRunContext {
  readonly correlationId: string;
  readonly logger?: Logger;
  /** Optional proxy endpoint to use this run; null = direct (Hetzner DC IP). */
  readonly proxy: ProxyEndpoint | null;
  /** Per-run user-agent override (rotates per SRD §13.5). */
  readonly userAgent?: string;
}

export interface AdapterRunResult {
  readonly source_id: string;
  readonly events: ReadonlyArray<Schemas.SourceEvent>;
  readonly documents: ReadonlyArray<Schemas.Document>;
  readonly elapsed_ms: number;
  readonly fetched_pages: number;
}

export abstract class Adapter {
  public abstract readonly sourceId: string;
  public abstract readonly defaultRateIntervalMs: number;

  protected readonly logger: Logger;

  constructor(logger?: Logger) {
    this.logger = logger ?? createLogger({ service: 'adapter:base' });
  }

  /** Implement: do the actual fetching/parsing. Return events + documents. */
  protected abstract execute(ctx: AdapterRunContext): Promise<{
    events: ReadonlyArray<Schemas.SourceEvent>;
    documents: ReadonlyArray<Schemas.Document>;
    fetchedPages: number;
  }>;

  /** Top-level entry; wraps execute() with metrics + first-contact protocol. */
  async run(ctx: AdapterRunContext): Promise<AdapterRunResult> {
    const started = Date.now();
    try {
      const out = await this.execute(ctx);
      adapterRunsTotal.labels({ source: this.sourceId, outcome: 'ok' }).inc();
      for (const e of out.events) {
        adapterRowsEmitted.labels({ source: this.sourceId, kind: e.kind }).inc();
      }
      return {
        source_id: this.sourceId,
        events: out.events,
        documents: out.documents,
        elapsed_ms: Date.now() - started,
        fetched_pages: out.fetchedPages,
      };
    } catch (e) {
      const ve = Errors.asVigilError(e);
      errorsTotal.labels({ service: this.sourceId, code: ve.code, severity: ve.severity }).inc();
      adapterRunsTotal.labels({ source: this.sourceId, outcome: 'failed' }).inc();
      // First-contact protocol if the error indicates parser confusion
      if (ve.code === 'ADAPTER_PARSE_FAILURE') {
        await dumpFirstContactHtml(this.sourceId, (ve.context['html'] as string) ?? '', ve.message);
      }
      throw ve;
    }
  }

  /**
   * Build a deterministic dedup_key for an event. Subclasses MUST call this
   * (or an override that produces equally stable keys).
   *
   * Tier-6 adapter audit (collision-vector note, NOT changed):
   * the `|` separator below could in principle let a scraped string
   * containing `|` shift the canonical field layout and collide with
   * a different logical event. Example:
   *   parts=['company', 'A|B', 'C']  → 'company|A|B|C'
   *   parts=['company', 'A', 'B|C']  → 'company|A|B|C'  ← collision
   * The collision-proof fix (length-prefix or non-printable separator)
   * is a HARD compatibility break: every already-emitted event's
   * dedup_key would change, every prior row would re-emit on the next
   * adapter run, the audit chain would balloon. Requires architect
   * sign-off + a migration plan. Flagged for follow-up; algorithm
   * unchanged here.
   *
   * Realistic risk in the meantime: an adapter-emitted scraped string
   * containing `|` (e.g. a company name with a pipe) could silently
   * suppress a legitimate event as a duplicate of a differently-
   * shaped event. Adapter content is from trusted government sources
   * — attacker-controlled `|` injection is bounded, not nil.
   */
  protected dedupKey(parts: ReadonlyArray<string | number | null | undefined>): string {
    const norm = parts.map((p) => (p === null || p === undefined ? '' : String(p))).join('|');
    return createHash('sha256').update(norm).digest('hex').slice(0, 32);
  }

  /** Build a SourceEvent with required envelope fields. Subclasses pass payload. */
  protected makeEvent(args: {
    kind: Schemas.SourceEventKind;
    dedupKey: string;
    payload: Record<string, unknown>;
    publishedAt: string | null;
    documentCids?: ReadonlyArray<string>;
    provenance: Schemas.SourceEvent['provenance'];
  }): Schemas.SourceEvent {
    return {
      id: Ids.newEventId() as string,
      source_id: this.sourceId,
      kind: args.kind,
      dedup_key: args.dedupKey,
      published_at: args.publishedAt,
      observed_at: new Date().toISOString(),
      payload: args.payload,
      document_cids: [...(args.documentCids ?? [])],
      provenance: args.provenance,
    };
  }
}
