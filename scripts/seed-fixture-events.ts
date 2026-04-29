#!/usr/bin/env -S npx tsx
/**
 * Seed a deterministic Phase-1 fixture into a running compose stack.
 *
 * Inserts:
 *   - 1 source.event (kind=investment_project, GPS=Yaoundé, 90-day contract)
 *   - 1 source.event (kind=treasury_disbursement) referencing the project
 *   - 1 finding stub primed at posterior = 0.42 to walk through the
 *     enter-review → vote → escalate → render path
 *
 * Used by `scripts/e2e-fixture.sh` as the canonical end-to-end smoke run.
 *
 * Usage: POSTGRES_URL=... npx tsx scripts/seed-fixture-events.ts
 */
import { Pool } from 'pg';

const POSTGRES_URL = process.env.POSTGRES_URL ?? process.env.INTEGRATION_DB_URL;
if (!POSTGRES_URL) {
  console.error('POSTGRES_URL or INTEGRATION_DB_URL must be set');
  process.exit(1);
}

const FIXTURE_PROJECT_ID = '00000000-0000-0000-0000-fixture000001';
const FIXTURE_FINDING_ID = '00000000-0000-0000-0000-fixture000002';
const FIXTURE_TENDER_ID = 'CTR-FIXTURE-2026-001';
const YAOUNDE_LAT = 3.866;
const YAOUNDE_LON = 11.5167;

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: POSTGRES_URL });

  try {
    console.log('seeding fixture events into', POSTGRES_URL.replace(/:[^:@/]*@/, ':***@'));

    // 1. investment_project source event with GPS + contract window
    await pool.query(
      `INSERT INTO source.events
         (id, source_id, kind, fetched_at, occurred_at, payload, dedup_key)
       VALUES (gen_random_uuid(), $1, $2, now(), now() - interval '7 days', $3::jsonb, $4)
       ON CONFLICT (dedup_key) DO NOTHING`,
      [
        'fixture-source',
        'investment_project',
        JSON.stringify({
          project_id: FIXTURE_PROJECT_ID,
          tender_id: FIXTURE_TENDER_ID,
          gps: { lat: YAOUNDE_LAT, lon: YAOUNDE_LON },
          contract_start: '2026-01-01',
          contract_end: '2026-04-01',
          declared_value_xaf: '5000000000',
          declared_supplier: 'FIXTURE_SUPPLIER_SARL',
        }),
        `fixture:${FIXTURE_PROJECT_ID}:investment_project`,
      ],
    );

    // 2. treasury_disbursement event so P-D-001 has a payment to compare against
    await pool.query(
      `INSERT INTO source.events
         (id, source_id, kind, fetched_at, occurred_at, payload, dedup_key)
       VALUES (gen_random_uuid(), $1, $2, now(), now() - interval '5 days', $3::jsonb, $4)
       ON CONFLICT (dedup_key) DO NOTHING`,
      [
        'fixture-source',
        'treasury_disbursement',
        JSON.stringify({
          project_id: FIXTURE_PROJECT_ID,
          tender_id: FIXTURE_TENDER_ID,
          amount_xaf: '4500000000',
          paid_at: '2026-02-15T10:00:00Z',
          recipient: 'FIXTURE_SUPPLIER_SARL',
        }),
        `fixture:${FIXTURE_PROJECT_ID}:treasury_disbursement`,
      ],
    );

    // 3. finding stub
    await pool.query(
      `INSERT INTO finding.finding
         (id, ref, primary_pattern_id, prior_probability, posterior_probability,
          summary, severity, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
       ON CONFLICT (id) DO NOTHING`,
      [
        FIXTURE_FINDING_ID,
        'VA-2026-FIXTURE-001',
        'P-D-001',
        '0.20',
        '0.42',
        'Fixture finding: Yaoundé project, partial disbursement vs declared value',
        'medium',
        'review',
      ],
    );

    console.log('✓ fixture events seeded');
    console.log(`  project_id = ${FIXTURE_PROJECT_ID}`);
    console.log(`  finding_id = ${FIXTURE_FINDING_ID}`);
    console.log(`  finding ref = VA-2026-FIXTURE-001`);
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error('seed-fixture failed:', err);
  process.exit(1);
});
