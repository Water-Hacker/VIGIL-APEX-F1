#!/usr/bin/env tsx
/**
 * scripts/review-demo-seed.ts — UNDP review demo seeder.
 *
 * Appends 12 synthetic audit events to the `audit.actions` table via
 * the production `HashChain.append()` primitive. The 12 events span
 * the action-enum categories a real production day would touch
 * (system + adapter + finding + governance + audit) so the reviewer
 * sees the canonical-form bytes hash a representative sample, not
 * 12 identical rows.
 *
 * Reads DATABASE_URL from env; review-demo.sh exports
 * `postgres://vigil:review@127.0.0.1:5432/vigil` before invoking.
 *
 * Output: one line per appended event with seq + action + body_hash
 * prefix so the reviewer sees the hashes are unique per row.
 */

import process from 'node:process';

import { HashChain } from '@vigil/audit-chain';
import { createLogger } from '@vigil/observability';
import { Pool } from 'pg';

import type { Schemas } from '@vigil/shared';

interface SyntheticEvent {
  readonly action: Schemas.AuditAction;
  readonly subject_kind: Schemas.AuditEvent['subject_kind'];
  readonly subject_id: string;
  readonly payload: Record<string, unknown>;
}

// 12 synthetic events spanning the action-enum surface. The IDs are
// deterministic so a reviewer running the demo twice gets the same
// canonical bytes (and therefore the same body_hashes, modulo
// occurred_at which now() supplies).
const EVENTS: ReadonlyArray<SyntheticEvent> = [
  {
    action: 'system.bootstrap',
    subject_kind: 'service',
    subject_id: 'review-demo',
    payload: { service: 'review-demo', message: 'starting synthetic seed' },
  },
  {
    action: 'adapter.scheduled',
    subject_kind: 'source',
    subject_id: 'aripsa-tender-eligible',
    payload: { adapter_run_id: '00000000-0000-0000-0000-000000000001' },
  },
  {
    action: 'adapter.run_started',
    subject_kind: 'source',
    subject_id: 'aripsa-tender-eligible',
    payload: { adapter_run_id: '00000000-0000-0000-0000-000000000001' },
  },
  {
    action: 'adapter.run_completed',
    subject_kind: 'source',
    subject_id: 'aripsa-tender-eligible',
    payload: {
      adapter_run_id: '00000000-0000-0000-0000-000000000001',
      records_ingested: 47,
      duration_ms: 12_345,
    },
  },
  {
    action: 'finding.created',
    subject_kind: 'finding',
    subject_id: 'f-review-001',
    payload: {
      title: 'Synthetic finding for UNDP review demo',
      pattern_id: 'P-A-001',
      severity: 'high',
      posterior: 0.87,
      signal_count: 6,
    },
  },
  {
    action: 'finding.scored',
    subject_kind: 'finding',
    subject_id: 'f-review-001',
    payload: { posterior: 0.87, tier: 'action_queue' },
  },
  {
    action: 'finding.escalated',
    subject_kind: 'finding',
    subject_id: 'f-review-001',
    payload: {
      proposal_index: 17,
      recipient_body_name: 'CONAC',
    },
  },
  {
    action: 'governance.proposal_opened',
    subject_kind: 'proposal',
    subject_id: '17',
    payload: { finding_id: 'f-review-001', proposer: '0xreview' },
  },
  {
    action: 'governance.vote_cast',
    subject_kind: 'proposal',
    subject_id: '17',
    payload: { voter: '0xpillar-a', choice: 'YES' },
  },
  {
    action: 'governance.vote_cast',
    subject_kind: 'proposal',
    subject_id: '17',
    payload: { voter: '0xpillar-b', choice: 'YES' },
  },
  {
    action: 'governance.vote_cast',
    subject_kind: 'proposal',
    subject_id: '17',
    payload: { voter: '0xpillar-c', choice: 'YES' },
  },
  {
    action: 'governance.proposal_finalised',
    subject_kind: 'proposal',
    subject_id: '17',
    payload: { result: 'APPROVED', yes: 3, no: 0, abstain: 0, recused: [] },
  },
];

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    process.stderr.write('DATABASE_URL is required\n');
    process.exit(1);
  }
  const pool = new Pool({ connectionString: url, max: 2 });
  const logger = createLogger({ service: 'review-demo-seed' });
  const chain = new HashChain(pool, logger);

  process.stdout.write('  appending 12 events…\n');
  for (const e of EVENTS) {
    const row = await chain.append({
      action: e.action,
      actor: 'review-demo',
      subject_kind: e.subject_kind,
      subject_id: e.subject_id,
      payload: e.payload,
    });
    process.stdout.write(
      `    seq=${row.seq.toString().padStart(2)} action=${row.action.padEnd(34)} body_hash=${row.body_hash.slice(0, 16)}…\n`,
    );
  }
  process.stdout.write(`  ✓ 12 events appended; chain head seq=${EVENTS.length}\n`);
  await pool.end();
}

main().catch((e: unknown) => {
  const err = e instanceof Error ? e : new Error(String(e));
  process.stderr.write(`fatal: ${err.message}\n`);
  process.exit(2);
});
