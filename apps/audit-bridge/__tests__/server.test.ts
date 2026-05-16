import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// Stub the postgres pool factory before the server module loads.
const fakePool = { query: vi.fn(), connect: vi.fn() };
vi.mock('@vigil/db-postgres', () => ({
  getPool: async () => fakePool,
}));

// Stub HashChain so /append doesn't need a real DB.
const fakeAppend = vi.fn(async (input: Record<string, unknown>) => ({
  id: '11111111-1111-1111-1111-111111111111',
  seq: 42,
  body_hash: 'a'.repeat(64),
  prev_hash: 'b'.repeat(64),
  occurred_at: '2026-04-29T12:00:00.000Z',
  action: input.action,
  actor: input.actor,
  subject_kind: input.subject_kind,
  subject_id: input.subject_id,
  payload: input.payload,
}));
vi.mock('@vigil/audit-chain', () => ({
  HashChain: class {
    append = fakeAppend;
  },
}));

import { createAuditBridgeServer } from '../src/server.js';

const FAKE_LOGGER = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  fatal: vi.fn(),
  trace: vi.fn(),
  child: () => FAKE_LOGGER,
} as never;

describe('audit-bridge server', () => {
  let server: Awaited<ReturnType<typeof createAuditBridgeServer>>;
  const socketPath = '/tmp/vigil-audit-bridge-test.sock';

  beforeAll(async () => {
    server = await createAuditBridgeServer({ logger: FAKE_LOGGER, socketPath });
    await server.start();
  });

  afterAll(async () => {
    await server.stop();
  });

  it('responds 200 on GET /health', async () => {
    const res = await server.app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it('400s on POST /append with malformed body', async () => {
    const res = await server.app.inject({
      method: 'POST',
      url: '/append',
      payload: { foo: 'bar' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid-body');
  });

  it('200s on POST /append with a valid body and returns the chain row', async () => {
    const body = {
      action: 'audit.public_export_published',
      actor: 'system:test',
      subject_kind: 'system',
      subject_id: 'audit-export',
      payload: { period_label: '2026-Q1' },
    };
    const res = await server.app.inject({ method: 'POST', url: '/append', payload: body });
    expect(res.statusCode).toBe(200);
    const j = res.json();
    expect(j.id).toBe('11111111-1111-1111-1111-111111111111');
    expect(j.seq).toBe('42');
    expect(typeof j.body_hash).toBe('string');
    expect(fakeAppend).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'audit.public_export_published',
        actor: 'system:test',
      }),
    );
  });

  it('400s on POST /append with an action not in the AuditAction enum', async () => {
    const res = await server.app.inject({
      method: 'POST',
      url: '/append',
      payload: {
        action: 'invented.action.never_existed',
        actor: 'system:test',
        subject_kind: 'system',
        subject_id: 'x',
      },
    });
    expect(res.statusCode).toBe(400);
  });

  // ─── Tier-9 audit closures ─────────────────────────────────────────

  it('413s on POST /append with a body larger than 64 KB (DoS defence)', async () => {
    // Build a payload whose JSON serialisation exceeds 64 KB. The
    // outer envelope adds ~150 bytes; 70 KB of opaque string ensures
    // we cross the cap even after key + structural overhead.
    const fat = 'x'.repeat(70 * 1024);
    const res = await server.app.inject({
      method: 'POST',
      url: '/append',
      payload: {
        action: 'audit.public_export_published',
        actor: 'system:test',
        subject_kind: 'system',
        subject_id: 'oversize-payload',
        payload: { fat },
      },
    });
    // Fastify returns 413 with `{ statusCode: 413, code: 'FST_ERR_CTP_BODY_TOO_LARGE' }`.
    expect(res.statusCode).toBe(413);
  });

  it('returns an OPAQUE error on /append failure (no raw String(err) leak)', async () => {
    // Force HashChain.append to throw with a message that would leak
    // internal info if echoed verbatim. The post-fix response body
    // should NOT contain the leaked string.
    const leakyMessage =
      'connection failed: postgres://vigil:internal-creds@vigil-postgres:5432/vigil';
    fakeAppend.mockRejectedValueOnce(new Error(leakyMessage));

    const res = await server.app.inject({
      method: 'POST',
      url: '/append',
      payload: {
        action: 'audit.public_export_published',
        actor: 'system:test',
        subject_kind: 'system',
        subject_id: 'leak-test',
      },
    });
    expect(res.statusCode).toBe(500);
    const j = res.json() as { error?: string; message?: string };
    expect(j.error).toBe('append-failed');
    expect(j.message).toBeUndefined();
    expect(JSON.stringify(j)).not.toContain('internal-creds');
    expect(JSON.stringify(j)).not.toContain('vigil-postgres');
  });

  it('logs the full error message server-side even when the response is opaque', async () => {
    // Companion to the previous test — operators must still see the
    // root cause in structured logs; only the wire response is
    // opaque.
    const internalMessage = 'unique-internal-marker-for-test-assert';
    fakeAppend.mockRejectedValueOnce(new Error(internalMessage));

    await server.app.inject({
      method: 'POST',
      url: '/append',
      payload: {
        action: 'audit.public_export_published',
        actor: 'system:test',
        subject_kind: 'system',
        subject_id: 'log-test',
      },
    });

    const errorCalls = (FAKE_LOGGER.error as unknown as { mock: { calls: unknown[][] } }).mock
      .calls;
    const matched = errorCalls.find((c) => JSON.stringify(c).includes(internalMessage));
    expect(
      matched,
      'expected at least one logger.error call to carry the internal message',
    ).toBeDefined();
  });
});
