import { randomUUID } from 'node:crypto';

import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { EntityRepo } from '../src/repos/entity.js';
import { FindingRepo } from '../src/repos/finding.js';
import * as schema from '../src/schema/index.js';

/**
 * Mode 2.3 — Lock contention on hot rows.
 *
 * The Phase-1 orientation (docs/audit/hardening-orientation.md §3.2)
 * raised a concern that `FindingRepo.addSignal` and
 * `EntityRepo.upsertCluster` could lose increments / merged metadata
 * keys under concurrent invocation, on the theory that without
 * explicit `FOR UPDATE` the READ COMMITTED isolation level permits
 * lost updates.
 *
 * That theory does NOT apply to the specific code in those repos.
 * Both call sites use SINGLE-STATEMENT updates:
 *
 *   - `addSignal`: `UPDATE finding SET signal_count = signal_count + 1`
 *     — a row-level UPDATE with arithmetic on the SAME row. Postgres's
 *     EvalPlanQual mechanism (chapter 13.2.1 of the docs) makes the
 *     second concurrent updater re-read the row after the first
 *     commits and re-apply the expression to the NEW value. Two
 *     concurrent increments of a counter both succeed: 5 -> 6 -> 7.
 *
 *   - `upsertCluster`: `INSERT ... ON CONFLICT DO UPDATE SET metadata =
 *     metadata || $new::jsonb` — a single-statement upsert with a JSONB
 *     merge. The same EvalPlanQual semantics apply.
 *
 * The hardening closure for mode 2.3 is therefore not a code change
 * but an enforced regression invariant: this test asserts that N
 * concurrent `addSignal` calls against the same finding produce
 * exactly `signal_count = N`, and N concurrent `upsertCluster` calls
 * with disjoint metadata keys produce a final metadata object
 * containing all N keys.
 *
 * If a future refactor splits these into separate SELECT + UPDATE
 * steps (which WOULD expose the lost-update race), this test will
 * fail and force the refactor to add explicit `FOR UPDATE`.
 *
 * Test gated on `INTEGRATION_DB_URL` — only runs in CI where a real
 * Postgres is available. Same gating pattern as the audit-log CAS
 * test (closures share the same execution model).
 */

const INTEGRATION_DB_URL = process.env.INTEGRATION_DB_URL;

describe.skipIf(!INTEGRATION_DB_URL)('mode 2.3 — hot-row contention (integration)', () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let findingRepo: FindingRepo;
  let entityRepo: EntityRepo;
  const findingId = randomUUID();
  const canonicalId = randomUUID();

  beforeAll(async () => {
    pool = new Pool({ connectionString: INTEGRATION_DB_URL! });
    db = drizzle(pool, { schema });
    findingRepo = new FindingRepo(db);
    entityRepo = new EntityRepo(db);
  });

  afterAll(async () => {
    if (pool) {
      await pool
        .query(`DELETE FROM finding.signal WHERE finding_id = $1`, [findingId])
        .catch(() => {});
      await pool.query(`DELETE FROM finding.finding WHERE id = $1`, [findingId]).catch(() => {});
      await pool.query(`DELETE FROM entity.canonical WHERE id = $1`, [canonicalId]).catch(() => {});
      await pool.end();
    }
  });

  it('addSignal does NOT lose increments under 50 concurrent invocations on the same finding', async () => {
    // Seed the finding row with signal_count=0.
    await findingRepo.insert({
      id: findingId,
      state: 'review',
      primary_entity_id: null,
      severity: 'low',
      posterior: 0.5,
      signal_count: 0,
      title_fr: 'hardening-test',
      title_en: 'hardening-test',
      summary_fr: 'mode 2.3 row-contention regression',
      summary_en: 'mode 2.3 row-contention regression',
    });

    const N = 50;
    // Race N concurrent addSignal calls — each inserts a signal row
    // and increments signal_count by 1.
    await Promise.all(
      Array.from({ length: N }, () =>
        findingRepo.addSignal({
          id: randomUUID(),
          finding_id: findingId,
          source: 'pattern',
          strength: 0.5,
          prior: 0.05,
          weight: 1.0,
          evidence_event_ids: [],
          evidence_document_cids: [],
        }),
      ),
    );

    // The single-statement UPDATE with `signal_count + 1` is atomic
    // under EvalPlanQual: every concurrent caller's increment is
    // applied to the latest committed value. Expected final = N.
    const final = await findingRepo.getById(findingId);
    expect(final).not.toBeNull();
    expect(final!.signal_count).toBe(N);

    // And every signal row landed.
    const signals = await findingRepo.getSignals(findingId);
    expect(signals.length).toBe(N);
  }, 60_000);

  it('upsertCluster JSONB metadata merge does NOT lose keys under 20 concurrent invocations', async () => {
    // First insert establishes the row.
    const now = new Date();
    await entityRepo.upsertCluster({
      canonical: {
        id: canonicalId,
        kind: 'organization',
        display_name: 'concurrent-merge-target',
        jurisdiction: 'CM',
        first_seen: now,
        last_seen: now,
        resolution_confidence: 0.9,
        resolved_by: 'test',
        metadata: { seed: true },
      },
      aliases: [],
    });

    const N = 20;
    // Race N concurrent upserts, each adding a unique metadata key.
    // The `metadata || $new::jsonb` merge in entity.ts:311 is a
    // single-statement update; EvalPlanQual re-evaluates against the
    // post-prior-commit row, so all keys should land.
    await Promise.all(
      Array.from({ length: N }, (_, i) =>
        entityRepo.upsertCluster({
          canonical: {
            id: canonicalId,
            kind: 'organization',
            display_name: 'concurrent-merge-target',
            jurisdiction: 'CM',
            first_seen: now,
            last_seen: now,
            resolution_confidence: 0.95,
            resolved_by: 'test',
            metadata: { [`key_${i}`]: i },
          },
          aliases: [],
        }),
      ),
    );

    const r = await pool.query(`SELECT metadata FROM entity.canonical WHERE id = $1`, [
      canonicalId,
    ]);
    const md = r.rows[0]?.metadata as Record<string, unknown>;
    expect(md).toBeDefined();
    // The seed key is preserved.
    expect(md.seed).toBe(true);
    // Every per-iteration key landed — no lost merges.
    for (let i = 0; i < N; i++) {
      expect(md[`key_${i}`]).toBe(i);
    }
  }, 60_000);
});
