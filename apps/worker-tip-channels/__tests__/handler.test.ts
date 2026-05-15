import { generateBoxKeyPair } from '@vigil/security';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import {
  descriptorFromPayload,
  handleTipChannelsEvent,
  zTipChannelsPayload,
  type TipChannelsPayload,
} from '../src/handler.js';

import type { HashChain } from '@vigil/audit-chain';
import type { TipRepo } from '@vigil/db-postgres';
import type { Envelope } from '@vigil/queue';

let PUBKEY = '';
beforeAll(async () => {
  const kp = await generateBoxKeyPair();
  PUBKEY = kp.publicKey;
});

const sampleEnvelope = (payload: TipChannelsPayload): Envelope<TipChannelsPayload> => ({
  id: '00000000-0000-0000-0000-000000000001',
  dedup_key: 'gw-001-2026-05-15T00:00:00Z',
  correlation_id: 'corr-001',
  producer: 'gateway-test',
  produced_at: '2026-05-15T00:00:00.000Z',
  schema_version: 1,
  payload,
});

const mockRepo = (refSeq: number, insertImpl?: () => Promise<void>): TipRepo =>
  ({
    nextRefSeqForYear: vi.fn().mockResolvedValue(refSeq),
    insert: vi.fn().mockImplementation(insertImpl ?? (async () => undefined)),
  }) as unknown as TipRepo;

const mockChain = (): HashChain =>
  ({ append: vi.fn().mockResolvedValue(undefined) }) as unknown as HashChain;

const silentLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
  fatal: vi.fn(),
  child: () => silentLogger,
} as unknown as Parameters<typeof handleTipChannelsEvent>[0]['logger'];

describe('descriptorFromPayload', () => {
  it('reassembles USSD multi-segments', () => {
    const d = descriptorFromPayload({
      kind: 'ussd',
      language: 'fr',
      gateway_request_id: 'g',
      gateway_at: '2026-05-15T00:00:00Z',
      ussd_segments: [
        { index: 0, text: 'partie un ' },
        { index: 1, text: 'partie deux' },
      ],
    });
    expect(d.channel).toBe('ussd');
    expect(d.body_plaintext).toBe('partie un partie deux');
  });

  it('extracts SMS body', () => {
    const d = descriptorFromPayload({
      kind: 'sms',
      language: 'en',
      gateway_request_id: 'g',
      gateway_at: '2026-05-15T00:00:00Z',
      sms_body: 'observation about a tender',
    });
    expect(d.channel).toBe('sms');
    expect(d.body_plaintext).toBe('observation about a tender');
  });

  it('promotes voice transcription via voiceToIncoming', () => {
    const d = descriptorFromPayload({
      kind: 'voice',
      language: 'fr',
      gateway_request_id: 'g',
      gateway_at: '2026-05-15T00:00:00Z',
      voice_transcription: {
        transcription_text: 'observation orale',
        language: 'fr',
        confidence: 0.9,
        duration_seconds: 30,
      },
    });
    expect(d.channel).toBe('voice');
    expect(d.body_plaintext).toBe('observation orale');
  });

  it('rejects ussd kind without segments', () => {
    expect(() =>
      descriptorFromPayload({
        kind: 'ussd',
        language: 'fr',
        gateway_request_id: 'g',
        gateway_at: '2026-05-15T00:00:00Z',
      }),
    ).toThrow(/ussd_segments/);
  });

  it('rejects sms kind without body', () => {
    expect(() =>
      descriptorFromPayload({
        kind: 'sms',
        language: 'fr',
        gateway_request_id: 'g',
        gateway_at: '2026-05-15T00:00:00Z',
      }),
    ).toThrow(/sms_body/);
  });

  it('rejects low-confidence voice transcription', () => {
    expect(() =>
      descriptorFromPayload({
        kind: 'voice',
        language: 'fr',
        gateway_request_id: 'g',
        gateway_at: '2026-05-15T00:00:00Z',
        voice_transcription: {
          transcription_text: 'unclear',
          language: 'fr',
          confidence: 0.3,
          duration_seconds: 30,
        },
      }),
    ).toThrow(/confidence/);
  });
});

describe('zTipChannelsPayload schema', () => {
  it('accepts a valid USSD payload', () => {
    const result = zTipChannelsPayload.safeParse({
      kind: 'ussd',
      language: 'fr',
      gateway_request_id: 'g-001',
      gateway_at: '2026-05-15T00:00:00Z',
      ussd_segments: [{ index: 0, text: 'hello' }],
    });
    expect(result.success).toBe(true);
  });

  it('coerces unknown language to fr', () => {
    const result = zTipChannelsPayload.parse({
      kind: 'sms',
      language: 'zz',
      gateway_request_id: 'g-001',
      gateway_at: '2026-05-15T00:00:00Z',
      sms_body: 'hi',
    });
    expect(result.language).toBe('fr');
  });

  it('rejects unknown kind', () => {
    const result = zTipChannelsPayload.safeParse({
      kind: 'fax',
      language: 'fr',
      gateway_request_id: 'g',
      gateway_at: '2026-05-15T00:00:00Z',
    });
    expect(result.success).toBe(false);
  });
});

describe('handleTipChannelsEvent', () => {
  it('encrypts, persists, and emits an audit row on the happy path', async () => {
    const repo = mockRepo(42);
    const chain = mockChain();
    const env = sampleEnvelope({
      kind: 'sms',
      language: 'fr',
      gateway_request_id: 'g-1',
      gateway_at: '2026-05-15T00:00:00Z',
      sms_body: 'Observation about a procurement irregularity',
      region: 'CE',
    });

    const result = await handleTipChannelsEvent(
      { tipRepo: repo, chain, councilPublicKeyB64: PUBKEY, logger: silentLogger },
      env,
    );

    expect(result).toEqual({ kind: 'ack' });
    expect(repo.insert).toHaveBeenCalledTimes(1);
    const inserted = (repo.insert as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(inserted.ref).toMatch(/^TIP-\d{4}-0042$/);
    expect(inserted.disposition).toBe('NEW');
    expect(inserted.topic_hint).toBe('channel:sms');
    expect(inserted.region).toBe('CE');
    expect(Buffer.isBuffer(inserted.body_ciphertext)).toBe(true);
    expect(inserted.body_ciphertext.length).toBeGreaterThan(0);
    expect(chain.append).toHaveBeenCalledTimes(1);
    const chainArg = (chain.append as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(chainArg.action).toBe('audit.tip_received_channel');
    expect(chainArg.payload.channel).toBe('sms');
    expect(chainArg.payload.language).toBe('fr');
    // Plaintext must never appear on the chain
    expect(JSON.stringify(chainArg.payload)).not.toContain('Observation about a procurement');
  });

  it('dead-letters on a malformed payload (caught by descriptor)', async () => {
    const repo = mockRepo(1);
    const chain = mockChain();
    const env = sampleEnvelope({
      kind: 'ussd',
      language: 'fr',
      gateway_request_id: 'g-2',
      gateway_at: '2026-05-15T00:00:00Z',
      ussd_segments: [],
    });

    const result = await handleTipChannelsEvent(
      { tipRepo: repo, chain, councilPublicKeyB64: PUBKEY, logger: silentLogger },
      env,
    );

    expect(result.kind).toBe('dead-letter');
    expect(repo.insert).not.toHaveBeenCalled();
    expect(chain.append).not.toHaveBeenCalled();
  });

  it('acks on duplicate-key DB error (idempotent retry survives)', async () => {
    const repo = mockRepo(7, async () => {
      throw new Error('duplicate key value violates unique constraint "tip_ref_unique"');
    });
    const chain = mockChain();
    const env = sampleEnvelope({
      kind: 'sms',
      language: 'fr',
      gateway_request_id: 'g-3',
      gateway_at: '2026-05-15T00:00:00Z',
      sms_body: 'tip body',
    });

    const result = await handleTipChannelsEvent(
      { tipRepo: repo, chain, councilPublicKeyB64: PUBKEY, logger: silentLogger },
      env,
    );

    expect(result).toEqual({ kind: 'ack' });
    expect(chain.append).not.toHaveBeenCalled();
  });

  it('retries on transient DB error', async () => {
    const repo = mockRepo(8, async () => {
      throw new Error('connection terminated unexpectedly');
    });
    const chain = mockChain();
    const env = sampleEnvelope({
      kind: 'sms',
      language: 'fr',
      gateway_request_id: 'g-4',
      gateway_at: '2026-05-15T00:00:00Z',
      sms_body: 'tip body',
    });

    const result = await handleTipChannelsEvent(
      { tipRepo: repo, chain, councilPublicKeyB64: PUBKEY, logger: silentLogger },
      env,
    );

    expect(result.kind).toBe('retry');
  });
});
