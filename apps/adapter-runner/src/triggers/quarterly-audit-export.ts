import { createHash, randomUUID } from 'node:crypto';

import { HashChain } from '@vigil/audit-chain';
import { hashPii, toPublicView } from '@vigil/audit-log';
import {
  PublicExportRepo,
  UserActionEventRepo,
  type Db,
} from '@vigil/db-postgres';
import type { Logger } from '@vigil/observability';
import type { Pool } from 'pg';

import { currentQuarterWindow } from './quarter-window.js';

/**
 * DECISION-012 — TAL-PA quarterly anonymised export.
 *
 * Once per quarter the prior quarter's audit.user_action_event rows are
 * streamed through the public-view redactor, written to a CSV, pinned to
 * IPFS, recorded in audit.public_export, and announced via an
 * `audit.public_export_published` row on the global hash chain.
 *
 * Idempotent on `period_label` (the publicExport table has a UNIQUE
 * constraint and the repo uses ON CONFLICT DO NOTHING; we also early-exit
 * if a manifest for the requested period already exists).
 *
 * Refuses to run if `AUDIT_PUBLIC_EXPORT_SALT` is unset or PLACEHOLDER —
 * the salt is what makes `actor_id_hash` un-rainbow-tableable.
 */

const CSV_HEADER = [
  'event_id',
  'event_type',
  'category',
  'timestamp_utc',
  'actor_role',
  'actor_id_hash',
  'actor_ip_truncated',
  'target_resource',
  'result_status',
  'high_significance',
  'polygon_tx_hash',
  'prior_event_id',
  'record_hash',
] as const;

export interface QuarterlyAuditExportDeps {
  readonly db: Db;
  readonly pool: Pool;
  readonly exportRepo: PublicExportRepo;
  readonly logger: Logger;
  /** Override the reference clock (useful in tests). */
  readonly now?: () => Date;
  /** Override the salt source (useful in tests). */
  readonly salt?: string;
  /** Override the IPFS API URL (useful in tests). */
  readonly ipfsApiUrl?: string;
  /** Override the kubo client (useful in tests). */
  readonly kuboClient?: { add: (data: Uint8Array, opts?: unknown) => Promise<{ cid: { toString(): string } }> };
}

export interface QuarterlyAuditExportResult {
  readonly status: 'published' | 'already_published' | 'no_events';
  readonly periodLabel: string;
  readonly rowCount: number;
  readonly csvSha256: string;
  readonly csvCid: string | null;
}

export async function runQuarterlyAuditExport(
  deps: QuarterlyAuditExportDeps,
): Promise<QuarterlyAuditExportResult> {
  const now = (deps.now ?? (() => new Date()))();
  // Audit the prior quarter — pick a reference 15 days into the previous month.
  const lastQuarterRef = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15),
  );
  const window = currentQuarterWindow(lastQuarterRef);

  const salt = deps.salt ?? process.env.AUDIT_PUBLIC_EXPORT_SALT ?? '';
  if (!salt || salt === 'PLACEHOLDER') {
    throw new Error(
      'AUDIT_PUBLIC_EXPORT_SALT is unset or PLACEHOLDER — refusing to run quarterly export without a real salt',
    );
  }

  const existing = await deps.exportRepo.list(48);
  if (existing.some((row) => row.period_label === window.periodLabel)) {
    deps.logger.info(
      { periodLabel: window.periodLabel },
      'quarterly-audit-export-skipped-already-published',
    );
    return {
      status: 'already_published',
      periodLabel: window.periodLabel,
      rowCount: 0,
      csvSha256: '',
      csvCid: null,
    };
  }

  const userActionRepo = new UserActionEventRepo(deps.db);

  const lines: string[] = [CSV_HEADER.join(',')];
  let rowCount = 0;
  let offset = 0;
  // The repo's `listPublic` clamps `limit` to ≤500. Run paged calls until exhausted.
  // We iterate ascending by timestamp by walking offsets — the repo orders DESC, so
  // we'll re-sort by timestamp ASC after collecting; for a quarter (~tens of millions
  // upper bound, typically << 1M) this fits comfortably in memory for the CSV stage.
  // Future optimisation: stream via cursor (see runQuarterlyAuditExport.streamRows).

  // listPublic clamps to 500/page; query in pages until empty.
  // We need ASCending order by timestamp_utc — the repo currently orders desc.
  // Buffer rows then reverse for the final write.
  const buffered: Array<Awaited<ReturnType<typeof userActionRepo.listPublic>>[number]> = [];
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const page = await userActionRepo.listPublic({
      sinceIso: window.periodStart.toISOString(),
      untilIso: window.periodEnd.toISOString(),
      limit: 500,
      offset,
    });
    if (page.length === 0) break;
    buffered.push(...page);
    offset += page.length;
    if (page.length < 500) break;
  }
  buffered.sort(
    (a, b) =>
      new Date(a.timestamp_utc as unknown as string).getTime() -
      new Date(b.timestamp_utc as unknown as string).getTime(),
  );

  for (const r of buffered) {
    const view = toPublicView({
      event_id: r.event_id,
      event_type: r.event_type,
      category: r.category,
      timestamp_utc: r.timestamp_utc,
      actor_id: r.actor_id,
      actor_role: r.actor_role,
      target_resource: r.target_resource,
      result_status: r.result_status,
      chain_anchor_tx: r.chain_anchor_tx,
      high_significance: r.high_significance,
    });
    const actorIdHash = hashPii(r.actor_id, salt);
    const ipTruncated = truncateIp(r.actor_ip);
    lines.push(
      [
        view.event_id,
        view.event_type,
        view.category,
        typeof view.timestamp_utc === 'string'
          ? view.timestamp_utc
          : new Date(view.timestamp_utc).toISOString(),
        view.actor_role,
        actorIdHash,
        ipTruncated,
        csvField(view.target_resource),
        view.result_status,
        view.high_significance ? 'true' : 'false',
        view.chain_anchor_tx ?? '',
        r.prior_event_id ?? '',
        r.record_hash,
      ].join(','),
    );
    rowCount++;
  }

  if (rowCount === 0) {
    deps.logger.info(
      { periodLabel: window.periodLabel },
      'quarterly-audit-export-no-events-in-window',
    );
    return {
      status: 'no_events',
      periodLabel: window.periodLabel,
      rowCount: 0,
      csvSha256: '',
      csvCid: null,
    };
  }

  const csv = lines.join('\n') + '\n';
  const csvBytes = Buffer.from(csv, 'utf8');
  const csvSha256 = createHash('sha256').update(csvBytes).digest('hex');

  const kubo =
    deps.kuboClient ??
    ((await loadKuboClient(deps.ipfsApiUrl ?? process.env.IPFS_API_URL ?? 'http://vigil-ipfs:5001')) as unknown as NonNullable<QuarterlyAuditExportDeps['kuboClient']>);
  const added = await kubo.add(csvBytes, { pin: true, cidVersion: 1 });
  const csvCid = added.cid.toString();

  const chain = new HashChain(deps.pool, deps.logger);
  const auditEvent = await chain.append({
    action: 'audit.public_export_published',
    actor: 'system:adapter-runner',
    subject_kind: 'system',
    subject_id: 'audit-public-export',
    payload: {
      period_label: window.periodLabel,
      period_start: window.periodStart.toISOString(),
      period_end: window.periodEnd.toISOString(),
      csv_cid: csvCid,
      csv_sha256: csvSha256,
      row_count: rowCount,
      byte_count: csvBytes.length,
    },
  });

  await deps.exportRepo.record({
    id: randomUUID(),
    period_label: window.periodLabel,
    period_start: window.periodStart,
    period_end: window.periodEnd,
    csv_sha256: csvSha256,
    csv_cid: csvCid,
    row_count: rowCount,
    exported_at: new Date(),
    audit_event_id: auditEvent.id,
  });

  deps.logger.info(
    {
      periodLabel: window.periodLabel,
      rowCount,
      csvSha256,
      csvCid,
      auditEventId: auditEvent.id,
    },
    'quarterly-audit-export-published',
  );

  return {
    status: 'published',
    periodLabel: window.periodLabel,
    rowCount,
    csvSha256,
    csvCid,
  };
}

/**
 * The `kubo-rpc-client` package is ESM-only; adapter-runner is CommonJS,
 * so we resolve it via dynamic `import()` (which TypeScript compiles to a
 * native dynamic import in CJS). The shape we need is just `add()`.
 */
async function loadKuboClient(url: string): Promise<{
  add: (data: Uint8Array, opts?: unknown) => Promise<{ cid: { toString(): string } }>;
}> {
  // The only way to do a real ES dynamic import from a CJS module.
  // eslint-disable-next-line no-new-func
  const dynamicImport = new Function('s', 'return import(s)') as (s: string) => Promise<{
    create: (opts: { url: string }) => {
      add: (data: Uint8Array, opts?: unknown) => Promise<{ cid: { toString(): string } }>;
    };
  }>;
  const mod = await dynamicImport('kubo-rpc-client');
  return mod.create({ url });
}

/** /24-truncate IPv4, /48-truncate IPv6, return null/empty unchanged. */
function truncateIp(raw: string | null): string {
  if (!raw) return '';
  if (raw.includes(':')) {
    const parts = raw.split(':');
    return parts.slice(0, 3).join(':') + '::/48';
  }
  const parts = raw.split('.');
  if (parts.length !== 4) return '';
  return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
}

/** RFC 4180 minimal CSV escape — wrap in quotes if the field contains comma/quote/newline. */
function csvField(s: string): string {
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
