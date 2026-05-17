/**
 * /api/alerts/[id]/acknowledge — input validation regression checks.
 *
 * Source-grep style: the route's load-bearing decisions (UUID
 * regex, allowed target-state set, audit() wrapper, halt-on-failure)
 * are verified by reading the file. The full end-to-end behaviour
 * requires a live Postgres + Vault audit-emitter stack — covered by
 * integration tests gated on INTEGRATION_DB_URL.
 */
import { describe, expect, it } from 'vitest';

describe('/api/alerts/[id]/acknowledge — source-pinned invariants', () => {
  it('the route source enforces a UUID regex on the id parameter', async () => {
    const { readFile } = await import('node:fs/promises');
    const path = await import('node:path');
    const src = await readFile(
      path.resolve(__dirname, '../src/app/api/alerts/[id]/acknowledge/route.ts'),
      'utf8',
    );
    // Pinned UUID regex — defends against id-injection (the SQL
    // path also casts to ::uuid as belt+braces).
    expect(src).toMatch(/UUID_RE\s*=\s*\/\^/);
    expect(src).toMatch(/invalid-id/);
  });

  it('only the three allowed target states reach the transition function', async () => {
    const { readFile } = await import('node:fs/promises');
    const path = await import('node:path');
    const src = await readFile(
      path.resolve(__dirname, '../src/app/api/alerts/[id]/acknowledge/route.ts'),
      'utf8',
    );
    // ALLOWED_TARGETS is the gate. Open is NOT a valid forward
    // transition (alerts start at open; acknowledging "back to open"
    // would be operator confusion-as-DoS).
    expect(src).toMatch(
      /ALLOWED_TARGETS[\s\S]+acknowledged[\s\S]+dismissed[\s\S]+promoted_to_finding/,
    );
    // Open MUST NOT be in the set.
    expect(src).not.toMatch(/ALLOWED_TARGETS[\s\S]+'open'/);
  });

  it('the route wraps the transition in audit() with status.changed', async () => {
    const { readFile } = await import('node:fs/promises');
    const path = await import('node:path');
    const src = await readFile(
      path.resolve(__dirname, '../src/app/api/alerts/[id]/acknowledge/route.ts'),
      'utf8',
    );
    // status.changed is the TAL-PA Cat-E event-type for an
    // operator-driven row mutation. The wrapper writes the audit row
    // BEFORE the DB UPDATE — halt-on-failure semantics ensure no
    // "dark periods".
    expect(src).toMatch(/eventType:\s*'status\.changed'/);
    expect(src).toMatch(/audit\(\s*req/);
    expect(src).toMatch(/AuditEmitterUnavailableError/);
  });

  it('the 409 + 404 + 503 ladder is encoded explicitly', async () => {
    const { readFile } = await import('node:fs/promises');
    const path = await import('node:path');
    const src = await readFile(
      path.resolve(__dirname, '../src/app/api/alerts/[id]/acknowledge/route.ts'),
      'utf8',
    );
    expect(src).toMatch(/status:\s*404/);
    expect(src).toMatch(/status:\s*409/);
    expect(src).toMatch(/status:\s*503/);
    expect(src).toMatch(/AlertNotFoundError/);
    expect(src).toMatch(/AlertNoOpTransitionError/);
  });
});

describe('/api/alerts/stream — SSE source-pinned invariants', () => {
  it('uses nodejs runtime (Edge runtime times out long-lived streams)', async () => {
    const { readFile } = await import('node:fs/promises');
    const path = await import('node:path');
    const src = await readFile(
      path.resolve(__dirname, '../src/app/api/alerts/stream/route.ts'),
      'utf8',
    );
    expect(src).toMatch(/runtime\s*=\s*'nodejs'/);
    expect(src).toMatch(/dynamic\s*=\s*'force-dynamic'/);
  });

  it('opens with a 25-second heartbeat and a cancel signal', async () => {
    const { readFile } = await import('node:fs/promises');
    const path = await import('node:path');
    const src = await readFile(
      path.resolve(__dirname, '../src/app/api/alerts/stream/route.ts'),
      'utf8',
    );
    expect(src).toMatch(/startSseHeartbeat/);
    expect(src).toMatch(/25_000/);
    expect(src).toMatch(/AbortController/);
  });

  it('cursors on detected_at — the SSE primitive', async () => {
    const { readFile } = await import('node:fs/promises');
    const path = await import('node:path');
    const src = await readFile(
      path.resolve(__dirname, '../src/app/api/alerts/stream/route.ts'),
      'utf8',
    );
    expect(src).toMatch(/cursorIso/);
    expect(src).toMatch(/sinceIso:\s*cursorIso/);
  });

  it('emits SSE events under the `alert` event name', async () => {
    const { readFile } = await import('node:fs/promises');
    const path = await import('node:path');
    const src = await readFile(
      path.resolve(__dirname, '../src/app/api/alerts/stream/route.ts'),
      'utf8',
    );
    expect(src).toMatch(/event:\s*alert\\ndata:/);
  });
});

describe('middleware — /api/alerts is in ROUTE_RULES', () => {
  it('the /api/alerts prefix is gated to operator/auditor/architect', async () => {
    const { readFile } = await import('node:fs/promises');
    const path = await import('node:path');
    const src = await readFile(path.resolve(__dirname, '../src/middleware.ts'), 'utf8');
    expect(src).toMatch(
      /prefix:\s*'\/api\/alerts',\s*allow:\s*\[\s*'operator',\s*'auditor',\s*'architect'\s*\]/,
    );
    expect(src).toMatch(
      /prefix:\s*'\/alerts',\s*allow:\s*\[\s*'operator',\s*'auditor',\s*'architect'\s*\]/,
    );
  });
});
