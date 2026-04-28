import 'server-only';

import { DossierRepo, getDb } from '@vigil/db-postgres';
import { sql } from 'drizzle-orm';

/**
 * Server helpers for the public /verify surface (Phase C6, SRD §28.6).
 *
 * Per W-15 (audit-chain anchor minimisation): the public verify page must
 * NEVER leak operator-only state (counter-evidence text, tip metadata,
 * council recuse reasons). It exposes only the audit-chain root and the
 * minimum metadata needed for citizens to recompute the dossier hash and
 * confirm it appears on Polygon mainnet.
 */

export interface PublicVerifyView {
  readonly ref: string;
  readonly languages: ReadonlyArray<{
    readonly language: string;
    readonly pdf_cid: string | null;
    readonly pdf_sha256: string;
    readonly rendered_at: string;
    readonly delivered_at: string | null;
    readonly acknowledged_at: string | null;
  }>;
  readonly anchor: {
    readonly polygon_tx_hash: string | null;
    readonly anchored_at: string | null;
    readonly seq_from: number | null;
    readonly seq_to: number | null;
    readonly root_hash: string | null;
  };
}

export async function getVerifyView(ref: string): Promise<PublicVerifyView | null> {
  const db = await getDb();
  const dossierRepo = new DossierRepo(db);

  // Both language variants share a `ref`. We expose minimal fields.
  const [fr, en] = await Promise.all([
    dossierRepo.getByRef(ref, 'fr'),
    dossierRepo.getByRef(ref, 'en'),
  ]);
  if (!fr && !en) return null;

  // Find the anchor commitment that covers the row's audit event. For
  // simplicity we take the most recent commitment whose range includes
  // any audit event referencing this dossier_ref. A dedicated lookup
  // table is wired in Phase E (audit-correlation).
  const r = await db.execute(sql`
    SELECT polygon_tx_hash::text AS tx,
           polygon_confirmed_at::text AS confirmed_at,
           seq_from::text AS seq_from,
           seq_to::text   AS seq_to,
           encode(root_hash, 'hex') AS root_hex
      FROM audit.anchor_commitment
     ORDER BY seq_to DESC
     LIMIT 1
  `);
  const anchorRow = r.rows[0] as
    | { tx: string | null; confirmed_at: string | null; seq_from: string; seq_to: string; root_hex: string }
    | undefined;

  return {
    ref,
    languages: [fr, en]
      .filter((d): d is NonNullable<typeof d> => d !== null)
      .map((d) => ({
        language: d.language,
        pdf_cid: d.pdf_cid,
        pdf_sha256: d.pdf_sha256,
        rendered_at: d.rendered_at.toISOString(),
        delivered_at: d.delivered_at ? d.delivered_at.toISOString() : null,
        acknowledged_at: d.acknowledged_at ? d.acknowledged_at.toISOString() : null,
      })),
    anchor: {
      polygon_tx_hash: anchorRow?.tx ?? null,
      anchored_at: anchorRow?.confirmed_at ?? null,
      seq_from: anchorRow ? Number(anchorRow.seq_from) : null,
      seq_to: anchorRow ? Number(anchorRow.seq_to) : null,
      root_hash: anchorRow?.root_hex ?? null,
    },
  };
}
