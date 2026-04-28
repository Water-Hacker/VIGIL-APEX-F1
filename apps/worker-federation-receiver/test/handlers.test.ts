import { describe, expect, it, vi } from 'vitest';

import type { EventEnvelope, RegionCode } from '@vigil/federation-stream';
import type { Logger } from '@vigil/observability';
import type { QueueClient } from '@vigil/queue';
import type Redis from 'ioredis';
import { Schemas } from '@vigil/shared';

import { FederationReceiverHandlers } from '../src/handlers.js';

/**
 * Unit tests for the receiver's payload-contract decode path. The L4
 * integration test exercises the gRPC + sign/verify path with a
 * capturing handler; this file exercises the FederationReceiverHandlers
 * decode/validation logic directly with synthetic envelopes.
 *
 * Coverage targets:
 *   1. Happy path: valid SourceEvent JSON → published on ADAPTER_OUT
 *   2. Invalid UTF-8 in payload bytes → handler throws
 *   3. Invalid JSON → handler throws
 *   4. Schema-invalid (missing fields) → handler throws
 *   5. source_id mismatch between envelope and inner SourceEvent → throws
 *   6. dedup_key mismatch between envelope and inner SourceEvent → throws
 *   7. Beacon round-trip reads/writes the lag hash correctly
 */

const REGION: RegionCode = 'CE';

function silentLogger(): Logger {
  // Cast through unknown — the test never asserts log output.
  return {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
    trace: () => undefined,
    fatal: () => undefined,
    child: () => silentLogger(),
  } as unknown as Logger;
}

function fakeQueue(): { queue: QueueClient; published: unknown[] } {
  const published: unknown[] = [];
  const queue = {
    publish: vi.fn(async (_stream: string, env: unknown) => {
      published.push(env);
      return '0-0';
    }),
  } as unknown as QueueClient;
  return { queue, published };
}

function fakeRedis(): { redis: Redis; hash: Map<string, string> } {
  const hash = new Map<string, string>();
  const redis = {
    hset: vi.fn(async (_h: string, field: string, value: string) => {
      hash.set(field, value);
      return 1;
    }),
    hget: vi.fn(async (_h: string, field: string) => hash.get(field) ?? null),
  } as unknown as Redis;
  return { redis, hash };
}

function validSourceEvent(overrides: Partial<Schemas.SourceEvent> = {}): Schemas.SourceEvent {
  return {
    id: '01928c66-7e1f-7000-9000-000000000001',
    source_id: 'integration-test',
    kind: 'tender_notice',
    dedup_key: 'src::tender::2026-04-CE-0042',
    published_at: null,
    observed_at: '2026-04-28T12:00:00.000Z',
    payload: { contract_id: '2026-04-CE-0042' },
    document_cids: [],
    provenance: {
      url: 'https://example.cm/tender/0042',
      http_status: 200,
      response_sha256: 'a'.repeat(64),
      fetched_via_proxy: null,
      user_agent: 'vigil-adapter/0.1',
    },
    ...overrides,
  };
}

function envelopeWith(payload: Buffer, overrides: Partial<EventEnvelope> = {}): EventEnvelope {
  return {
    envelopeId: '01928c66-7e1f-7000-9000-aaaaaaaaaaaa',
    region: REGION,
    sourceId: 'integration-test',
    dedupKey: 'src::tender::2026-04-CE-0042',
    payload,
    observedAtMs: Date.now() - 5_000,
    signature: Buffer.alloc(64),
    signingKeyId: 'CE:1',
    ...overrides,
  };
}

describe('FederationReceiverHandlers.onAccepted', () => {
  it('publishes Envelope<SourceEvent> on ADAPTER_OUT for a valid payload', async () => {
    const { queue, published } = fakeQueue();
    const { redis, hash } = fakeRedis();
    const handlers = new FederationReceiverHandlers({
      queue,
      redis,
      logger: silentLogger(),
    });

    const ev = validSourceEvent();
    const env = envelopeWith(Buffer.from(JSON.stringify(ev), 'utf8'));
    await handlers.onAccepted(env);

    expect(published).toHaveLength(1);
    const wrapped = published[0] as { payload: Schemas.SourceEvent; correlation_id: string; dedup_key: string };
    expect(wrapped.payload.id).toBe(ev.id);
    expect(wrapped.payload.source_id).toBe(ev.source_id);
    expect(wrapped.correlation_id).toBe(env.envelopeId);
    expect(wrapped.dedup_key).toBe(`${REGION}:${ev.dedup_key}`);

    // Lag hash updated.
    expect(hash.get(REGION)).toBe(String(env.observedAtMs));
  });

  it('throws on payload that is not valid utf-8 / json', async () => {
    const { queue } = fakeQueue();
    const { redis } = fakeRedis();
    const handlers = new FederationReceiverHandlers({ queue, redis, logger: silentLogger() });

    const env = envelopeWith(Buffer.from('this is not json', 'utf8'));
    await expect(handlers.onAccepted(env)).rejects.toThrow(/federation-payload-invalid/);
  });

  it('throws on payload missing required SourceEvent fields', async () => {
    const { queue } = fakeQueue();
    const { redis } = fakeRedis();
    const handlers = new FederationReceiverHandlers({ queue, redis, logger: silentLogger() });

    // Missing every required field except source_id.
    const env = envelopeWith(Buffer.from(JSON.stringify({ source_id: 'integration-test' }), 'utf8'));
    await expect(handlers.onAccepted(env)).rejects.toThrow(/federation-payload-invalid/);
  });

  it('throws when the inner SourceEvent.source_id does not match the envelope', async () => {
    const { queue } = fakeQueue();
    const { redis } = fakeRedis();
    const handlers = new FederationReceiverHandlers({ queue, redis, logger: silentLogger() });

    const ev = validSourceEvent({ source_id: 'something-else' });
    const env = envelopeWith(Buffer.from(JSON.stringify(ev), 'utf8'));
    await expect(handlers.onAccepted(env)).rejects.toThrow(/source_id mismatch/);
  });

  it('throws when the inner SourceEvent.dedup_key does not match the envelope', async () => {
    const { queue } = fakeQueue();
    const { redis } = fakeRedis();
    const handlers = new FederationReceiverHandlers({ queue, redis, logger: silentLogger() });

    const ev = validSourceEvent({ dedup_key: 'totally-different-dedup-key' });
    const env = envelopeWith(Buffer.from(JSON.stringify(ev), 'utf8'));
    await expect(handlers.onAccepted(env)).rejects.toThrow(/dedup_key mismatch/);
  });
});

describe('FederationReceiverHandlers.onBeacon', () => {
  it('returns 0 lastObservedAtMs when no events have been seen for a region', async () => {
    const { queue } = fakeQueue();
    const { redis } = fakeRedis();
    const handlers = new FederationReceiverHandlers({ queue, redis, logger: silentLogger() });
    const reply = await handlers.onBeacon({ region: REGION, agentNowMs: Date.now(), agentSeqTotal: 0 });
    expect(reply.lastObservedAtMs).toBe(0);
    expect(reply.coreNowMs).toBeGreaterThan(0);
    expect(reply.throttleHintMs).toBe(0);
  });

  it('returns the most recent observed_at_ms after onAccepted has populated the lag hash', async () => {
    const { queue } = fakeQueue();
    const { redis } = fakeRedis();
    const handlers = new FederationReceiverHandlers({ queue, redis, logger: silentLogger() });

    const ev = validSourceEvent();
    const env = envelopeWith(Buffer.from(JSON.stringify(ev), 'utf8'), { observedAtMs: 1_700_000_000_000 });
    await handlers.onAccepted(env);

    const reply = await handlers.onBeacon({ region: REGION, agentNowMs: Date.now(), agentSeqTotal: 1 });
    expect(reply.lastObservedAtMs).toBe(1_700_000_000_000);
  });

  it('passes the configured throttleHintMs uniformly', async () => {
    const { queue } = fakeQueue();
    const { redis } = fakeRedis();
    const handlers = new FederationReceiverHandlers({
      queue,
      redis,
      logger: silentLogger(),
      throttleHintMs: 250,
    });
    const reply = await handlers.onBeacon({ region: REGION, agentNowMs: Date.now(), agentSeqTotal: 0 });
    expect(reply.throttleHintMs).toBe(250);
  });
});
