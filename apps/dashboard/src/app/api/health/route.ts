import { NextResponse } from 'next/server';

/**
 * Health endpoint — used by Docker healthcheck + Caddy. Returns 200 with a
 * minimal JSON body. Does NOT touch Postgres / Redis to avoid cascading
 * failures on transient backend outages.
 */
export const dynamic = 'force-dynamic';

export function GET(): NextResponse {
  return NextResponse.json({
    status: 'ok',
    service: 'vigil-dashboard',
    ts: new Date().toISOString(),
  });
}
