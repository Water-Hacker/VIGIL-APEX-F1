import { randomUUID } from 'node:crypto';

import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import * as schema from '../src/schema/index.js';
import { UserActionEventRepo } from '../src/repos/audit-log.js';

/**
 * DECISION-012 — chain integrity under contention.
 *
 * `UserActionEventRepo.insertAndAdvanceChain` is the only path that
 * appends to the per-actor TAL-PA chain. The contract: under concurrent
 * inserts for the same actor, exactly one wins on each (prior_event_id)
 * value; subsequent callers re-fetch the head before retrying.
 *
 * This test runs only when `INTEGRATION_DB_URL` is set (mirrors how the
 * rest of the workspace gates DB-bound suites). When unset the suite is
 * skipped — `pnpm -r test` stays green without a Postgres dependency.
 */

const INTEGRATION_DB_URL = process.env.INTEGRATION_DB_URL;
const ACTOR = 'test-cas-actor:' + randomUUID();

describe.skipIf(!INTEGRATION_DB_URL)('audit-log per-actor CAS chain', () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let repo: UserActionEventRepo;

  beforeAll(async () => {
    pool = new Pool({ connectionString: INTEGRATION_DB_URL! });
    db = drizzle(pool, { schema });
    repo = new UserActionEventRepo(db);
    // Best-effort cleanup so re-runs are clean.
    await pool.query(`DELETE FROM audit.user_action_event WHERE actor_id = $1`, [ACTOR]);
    await pool.query(`DELETE FROM audit.user_action_chain WHERE actor_id = $1`, [ACTOR]);
  });

  afterAll(async () => {
    if (pool) {
      await pool.query(`DELETE FROM audit.user_action_event WHERE actor_id = $1`, [ACTOR]).catch(() => {});
      await pool.query(`DELETE FROM audit.user_action_chain WHERE actor_id = $1`, [ACTOR]).catch(() => {});
      await pool.end();
    }
  });

  function row(opts: { eventId: string; priorEventId: string | null; ts: Date }) {
    return {
      event_id: opts.eventId,
      global_audit_id: randomUUID(),
      event_type: 'auth.login_succeeded',
      category: 'A',
      timestamp_utc: opts.ts,
      actor_id: ACTOR,
      actor_role: 'operator',
      actor_yubikey_serial: null,
      actor_ip: null,
      actor_device_fingerprint: null,
      session_id: null,
      target_resource: '/cas-test',
      action_payload: {},
      result_status: 'success',
      prior_event_id: opts.priorEventId,
      correlation_id: null,
      digital_signature: 'sig',
      chain_anchor_tx: null,
      record_hash: 'rh-' + opts.eventId,
      high_significance: false,
    } as Parameters<typeof repo.insertAndAdvanceChain>[0];
  }

  it('rejects a stale prior_event_id when racing two concurrent inserts', async () => {
    // Genesis row.
    const genesisId = randomUUID();
    await repo.insertAndAdvanceChain(row({ eventId: genesisId, priorEventId: null, ts: new Date() }));

    // Both callers think the head is `genesisId`. Only one survives.
    const idA = randomUUID();
    const idB = randomUUID();
    const settled = await Promise.allSettled([
      repo.insertAndAdvanceChain(row({ eventId: idA, priorEventId: genesisId, ts: new Date() })),
      repo.insertAndAdvanceChain(row({ eventId: idB, priorEventId: genesisId, ts: new Date() })),
    ]);

    const successes = settled.filter((s) => s.status === 'fulfilled');
    const failures = settled.filter((s) => s.status === 'rejected');
    expect(successes.length).toBe(1);
    expect(failures.length).toBe(1);
    expect((failures[0] as PromiseRejectedResult).reason).toMatchObject({
      message: expect.stringMatching(/audit-log CAS failure/),
    });

    // Chain head is gap-free: latest_event_id is one of the two ids; chain has 2 rows.
    const head = await repo.latestForActor(ACTOR);
    expect(head).not.toBeNull();
    expect([idA, idB]).toContain(head!.eventId);
    const total = await pool.query<{ c: string }>(
      `SELECT COUNT(*)::bigint AS c FROM audit.user_action_event WHERE actor_id = $1`,
      [ACTOR],
    );
    expect(Number(total.rows[0]!.c)).toBe(2);

    // The follow-up insert must reference the survivor's id, not the loser.
    const idC = randomUUID();
    await repo.insertAndAdvanceChain(
      row({ eventId: idC, priorEventId: head!.eventId, ts: new Date() }),
    );
    const newHead = await repo.latestForActor(ACTOR);
    expect(newHead!.eventId).toBe(idC);

    // Sanity: feeding the loser's id as prior should fail.
    const loserId = head!.eventId === idA ? idB : idA;
    const idD = randomUUID();
    await expect(
      repo.insertAndAdvanceChain(
        row({ eventId: idD, priorEventId: loserId, ts: new Date() }),
      ),
    ).rejects.toThrow(/CAS failure/);

    // Suppress drizzle "no usage" warning on `sql` import.
    void sql;
  });
});
