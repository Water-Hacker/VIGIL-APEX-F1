import { toPublicView } from '@vigil/audit-log';
import { UserActionEventRepo, getDb } from '@vigil/db-postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { AUDIT_PUBLIC_RATE_LIMIT, createPerKeyRateLimiter } from '../../../../lib/rate-limit';

// AUDIT-037: in-process per-IP rate limit. The Caddy edge also limits;
// this is defence-in-depth + a sane default before the operator-facing
// audit query route lands. 60 s / 200 burst per key.
const limiter = createPerKeyRateLimiter(AUDIT_PUBLIC_RATE_LIMIT);

function clientKey(req: NextRequest): string {
  return (
    req.headers.get('cf-connecting-ip') ??
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown'
  );
}

// AUDIT-034: strict RFC-3339 ISO-8601 at the route boundary. Date.parse
// is lenient (accepts '2026-04-30' date-only, 'April 30 2026' US-format,
// etc.) and would reach repo.listPublic where Postgres ::timestamptz
// happily coerces — leaking a 5xx with PG error text on truly malformed
// input. zod's .datetime() pins the format.
const zIsoDatetime = z.string().datetime();

/**
 * GET /api/audit/public — TAL-PA public REST API.
 *
 * No authentication required. Anti-abuse rate-limit applied at the
 * gateway. Returns a paginated, PII-redacted list of audit events for
 * journalists, researchers, civil-society automation. The shape matches
 * `Schemas.PublicAuditView`.
 *
 * Query params:
 *   - since   ISO8601 (default: 24h ago)
 *   - until   ISO8601 (default: now)
 *   - category one of A..K
 *   - limit   1–500 (default 100)
 *   - offset  default 0
 */
export const dynamic = 'force-dynamic';

const VALID_CATEGORIES = new Set(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K']);

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (limiter.exceeded(clientKey(req))) {
    return NextResponse.json({ error: 'rate-limited' }, { status: 429 });
  }
  const url = req.nextUrl;
  const since =
    url.searchParams.get('since') ?? new Date(Date.now() - 24 * 3_600_000).toISOString();
  const until = url.searchParams.get('until') ?? new Date().toISOString();
  const categoryParam = url.searchParams.get('category');
  const category = categoryParam && VALID_CATEGORIES.has(categoryParam) ? categoryParam : undefined;
  // AUDIT-033: limit + offset must never produce NaN / Infinity /
  // negative / fractional values. The `limit` path went through clamp()
  // which already guarded against NaN; the `offset` path used a raw
  // Math.max(Number(...), 0) that returned NaN/Infinity intact when
  // the input was malformed. Route both through clamp(), with offset's
  // upper bound at Number.MAX_SAFE_INTEGER (effectively unbounded but
  // finite + integer).
  const limit = clamp(Number(url.searchParams.get('limit') ?? '100'), 1, 500);
  const offset = clamp(Number(url.searchParams.get('offset') ?? '0'), 0, Number.MAX_SAFE_INTEGER);

  // AUDIT-034: strict RFC-3339; reject lenient-parser oddities like
  // '2026-04-30' (date-only) or 'April 30 2026'.
  if (!zIsoDatetime.safeParse(since).success || !zIsoDatetime.safeParse(until).success) {
    return NextResponse.json({ error: 'invalid-time-bounds' }, { status: 400 });
  }

  const db = await getDb();
  const repo = new UserActionEventRepo(db);
  const rows = await repo.listPublic({
    sinceIso: since,
    untilIso: until,
    ...(category !== undefined && { category }),
    limit,
    offset,
  });
  const events = rows.map((r) =>
    toPublicView({
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
    }),
  );
  return NextResponse.json(
    {
      since,
      until,
      ...(category !== undefined && { category }),
      limit,
      offset,
      count: events.length,
      events,
    },
    {
      status: 200,
      headers: {
        'Cache-Control': 'public, max-age=60',
        'Content-Security-Policy': "default-src 'none'",
      },
    },
  );
}

function clamp(n: number, min: number, max: number): number {
  if (Number.isNaN(n)) return min;
  return Math.max(min, Math.min(max, Math.floor(n)));
}
