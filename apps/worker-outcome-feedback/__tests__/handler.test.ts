import { describe, expect, it, vi } from 'vitest';

import { handleOutcomeSignal, type OutcomeSignalPayload } from '../src/handler.js';

import type { HashChain } from '@vigil/audit-chain';
import type { DeliveredDossierRow, DossierOutcomeRepo } from '@vigil/db-postgres';
import type { Envelope } from '@vigil/queue';

const silentLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
  fatal: vi.fn(),
  child: () => silentLogger,
} as unknown as Parameters<typeof handleOutcomeSignal>[0]['logger'];

const sampleEnv = (payload: OutcomeSignalPayload): Envelope<OutcomeSignalPayload> => ({
  id: '00000000-0000-0000-0000-000000000001',
  dedup_key: payload.signal_id,
  correlation_id: 'corr-001',
  producer: 'adapter-runner',
  produced_at: '2026-04-25T00:00:00.000Z',
  schema_version: 1,
  payload,
});

const sampleDeliveredRow = (overrides: Partial<DeliveredDossierRow> = {}): DeliveredDossierRow => ({
  dossier_id: '11111111-1111-1111-1111-111111111111',
  dossier_ref: 'VA-2026-0142',
  recipient_body_name: 'CONAC',
  delivered_at: '2026-01-15T10:00:00Z',
  finding_id: '22222222-2222-2222-2222-222222222222',
  primary_entity_id: '33333333-3333-3333-3333-333333333333',
  primary_entity_name: 'Construction Plus SARL',
  primary_entity_aliases: ['Construction Plus'],
  rccm: 'RC/YAO/2024/B/0142',
  niu: 'M042200012345R',
  pattern_categories: ['A', 'B'],
  ubo_names: ['Jean Mballa'],
  ...overrides,
});

describe('handleOutcomeSignal', () => {
  it('persists a high-confidence match + emits one chain row', async () => {
    const rows = [sampleDeliveredRow()];
    const outcomeRepo = {
      insertIfAbsent: vi.fn().mockResolvedValue({ inserted: true }),
    } as unknown as DossierOutcomeRepo;
    const chain = { append: vi.fn().mockResolvedValue(undefined) } as unknown as HashChain;
    const listDelivered = vi.fn().mockResolvedValue(rows);

    const env = sampleEnv({
      signal_id: 'sig-001',
      source: 'conac_press',
      kind: 'investigation_opened',
      date: '2026-04-20T10:00:00Z',
      text: 'CONAC ouvre une enquête sur Construction Plus SARL pour irrégularités dans un marché de soumissionnaire unique.',
      entities_mentioned: ['Construction Plus SARL'],
    });

    const result = await handleOutcomeSignal(
      { chain, outcomeRepo, listDelivered, logger: silentLogger },
      env,
    );

    expect(result).toEqual({ kind: 'ack' });
    expect(outcomeRepo.insertIfAbsent).toHaveBeenCalledTimes(1);
    expect(chain.append).toHaveBeenCalledTimes(1);
    const chainArg = (chain.append as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(chainArg.action).toBe('audit.dossier_outcome_matched');
    expect(chainArg.subject_id).toBe('VA-2026-0142');
    expect(chainArg.payload.signal_source).toBe('conac_press');
  });

  it('does not emit a chain row when the insert was a no-op duplicate', async () => {
    const rows = [sampleDeliveredRow()];
    const outcomeRepo = {
      insertIfAbsent: vi.fn().mockResolvedValue({ inserted: false }),
    } as unknown as DossierOutcomeRepo;
    const chain = { append: vi.fn().mockResolvedValue(undefined) } as unknown as HashChain;
    const listDelivered = vi.fn().mockResolvedValue(rows);

    const env = sampleEnv({
      signal_id: 'sig-002',
      source: 'conac_press',
      kind: 'investigation_opened',
      date: '2026-04-20T10:00:00Z',
      text: 'CONAC enquête Construction Plus SARL marché soumissionnaire unique.',
      entities_mentioned: ['Construction Plus SARL'],
    });

    const result = await handleOutcomeSignal(
      { chain, outcomeRepo, listDelivered, logger: silentLogger },
      env,
    );

    expect(result).toEqual({ kind: 'ack' });
    expect(outcomeRepo.insertIfAbsent).toHaveBeenCalledTimes(1);
    expect(chain.append).not.toHaveBeenCalled();
  });

  it('skips low-confidence matches (entity overlap below 0.30)', async () => {
    const rows = [
      sampleDeliveredRow({
        primary_entity_name: 'Wholly Different Company',
        primary_entity_aliases: [],
        ubo_names: [],
        rccm: null,
        niu: null,
        pattern_categories: ['E'],
      }),
    ];
    const outcomeRepo = {
      insertIfAbsent: vi.fn().mockResolvedValue({ inserted: true }),
    } as unknown as DossierOutcomeRepo;
    const chain = { append: vi.fn().mockResolvedValue(undefined) } as unknown as HashChain;
    const listDelivered = vi.fn().mockResolvedValue(rows);

    const env = sampleEnv({
      signal_id: 'sig-003',
      source: 'conac_press',
      kind: 'investigation_opened',
      date: '2026-04-20T10:00:00Z',
      text: 'Affaire administrative.',
      entities_mentioned: ['Construction Plus SARL'],
    });

    const result = await handleOutcomeSignal(
      { chain, outcomeRepo, listDelivered, logger: silentLogger },
      env,
    );

    expect(result).toEqual({ kind: 'ack' });
    expect(outcomeRepo.insertIfAbsent).not.toHaveBeenCalled();
    expect(chain.append).not.toHaveBeenCalled();
  });

  it('retries on transient list-delivered failure', async () => {
    const outcomeRepo = {
      insertIfAbsent: vi.fn(),
    } as unknown as DossierOutcomeRepo;
    const chain = { append: vi.fn() } as unknown as HashChain;
    const listDelivered = vi.fn().mockRejectedValue(new Error('connection terminated'));

    const env = sampleEnv({
      signal_id: 'sig-004',
      source: 'conac_press',
      kind: 'investigation_opened',
      date: '2026-04-20T10:00:00Z',
      text: 'CONAC enquête.',
      entities_mentioned: ['X'],
    });

    const result = await handleOutcomeSignal(
      { chain, outcomeRepo, listDelivered, logger: silentLogger },
      env,
    );

    expect(result.kind).toBe('retry');
    expect(outcomeRepo.insertIfAbsent).not.toHaveBeenCalled();
  });
});
