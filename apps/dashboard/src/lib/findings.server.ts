import 'server-only';

import { DossierRepo, EntityRepo, FindingRepo, getDb } from '@vigil/db-postgres';
import { sql } from 'drizzle-orm';

let cachedRepo: FindingRepo | null = null;

async function repo(): Promise<FindingRepo> {
  if (cachedRepo) return cachedRepo;
  const db = await getDb();
  cachedRepo = new FindingRepo(db);
  return cachedRepo;
}

export interface FindingListRow {
  readonly id: string;
  readonly title_fr: string;
  readonly title_en: string;
  readonly severity: string;
  readonly posterior: number | null;
  readonly state: string;
  readonly detected_at: string;
  /** DECISION-011 — latest certainty-engine dispatch tier when available. */
  readonly tier: string | null;
  /** Signal count + primary pattern category drive the triage co-pilot
   *  (FRONTIER-AUDIT E1.6). Cheap to include — both come from existing
   *  finding columns. */
  readonly signal_count: number;
  readonly primary_pattern_category: string | null;
  readonly counter_evidence_present: boolean;
  readonly entity_is_pep_or_sanctioned: boolean;
}

export async function listFindings(opts: {
  limit?: number;
  threshold?: number;
}): Promise<FindingListRow[]> {
  const r = await repo();
  const db = await getDb();
  const result = await db.execute(sql`
    SELECT f.id, f.title_fr, f.title_en, f.severity, f.posterior, f.state,
           f.detected_at::text AS detected_at,
           f.signal_count,
           f.primary_pattern_id,
           f.counter_evidence,
           latest.tier AS tier,
           COALESCE(c.is_pep, false) AS is_pep,
           COALESCE(c.is_sanctioned, false) AS is_sanctioned
      FROM finding.finding f
      LEFT JOIN LATERAL (
        SELECT tier
          FROM certainty.assessment a
         WHERE a.finding_id = f.id
         ORDER BY a.computed_at DESC
         LIMIT 1
      ) latest ON true
      LEFT JOIN entity.canonical c ON c.id = f.primary_entity_id
     WHERE f.posterior >= ${opts.threshold ?? 0.5}
       AND f.state IN ('detected','review','council_review','escalated')
     ORDER BY f.detected_at DESC
     LIMIT ${opts.limit ?? 50}
  `);
  void r;
  return result.rows.map((row) => {
    const patternId = row['primary_pattern_id'] as string | null | undefined;
    const cat = typeof patternId === 'string' ? (/^P-([A-P])-/.exec(patternId)?.[1] ?? null) : null;
    return {
      id: String(row['id']),
      title_fr: String(row['title_fr']),
      title_en: String(row['title_en']),
      severity: String(row['severity']),
      posterior: row['posterior'] !== null ? Number(row['posterior']) : null,
      state: String(row['state']),
      detected_at: String(row['detected_at']),
      tier: row['tier'] !== null && row['tier'] !== undefined ? String(row['tier']) : null,
      signal_count:
        row['signal_count'] !== null && row['signal_count'] !== undefined
          ? Number(row['signal_count'])
          : 0,
      primary_pattern_category: cat,
      counter_evidence_present: row['counter_evidence'] !== null && row['counter_evidence'] !== '',
      entity_is_pep_or_sanctioned: Boolean(row['is_pep']) || Boolean(row['is_sanctioned']),
    };
  });
}

export interface FindingDetail {
  readonly finding: {
    readonly id: string;
    readonly title_fr: string;
    readonly title_en: string;
    readonly summary_fr: string;
    readonly summary_en: string;
    readonly state: string;
    readonly severity: string;
    readonly posterior: number | null;
    readonly signal_count: number;
    readonly amount_xaf: number | null;
    readonly region: string | null;
    readonly counter_evidence: string | null;
    readonly detected_at: string;
    readonly last_signal_at: string;
  };
  readonly signals: ReadonlyArray<{
    readonly id: string;
    readonly source: string;
    readonly pattern_id: string | null;
    readonly strength: number;
    readonly weight: number;
    readonly contributed_at: string;
    readonly rationale: string | null;
    readonly evidence_event_ids: ReadonlyArray<string>;
    readonly evidence_document_cids: ReadonlyArray<string>;
  }>;
  readonly entities: ReadonlyArray<{
    readonly id: string;
    readonly kind: string;
    readonly display_name: string;
    readonly rccm_number: string | null;
    readonly is_pep: boolean;
    readonly is_sanctioned: boolean;
  }>;
  readonly dossiers: ReadonlyArray<{
    readonly id: string;
    readonly ref: string;
    readonly language: string;
    readonly status: string;
    readonly pdf_cid: string | null;
    readonly rendered_at: string;
    readonly delivered_at: string | null;
    readonly acknowledged_at: string | null;
    readonly recipient_body_name: string;
  }>;
  readonly recommendedRecipientBody: string | null;
  readonly routingDecisions: ReadonlyArray<{
    readonly id: string;
    readonly recipient_body_name: string;
    readonly source: string;
    readonly decided_by: string;
    readonly decided_at: string;
    readonly rationale: string;
  }>;
}

export async function getFindingDetail(id: string): Promise<FindingDetail | null> {
  const db = await getDb();
  const findingRepo = new FindingRepo(db);
  const entityRepo = new EntityRepo(db);
  const dossierRepo = new DossierRepo(db);

  const finding = await findingRepo.getById(id);
  if (!finding) return null;

  const [signalRows, entityRows, dossierRows, routingRows] = await Promise.all([
    findingRepo.getSignals(id),
    finding.primary_entity_id || finding.related_entity_ids.length > 0
      ? entityRepo.getCanonicalMany([
          ...(finding.primary_entity_id ? [finding.primary_entity_id] : []),
          ...finding.related_entity_ids,
        ])
      : Promise.resolve([] as Awaited<ReturnType<EntityRepo['getCanonicalMany']>>),
    dossierRepo.listByFinding(id),
    dossierRepo.listRoutingDecisions(id),
  ]);

  return {
    finding: {
      id: finding.id,
      title_fr: finding.title_fr,
      title_en: finding.title_en,
      summary_fr: finding.summary_fr,
      summary_en: finding.summary_en,
      state: finding.state,
      severity: finding.severity,
      posterior: finding.posterior,
      signal_count: finding.signal_count,
      amount_xaf: finding.amount_xaf,
      region: finding.region,
      counter_evidence: finding.counter_evidence,
      detected_at: finding.detected_at.toISOString(),
      last_signal_at: finding.last_signal_at.toISOString(),
    },
    signals: signalRows.map((s) => ({
      id: s.id,
      source: s.source,
      pattern_id: s.pattern_id,
      strength: s.strength,
      weight: s.weight,
      contributed_at: s.contributed_at.toISOString(),
      rationale: ((s.metadata as Record<string, unknown> | null)?.['rationale'] as string) ?? null,
      evidence_event_ids: s.evidence_event_ids,
      evidence_document_cids: s.evidence_document_cids,
    })),
    entities: entityRows.map((e) => ({
      id: e.id,
      kind: e.kind,
      display_name: e.display_name,
      rccm_number: e.rccm_number,
      is_pep: e.is_pep,
      is_sanctioned: e.is_sanctioned,
    })),
    dossiers: dossierRows.map((d) => ({
      id: d.id,
      ref: d.ref,
      language: d.language,
      status: d.status,
      pdf_cid: d.pdf_cid,
      rendered_at: d.rendered_at.toISOString(),
      delivered_at: d.delivered_at ? d.delivered_at.toISOString() : null,
      acknowledged_at: d.acknowledged_at ? d.acknowledged_at.toISOString() : null,
      recipient_body_name: d.recipient_body_name,
    })),
    recommendedRecipientBody: finding.recommended_recipient_body ?? null,
    routingDecisions: routingRows.map((r) => ({
      id: r.id,
      recipient_body_name: r.recipient_body_name,
      source: r.source,
      decided_by: r.decided_by,
      decided_at: r.decided_at.toISOString(),
      rationale: r.rationale,
    })),
  };
}
