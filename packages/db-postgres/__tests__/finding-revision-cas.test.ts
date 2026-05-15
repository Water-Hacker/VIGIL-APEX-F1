import { randomUUID } from 'node:crypto';

import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { CasConflictError, FindingRepo } from '../src/repos/finding.js';
import * as schema from '../src/schema/index.js';

/**
 * Mode 2.8 — Lost-write last-write-wins on finding setters.
 *
 * Failure mode: two workers concurrently call `setPosterior(id, X)` and
 * `setPosterior(id, Y)`. Without CAS, both UPDATEs succeed silently; the
 * second one overwrites the first; the first worker BELIEVES its value
 * landed but it didn't. For an audit-pipeline this is unacceptable.
 *
 * Closure: every setter accepts an optional `expectedRevision` and the
 * UPDATE includes `revision = $expected` in WHERE. Mismatch ->
 * `CasConflictError` and zero rows updated. Callers without
 * expectedRevision continue with last-write-wins (backward compat).
 *
 * Test gated on INTEGRATION_DB_URL — needs a real Postgres because the
 * CAS contract is enforced at the row-update level.
 */

const INTEGRATION_DB_URL = process.env.INTEGRATION_DB_URL;

describe.skipIf(!INTEGRATION_DB_URL)('mode 2.8 — finding revision-CAS', () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let repo: FindingRepo;
  const findingId = randomUUID();

  beforeAll(async () => {
    pool = new Pool({ connectionString: INTEGRATION_DB_URL! });
    db = drizzle(pool, { schema });
    repo = new FindingRepo(db);
    // Seed.
    await repo.insert({
      id: findingId,
      state: 'review',
      primary_entity_id: null,
      severity: 'low',
      posterior: 0.5,
      signal_count: 0,
      title_fr: 'mode-2.8-test',
      title_en: 'mode-2.8-test',
      summary_fr: 'CAS regression',
      summary_en: 'CAS regression',
    });
  });

  afterAll(async () => {
    if (pool) {
      await pool.query(`DELETE FROM finding.finding WHERE id = $1`, [findingId]).catch(() => {});
      await pool.end();
    }
  });

  it('initial revision is 0', async () => {
    const row = await repo.getById(findingId);
    expect(row?.revision).toBe(0);
  });

  it('setter without expectedRevision continues (LWW backwards-compat) and bumps revision', async () => {
    const newRev = await repo.setPosterior(findingId, 0.7);
    expect(newRev).toBeGreaterThan(0);
    const row = await repo.getById(findingId);
    expect(row?.posterior).toBe(0.7);
    expect(row?.revision).toBe(newRev);
  });

  it('setter with correct expectedRevision succeeds and returns new revision', async () => {
    const before = await repo.getById(findingId);
    const currentRev = before!.revision;
    const newRev = await repo.setPosterior(findingId, 0.8, currentRev);
    expect(newRev).toBe(currentRev + 1);
    const after = await repo.getById(findingId);
    expect(after?.posterior).toBe(0.8);
    expect(after?.revision).toBe(currentRev + 1);
  });

  it('setter with WRONG expectedRevision throws CasConflictError and does NOT mutate', async () => {
    const before = await repo.getById(findingId);
    const stale = before!.revision - 1; // certain to be wrong
    await expect(repo.setPosterior(findingId, 0.99, stale)).rejects.toBeInstanceOf(
      CasConflictError,
    );
    const after = await repo.getById(findingId);
    // No mutation — posterior and revision unchanged.
    expect(after?.posterior).toBe(before?.posterior);
    expect(after?.revision).toBe(before?.revision);
  });

  it('under concurrent CAS contention, exactly one writer wins and the others get CasConflictError', async () => {
    const before = await repo.getById(findingId);
    const startRev = before!.revision;
    const N = 5;
    const writers = Array.from({ length: N }, (_, i) =>
      repo.setPosterior(findingId, 0.6 + i * 0.01, startRev),
    );
    const results = await Promise.allSettled(writers);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter(
      (r) => r.status === 'rejected' && r.reason instanceof CasConflictError,
    );

    // Exactly one CAS write can succeed against a given startRev.
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(N - 1);

    // The winner's revision is startRev + 1.
    const winnerRev = (fulfilled[0] as PromiseFulfilledResult<number>).value;
    expect(winnerRev).toBe(startRev + 1);

    // Database state reflects exactly one write.
    const after = await repo.getById(findingId);
    expect(after?.revision).toBe(startRev + 1);
  }, 30_000);

  it('setState honours CAS', async () => {
    const before = await repo.getById(findingId);
    const stale = before!.revision - 5;
    await expect(repo.setState(findingId, 'closed', 'cas-test', stale)).rejects.toBeInstanceOf(
      CasConflictError,
    );
    const after = await repo.getById(findingId);
    expect(after?.state).toBe(before?.state); // unchanged
  });

  it('setCounterEvidence honours CAS', async () => {
    const before = await repo.getById(findingId);
    const stale = before!.revision - 5;
    await expect(
      repo.setCounterEvidence(findingId, 'should-not-stick', 'review', stale),
    ).rejects.toBeInstanceOf(CasConflictError);
    const after = await repo.getById(findingId);
    expect(after?.counter_evidence).toBe(before?.counter_evidence); // unchanged
  });

  it('setRecommendedRecipientBody honours CAS', async () => {
    const before = await repo.getById(findingId);
    const stale = before!.revision - 5;
    await expect(
      repo.setRecommendedRecipientBody(findingId, 'CONAC', 'P-X-001', stale),
    ).rejects.toBeInstanceOf(CasConflictError);
    const after = await repo.getById(findingId);
    expect(after?.recommended_recipient_body).toBe(before?.recommended_recipient_body); // unchanged
  });
});
