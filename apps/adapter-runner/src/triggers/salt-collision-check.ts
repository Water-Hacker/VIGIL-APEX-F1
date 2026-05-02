import { auditSaltCollisionsTotal } from '@vigil/observability';
import { sql } from 'drizzle-orm';

import type { Db } from '@vigil/db-postgres';
import type { Logger } from '@vigil/observability';

/**
 * AUDIT-024 / Block-E E.11 / A5.4 — salt-collision detection.
 *
 * The TAL-PA quarterly export (DECISION-012) hashes every actor_id with
 * a per-quarter salt (`AUDIT_PUBLIC_EXPORT_SALT`). The migration
 * `0012_audit_export_salt_fingerprint.sql` records `salt_fingerprint`
 * (first 8 hex of sha256(salt)) on every `audit.public_export` row and
 * exposes the view `audit.public_export_salt_collisions` listing any
 * pair of consecutive exports that share a fingerprint — i.e. a
 * forgotten salt rotation.
 *
 * This trigger queries the view; if any row is returned, it:
 *
 *   1. Logs an `audit.public_export.salt_collision` error with the
 *      colliding period labels — the operator alert is the log line,
 *      the Prometheus alert rule scrapes the same field via the
 *      adapter-runner's structured-log scraper.
 *   2. Throws a `SaltCollisionError` so the caller's catch block can
 *      surface it (the existing scheduler logs the error; we DO NOT
 *      swallow — a missed rotation is a sovereign-evidence quality
 *      defect).
 *
 * Cadence: 90-day detection window per BLOCK-E-PLAN §2.11. The cron
 * runs alongside the existing `quarterly-audit-export` cron (5:00am
 * day-1 of January / April / July / October Africa/Douala). Running
 * AFTER the quarterly export means the just-written row is included
 * in the collision search.
 *
 * Idempotent: the view is read-only; running the check twice in a row
 * with no new exports produces identical output.
 */

export class SaltCollisionError extends Error {
  override readonly name = 'SaltCollisionError';
  readonly collisions: ReadonlyArray<{
    curr_id: string;
    curr_period: string;
    prev_period: string;
    salt_fingerprint: string;
  }>;
  constructor(collisions: SaltCollisionError['collisions']) {
    super(
      `audit.public_export_salt_collisions returned ${collisions.length} row(s) — a previous quarter's salt was reused. Rotate AUDIT_PUBLIC_EXPORT_SALT immediately and re-export the affected period(s).`,
    );
    this.collisions = collisions;
  }
}

export interface SaltCollisionCheckDeps {
  readonly db: Db;
  readonly logger: Logger;
}

export interface SaltCollisionCheckResult {
  readonly status: 'clean' | 'collisions';
  readonly collisionCount: number;
}

interface CollisionRow extends Record<string, unknown> {
  readonly curr_id: string;
  readonly curr_period: string;
  readonly prev_period: string;
  readonly salt_fingerprint: string;
}

export async function runSaltCollisionCheck(
  deps: SaltCollisionCheckDeps,
): Promise<SaltCollisionCheckResult> {
  const { db, logger } = deps;
  const result = await db.execute<CollisionRow>(
    sql`SELECT curr_id::text, curr_period, prev_period, salt_fingerprint
        FROM audit.public_export_salt_collisions`,
  );
  const rows: CollisionRow[] = ((result as unknown as { rows?: CollisionRow[] }).rows ??
    (Array.isArray(result) ? (result as CollisionRow[]) : [])) as CollisionRow[];
  if (rows.length === 0) {
    auditSaltCollisionsTotal.set(0);
    logger.info({ collisions: 0 }, 'salt-collision-check-clean');
    return { status: 'clean', collisionCount: 0 };
  }
  auditSaltCollisionsTotal.set(rows.length);
  logger.error(
    {
      event: 'audit.public_export.salt_collision',
      collisions: rows.map((r) => ({
        curr_period: r.curr_period,
        prev_period: r.prev_period,
        salt_fingerprint: r.salt_fingerprint,
      })),
    },
    'salt-collision-detected',
  );
  throw new SaltCollisionError(rows);
}
