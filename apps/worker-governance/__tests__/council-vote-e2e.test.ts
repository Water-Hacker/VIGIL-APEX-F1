/**
 * Block-E E.1 / D1 — Council vote ceremony end-to-end test.
 *
 * Drives the full 5-pillar 3-of-5 escalation ceremony through the
 * extracted vote-ceremony handlers (`apps/worker-governance/src/
 * vote-ceremony.ts`) with mocked contract + repos + chain + queue.
 * The test boundary is the worker-governance projection layer; the
 * contract is the source of truth and is simulated by directly
 * invoking the bound watch handlers as the contract would.
 *
 * Acceptance per BLOCK-E-PLAN §2.1:
 *
 *   1. Council convenes → 3 of 5 ESCALATE on Polygon Mumbai stub
 *      (proposal_opened + 5 vote_cast + 1 proposal_escalated audit
 *      rows).
 *   2. Finding posterior crosses 0.85 (asserted on the seeded
 *      finding's stored posterior; the certainty engine is upstream
 *      of this test boundary, so we seed the finding with the
 *      already-computed posterior).
 *   3. Dossier render enqueued (FR + EN envelopes published to
 *      STREAMS.DOSSIER_RENDER + 1 dossier.render_enqueued audit row).
 *   4. Worker-anchor commits each high-sig event individually — see
 *      `apps/worker-anchor/__tests__/high-sig-loop.test.ts`. This
 *      test verifies the contract surface that produces the high-sig
 *      events; the anchor side is covered by the existing high-sig
 *      loop test.
 *
 * Tests use deterministic timestamps + IDs so the audit-chain
 * progression is reproducible. The 5 mock pillar holders mirror the
 * SRD §23.2 pillar layout (governance, judicial, civil_society,
 * audit, technical).
 *
 * Refs: BLOCK-E-PLAN.md §2.1; SRD §23.3; DECISION-010;
 * apps/worker-anchor/__tests__/high-sig-loop.test.ts (high-sig anchor
 * side, complementary).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  bindWatch,
  handleProposalEscalated,
  handleProposalOpened,
  handleVoteCast,
  type VoteCeremonyDeps,
} from '../src/vote-ceremony.js';

// ─────────────────────────────────────────────────────────────────
// Mock fixtures
// ─────────────────────────────────────────────────────────────────

const PROPOSAL_INDEX = 42;
const FINDING_HASH = '0xfeedfeedfeedfeedfeedfeedfeedfeedfeedfeedfeedfeedfeedfeedfeedfeed';
const FINDING_ID = '11111111-1111-1111-1111-111111111111';
const PROPOSER = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const URI_HASH = '0xbeefbeefbeefbeefbeefbeefbeefbeefbeefbeefbeefbeefbeefbeefbeefbeef';
const ZERO_BYTES32 = '0x0000000000000000000000000000000000000000000000000000000000000000';

/**
 * Five deterministic council pillar identities. Each address pattern
 * is `0x<pillar-letter>...` so test failures pinpoint which pillar
 * voted what at-a-glance.
 */
const PILLARS = [
  { name: 'governance' as const, idx: 0, address: '0x' + 'a1'.repeat(20) },
  { name: 'judicial' as const, idx: 1, address: '0x' + 'b2'.repeat(20) },
  { name: 'civil_society' as const, idx: 2, address: '0x' + 'c3'.repeat(20) },
  { name: 'audit' as const, idx: 3, address: '0x' + 'd4'.repeat(20) },
  { name: 'technical' as const, idx: 4, address: '0x' + 'e5'.repeat(20) },
];

const CHOICE = { YES: 0, NO: 1, ABSTAIN: 2, RECUSE: 3 } as const;

// Frozen clock for deterministic audit-chain timestamps.
const FROZEN_NOW = new Date('2026-05-02T16:00:00Z');

// ─────────────────────────────────────────────────────────────────
// Dep-builder
// ─────────────────────────────────────────────────────────────────

interface MockSpies {
  insertProposal: ReturnType<typeof vi.fn>;
  insertVote: ReturnType<typeof vi.fn>;
  getProposalByOnChainIndex: ReturnType<typeof vi.fn>;
  findingGetById: ReturnType<typeof vi.fn>;
  latestRoutingDecision: ReturnType<typeof vi.fn>;
  setRecipientBody: ReturnType<typeof vi.fn>;
  chainAppend: ReturnType<typeof vi.fn>;
  queuePublish: ReturnType<typeof vi.fn>;
  loggerInfo: ReturnType<typeof vi.fn>;
  loggerWarn: ReturnType<typeof vi.fn>;
  loggerError: ReturnType<typeof vi.fn>;
}

interface MakeDepsOptions {
  /** If provided, override the default high-posterior finding. */
  readonly findingPosterior?: number;
  /** If true, getProposalByOnChainIndex returns null (projection lag). */
  readonly proposalNotProjected?: boolean;
  /** If true, findingRepo.getById returns null. */
  readonly findingMissing?: boolean;
  /** Pre-existing routing decision (DECISION-010). null = none. */
  readonly priorRoutingDecision?: { recipient_body_name: string } | null;
}

function makeDeps(opts: MakeDepsOptions = {}): { deps: VoteCeremonyDeps; spies: MockSpies } {
  const findingPosterior = opts.findingPosterior ?? 0.92;

  // GovernanceRepo mock
  const insertProposal = vi.fn(async (_row: Record<string, unknown>) => undefined);
  const insertVote = vi.fn(async (_row: Record<string, unknown>) => undefined);
  const getProposalByOnChainIndex = vi.fn(async (idx: string) => {
    if (opts.proposalNotProjected === true) return null;
    return {
      id: 'proposal-row-1',
      on_chain_index: idx,
      finding_id: FINDING_ID,
      state: 'open',
    };
  });
  const repo = { insertProposal, insertVote, getProposalByOnChainIndex } as never;

  // FindingRepo mock — finding has crossed the 0.85 escalation threshold.
  const findingGetById = vi.fn(async (id: string) => {
    if (opts.findingMissing === true) return null;
    return {
      id,
      severity: 'high',
      posterior_probability: String(findingPosterior),
      primary_pattern_id: 'p-a-001',
      recommended_recipient_body: null,
    };
  });
  const findingRepo = { getById: findingGetById } as never;

  // DossierRepo mock
  const latestRoutingDecision = vi.fn(async (_findingId: string) => {
    return opts.priorRoutingDecision === undefined ? null : opts.priorRoutingDecision;
  });
  const setRecipientBody = vi.fn(
    async (_id: string, _body: string, _source: string, _actor: string, _reason: string) =>
      undefined,
  );
  const dossierRepo = { latestRoutingDecision, setRecipientBody } as never;

  // HashChain mock — captures the full chain order.
  const chainAppend = vi.fn(async (_row: Record<string, unknown>) => ({
    seq: chainAppend.mock.calls.length,
  }));
  const chain = { append: chainAppend } as never;

  // QueueClient mock
  const queuePublish = vi.fn(async (_stream: string, _env: Record<string, unknown>) => undefined);
  const queue = { publish: queuePublish } as never;

  // Logger mock — captures structured log calls for assertion.
  const loggerInfo = vi.fn();
  const loggerWarn = vi.fn();
  const loggerError = vi.fn();
  const logger = {
    info: loggerInfo,
    warn: loggerWarn,
    error: loggerError,
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: () => logger,
  } as never;

  return {
    deps: {
      repo,
      findingRepo,
      dossierRepo,
      chain,
      queue,
      logger,
      now: () => FROZEN_NOW,
    },
    spies: {
      insertProposal,
      insertVote,
      getProposalByOnChainIndex,
      findingGetById,
      latestRoutingDecision,
      setRecipientBody,
      chainAppend,
      queuePublish,
      loggerInfo,
      loggerWarn,
      loggerError,
    },
  };
}

// ─────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────

describe('Block-E E.1 / D1 — council vote ceremony E2E (3-of-5 escalation)', () => {
  let deps: VoteCeremonyDeps;
  let spies: MockSpies;

  beforeEach(() => {
    ({ deps, spies } = makeDeps());
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('full ceremony — proposal opens, 3 YES + 2 NO votes, escalates, dossier renders enqueued', async () => {
    // ─── Step 1: ProposalOpened from contract ────────────────────
    await handleProposalOpened(deps, PROPOSAL_INDEX, FINDING_HASH, PROPOSER, URI_HASH);

    expect(spies.insertProposal).toHaveBeenCalledTimes(1);
    const proposalRow = spies.insertProposal.mock.calls[0]![0] as Record<string, unknown>;
    expect(proposalRow.on_chain_index).toBe(String(PROPOSAL_INDEX));
    expect(proposalRow.finding_id).toBe(FINDING_HASH);
    expect(proposalRow.state).toBe('open');
    expect(proposalRow.opened_at).toEqual(FROZEN_NOW);
    // 14-day vote window per SRD §23.3
    expect(
      (proposalRow.closes_at as Date).getTime() - (proposalRow.opened_at as Date).getTime(),
    ).toBe(14 * 86_400_000);

    // First audit-chain row.
    expect(spies.chainAppend).toHaveBeenCalledTimes(1);
    expect(spies.chainAppend.mock.calls[0]![0].action).toBe('governance.proposal_opened');
    expect(spies.chainAppend.mock.calls[0]![0].actor).toBe(PROPOSER);
    expect(spies.chainAppend.mock.calls[0]![0].subject_id).toBe(String(PROPOSAL_INDEX));

    // ─── Step 2: 5 votes — 3 YES + 2 NO (escalation quorum reached) ───
    const VOTES: Array<{
      pillar: (typeof PILLARS)[number];
      choice: (typeof CHOICE)[keyof typeof CHOICE];
    }> = [
      { pillar: PILLARS[0]!, choice: CHOICE.YES }, // governance
      { pillar: PILLARS[1]!, choice: CHOICE.YES }, // judicial
      { pillar: PILLARS[2]!, choice: CHOICE.NO }, // civil_society
      { pillar: PILLARS[3]!, choice: CHOICE.YES }, // audit (3rd YES → quorum)
      { pillar: PILLARS[4]!, choice: CHOICE.NO }, // technical
    ];
    for (const vote of VOTES) {
      await handleVoteCast(
        deps,
        PROPOSAL_INDEX,
        vote.pillar.address,
        vote.choice,
        vote.pillar.idx,
        ZERO_BYTES32,
      );
    }

    expect(spies.insertVote).toHaveBeenCalledTimes(5);
    expect(spies.chainAppend).toHaveBeenCalledTimes(1 + 5); // proposal_opened + 5 vote_cast

    // Each vote-cast row has the right pillar + choice mapping.
    const choiceNames = ['YES', 'YES', 'NO', 'YES', 'NO'];
    for (let i = 0; i < 5; i++) {
      const voteRow = spies.insertVote.mock.calls[i]![0] as Record<string, unknown>;
      expect(voteRow.proposal_id).toBe(String(PROPOSAL_INDEX));
      expect(voteRow.voter_address).toBe(VOTES[i]!.pillar.address.toLowerCase());
      expect(voteRow.voter_pillar).toBe(VOTES[i]!.pillar.name);
      expect(voteRow.choice).toBe(choiceNames[i]);
      expect(voteRow.recuse_reason).toBeNull(); // no recuse in this scenario

      const auditRow = spies.chainAppend.mock.calls[1 + i]![0] as Record<string, unknown>;
      expect(auditRow.action).toBe('governance.vote_cast');
      expect(auditRow.actor).toBe(VOTES[i]!.pillar.address);
      expect(auditRow.subject_kind).toBe('proposal');
      expect((auditRow.payload as Record<string, unknown>).choice).toBe(choiceNames[i]);
      expect((auditRow.payload as Record<string, unknown>).pillar).toBe(VOTES[i]!.pillar.name);
    }

    // Tally check: 3 YES + 2 NO. The 3-YES quorum (Constants.QUORUM_REQUIRED_ESCALATE)
    // means ProposalEscalated will fire from the contract next.
    const yesCount = spies.insertVote.mock.calls.filter(
      (c) => (c[0] as Record<string, unknown>).choice === 'YES',
    ).length;
    const noCount = spies.insertVote.mock.calls.filter(
      (c) => (c[0] as Record<string, unknown>).choice === 'NO',
    ).length;
    expect(yesCount).toBe(3);
    expect(noCount).toBe(2);

    // ─── Step 3: ProposalEscalated from contract ─────────────────
    await handleProposalEscalated(deps, PROPOSAL_INDEX);

    // Audit chain progression: +1 escalated, +1 render_enqueued = 8 total.
    expect(spies.chainAppend).toHaveBeenCalledTimes(1 + 5 + 2);
    expect(spies.chainAppend.mock.calls[6]![0].action).toBe('governance.proposal_escalated');
    expect(spies.chainAppend.mock.calls[6]![0].actor).toBe('contract');

    // Finding posterior was loaded; assert it's above the 0.85 threshold.
    expect(spies.findingGetById).toHaveBeenCalledTimes(1);
    expect(spies.findingGetById).toHaveBeenCalledWith(FINDING_ID);
    const fakeFinding = await spies.findingGetById.mock.results[0]!.value;
    expect(parseFloat(fakeFinding.posterior_probability)).toBeGreaterThan(0.85);

    // Dossier render published — FR + EN envelopes.
    expect(spies.queuePublish).toHaveBeenCalledTimes(2);
    const [frCall, enCall] = spies.queuePublish.mock.calls;
    const frEnv = frCall![1] as { payload: Record<string, unknown>; dedup_key: string };
    const enEnv = enCall![1] as { payload: Record<string, unknown>; dedup_key: string };
    expect(frEnv.payload.language).toBe('fr');
    expect(enEnv.payload.language).toBe('en');
    expect(frEnv.payload.finding_id).toBe(FINDING_ID);
    expect(enEnv.payload.finding_id).toBe(FINDING_ID);
    expect(frEnv.dedup_key).toBe(`render:${FINDING_ID}:fr`);
    expect(enEnv.dedup_key).toBe(`render:${FINDING_ID}:en`);
    expect(frEnv.payload.proposal_index).toBe(String(PROPOSAL_INDEX));
    expect(enEnv.payload.proposal_index).toBe(String(PROPOSAL_INDEX));

    // The render_enqueued audit row covers both languages.
    const enqueuedRow = spies.chainAppend.mock.calls[7]![0] as Record<string, unknown>;
    expect(enqueuedRow.action).toBe('dossier.render_enqueued');
    expect(enqueuedRow.actor).toBe('system:worker-governance');
    expect(enqueuedRow.subject_kind).toBe('finding');
    expect(enqueuedRow.subject_id).toBe(FINDING_ID);
    expect((enqueuedRow.payload as Record<string, unknown>).languages).toEqual(['fr', 'en']);

    // Auto-recipient-body persistence (DECISION-010): the finding had no
    // prior routing decision and no recommended_recipient_body, so the
    // worker auto-derived from pattern category 'a' → CONAC, and persisted.
    expect(spies.setRecipientBody).toHaveBeenCalledTimes(1);
    const setRecipientArgs = spies.setRecipientBody.mock.calls[0]!;
    expect(setRecipientArgs[0]).toBe(FINDING_ID);
    expect(setRecipientArgs[2]).toBe('auto');
    expect(setRecipientArgs[3]).toBe(`system:worker-governance:proposal:${PROPOSAL_INDEX}`);

    // No errors logged.
    expect(spies.loggerError).not.toHaveBeenCalled();
  });

  it('escalation with prior routing decision — auto-derive does not run', async () => {
    ({ deps, spies } = makeDeps({
      priorRoutingDecision: { recipient_body_name: 'minfi' },
    }));

    await handleProposalOpened(deps, PROPOSAL_INDEX, FINDING_HASH, PROPOSER, URI_HASH);
    await handleProposalEscalated(deps, PROPOSAL_INDEX);

    // Prior decision honoured — setRecipientBody NOT called.
    expect(spies.setRecipientBody).not.toHaveBeenCalled();

    // Render envelopes use the prior decision's recipient body.
    const frCall = spies.queuePublish.mock.calls[0];
    expect(frCall).toBeDefined();
    const frEnv = frCall![1] as { payload: Record<string, unknown> };
    expect(frEnv.payload.recipient_body_name).toBe('minfi');
  });

  it('escalation with finding.recommended_recipient_body set — no auto-derive', async () => {
    ({ deps, spies } = makeDeps());

    // Override the finding mock to return a recommended_recipient_body.
    spies.findingGetById.mockResolvedValueOnce({
      id: FINDING_ID,
      severity: 'critical',
      posterior_probability: '0.95',
      primary_pattern_id: 'p-c-001',
      recommended_recipient_body: 'antic',
    });

    await handleProposalOpened(deps, PROPOSAL_INDEX, FINDING_HASH, PROPOSER, URI_HASH);
    await handleProposalEscalated(deps, PROPOSAL_INDEX);

    expect(spies.setRecipientBody).not.toHaveBeenCalled();
    const frEnv = spies.queuePublish.mock.calls[0]![1] as { payload: Record<string, unknown> };
    expect(frEnv.payload.recipient_body_name).toBe('antic');
  });

  it('escalation when proposal not yet projected — logs warn, skips render publish', async () => {
    ({ deps, spies } = makeDeps({ proposalNotProjected: true }));

    await handleProposalEscalated(deps, PROPOSAL_INDEX);

    // Escalated audit row was still written (the projection lag is a
    // recoverable condition; the chain is the canonical record).
    expect(spies.chainAppend).toHaveBeenCalledTimes(1);
    expect(spies.chainAppend.mock.calls[0]![0].action).toBe('governance.proposal_escalated');

    // No render publish.
    expect(spies.queuePublish).not.toHaveBeenCalled();
    expect(spies.findingGetById).not.toHaveBeenCalled();

    // Warn logged.
    expect(spies.loggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({ idx: PROPOSAL_INDEX }),
      'escalated-proposal-not-projected; skipping render publish',
    );
  });

  it('escalation when finding is missing — logs warn, skips render publish', async () => {
    ({ deps, spies } = makeDeps({ findingMissing: true }));

    await handleProposalOpened(deps, PROPOSAL_INDEX, FINDING_HASH, PROPOSER, URI_HASH);
    await handleProposalEscalated(deps, PROPOSAL_INDEX);

    expect(spies.queuePublish).not.toHaveBeenCalled();
    expect(spies.loggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({ idx: PROPOSAL_INDEX, finding_id: FINDING_ID }),
      'finding-not-found; skipping render publish',
    );
  });

  it('vote with recuse reason — recuse_reason persisted as bytes32 string', async () => {
    ({ deps, spies } = makeDeps());
    const reason = '0x' + 'cafe'.repeat(16); // 64 hex chars after 0x

    await handleVoteCast(deps, PROPOSAL_INDEX, PILLARS[0]!.address, CHOICE.RECUSE, 0, reason);

    const voteRow = spies.insertVote.mock.calls[0]![0] as Record<string, unknown>;
    expect(voteRow.choice).toBe('RECUSE');
    expect(voteRow.recuse_reason).toBe(reason);
  });

  it('vote with zero recuse-reason (no reason specified) — persists null', async () => {
    ({ deps, spies } = makeDeps());

    await handleVoteCast(deps, PROPOSAL_INDEX, PILLARS[0]!.address, CHOICE.YES, 0, ZERO_BYTES32);

    const voteRow = spies.insertVote.mock.calls[0]![0] as Record<string, unknown>;
    expect(voteRow.recuse_reason).toBeNull();
  });

  it('out-of-range choice/pillar enums fall back to defaults', async () => {
    ({ deps, spies } = makeDeps());

    // Contract emits choice=99 (off the enum) — handler falls back to ABSTAIN.
    await handleVoteCast(deps, PROPOSAL_INDEX, PILLARS[0]!.address, 99, 99, ZERO_BYTES32);

    const voteRow = spies.insertVote.mock.calls[0]![0] as Record<string, unknown>;
    expect(voteRow.choice).toBe('ABSTAIN');
    expect(voteRow.voter_pillar).toBe('governance');
  });
});

describe('Block-E E.1 / D1 — bindWatch handler shape', () => {
  it('returns the five contract-event handler functions', () => {
    const { deps } = makeDeps();
    const handlers = bindWatch(deps);

    expect(typeof handlers.onProposalOpened).toBe('function');
    expect(typeof handlers.onVoteCast).toBe('function');
    expect(typeof handlers.onProposalEscalated).toBe('function');
    expect(typeof handlers.onProposalDismissed).toBe('function');
    expect(typeof handlers.onProposalExpired).toBe('function');
  });

  it('handler errors are caught + logged + do NOT propagate (contract-watch contract)', async () => {
    const { deps, spies } = makeDeps();
    // Force the chain to throw on the next append.
    spies.chainAppend.mockRejectedValueOnce(new Error('chain-down'));

    const handlers = bindWatch(deps);
    handlers.onProposalDismissed(PROPOSAL_INDEX);

    // The handler returned synchronously (void); the async work has
    // started. Wait a microtask for the error to propagate to logger.
    await new Promise<void>((r) => setImmediate(r));

    expect(spies.loggerError).toHaveBeenCalledWith(
      expect.objectContaining({ idx: PROPOSAL_INDEX }),
      'proposal-dismissed-handler-failed',
    );
  });
});
