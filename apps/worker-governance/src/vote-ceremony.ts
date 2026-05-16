/**
 * Council vote ceremony handlers — extracted from index.ts so the
 * end-to-end ceremony flow is testable without spinning up Postgres,
 * Redis, or a real Polygon RPC.
 *
 * The three handlers correspond 1:1 to the VIGILGovernance contract
 * events the worker watches:
 *
 *   - `handleProposalOpened` — projects ProposalOpened into
 *     `governance.proposal` + writes one audit-chain row.
 *   - `handleVoteCast` — projects VoteCast into `governance.vote` +
 *     one audit-chain row per vote.
 *   - `handleProposalEscalated` — writes the escalation audit row,
 *     resolves the recipient body (DECISION-010), publishes per-
 *     language dossier-render envelopes (FR + EN), and emits the
 *     `dossier.render_enqueued` audit row.
 *
 * The contract is the source of truth; this projection is rebuildable
 * from on-chain history. The audit chain is the canonical record; the
 * Postgres rows are read-projection cache.
 *
 * Tests at `__tests__/council-vote-e2e.test.ts` drive the full
 * ceremony with mocked deps + the `DeterministicTestSigner` shape
 * used in the audit-chain tests.
 *
 * Refs: SRD §23.3 (3-of-5 quorum); DECISION-010 (recipient-body
 * routing); BLOCK-E-PLAN §2.1.
 */

import { STREAMS, newEnvelope } from '@vigil/queue';
import { Constants, Ids, Routing } from '@vigil/shared';

import type { HashChain } from '@vigil/audit-chain';
import type {
  DossierRepo,
  FindingRepo,
  GovernanceRepo,
  RecipientBodyName,
} from '@vigil/db-postgres';
import type { Logger } from '@vigil/observability';
import type { QueueClient } from '@vigil/queue';

const CHOICE_MAP = ['YES', 'NO', 'ABSTAIN', 'RECUSE'] as const;
const PILLAR_MAP = ['governance', 'judicial', 'civil_society', 'audit', 'technical'] as const;

const ZERO_BYTES32 = '0x0000000000000000000000000000000000000000000000000000000000000000';
const PROPOSAL_TTL_MS = 14 * 86_400_000; // SRD §23.3 — 14-day vote window

export interface VoteCeremonyDeps {
  readonly repo: GovernanceRepo;
  readonly findingRepo: FindingRepo;
  readonly dossierRepo: DossierRepo;
  readonly chain: HashChain;
  readonly queue: QueueClient;
  readonly logger: Logger;
  /** Optional clock injection for deterministic test timestamps. */
  readonly now?: () => Date;
}

function nowOf(deps: VoteCeremonyDeps): Date {
  return deps.now ? deps.now() : new Date();
}

/**
 * Project a `ProposalOpened` contract event.
 */
export async function handleProposalOpened(
  deps: VoteCeremonyDeps,
  idx: number,
  findingHash: string,
  proposer: string,
  uri: string,
): Promise<void> {
  // Tier-45 audit closure: lowercase the address before recording so
  // the same wallet has a SINGLE canonical actor representation across
  // every audit-chain row. Pre-fix, handleVoteCast already lowercased
  // `voter` for the DB projection (vote.voter_address) but the actor
  // field in BOTH handlers was kept mixed-case — so searching the
  // audit chain for an operator's history would split rows between
  // checksummed and lowercase representations of the same identity.
  const proposerLc = proposer.toLowerCase();
  deps.logger.info({ idx, proposer: proposerLc, uri }, 'proposal-opened');
  const openedAt = nowOf(deps);
  await deps.repo.insertProposal({
    id: Ids.newEventId() as string,
    on_chain_index: String(idx),
    finding_id: findingHash,
    dossier_id: null,
    state: 'open',
    opened_at: openedAt,
    closes_at: new Date(openedAt.getTime() + PROPOSAL_TTL_MS),
    closed_at: null,
    yes_votes: 0,
    no_votes: 0,
    abstain_votes: 0,
    recuse_votes: 0,
    proposal_tx_hash: null,
    closing_tx_hash: null,
  });
  await deps.chain.append({
    action: 'governance.proposal_opened',
    actor: proposerLc,
    subject_kind: 'proposal',
    subject_id: String(idx),
    payload: { findingHash, uri },
  });
}

/**
 * Project a `VoteCast` contract event.
 *
 * `choice` is the contract's enum index: 0=YES, 1=NO, 2=ABSTAIN, 3=RECUSE.
 * `pillar` is the contract's enum index: 0..4 mapped per `PILLAR_MAP`.
 * `recuseReason` is bytes32; the zero-hash means "no reason specified".
 */
export async function handleVoteCast(
  deps: VoteCeremonyDeps,
  idx: number,
  voter: string,
  choice: number,
  pillar: number,
  recuseReason: string,
): Promise<void> {
  deps.logger.info({ idx, voter, choice, pillar }, 'vote-cast');
  // Tier-12 council audit closure: refuse silent fallback on
  // out-of-range enum indices. Pre-fix `CHOICE_MAP[99] ?? 'ABSTAIN'`
  // meant a malformed VoteCast event (read-client bug, contract
  // substitution, future enum extension) would silently mis-record
  // a vote as ABSTAIN. The 3-of-5 quorum could miss a legitimate
  // YES that way. Fail loud — refuse to project the vote and surface
  // a structured audit row so operators see the unexpected enum.
  if (choice < 0 || choice >= CHOICE_MAP.length || !Number.isInteger(choice)) {
    // Pure structured log — the on-chain VoteCast event IS the
    // canonical record; our projection refuses to record a value it
    // can't classify rather than silently coercing to ABSTAIN.
    // Operators can reconcile against the contract's event log.
    deps.logger.error(
      { idx, voter, choice, valid_range: `0..${CHOICE_MAP.length - 1}` },
      'vote-cast-choice-out-of-range; refusing to project',
    );
    return;
  }
  if (pillar < 0 || pillar >= PILLAR_MAP.length || !Number.isInteger(pillar)) {
    deps.logger.error(
      { idx, voter, pillar, valid_range: `0..${PILLAR_MAP.length - 1}` },
      'vote-cast-pillar-out-of-range; refusing to project',
    );
    return;
  }
  const choiceName = CHOICE_MAP[choice]!;
  const pillarName = PILLAR_MAP[pillar]!;
  // Tier-45 audit closure: single canonical lowercase form for the
  // address — matches what's persisted to vote.voter_address (already
  // lowercased pre-fix). The audit-chain actor field was kept mixed-
  // case, so a join from audit-chain history to vote table required
  // case-insensitive matching. Normalise at the boundary.
  const voterLc = voter.toLowerCase();
  await deps.repo.insertVote({
    id: Ids.newEventId() as string,
    proposal_id: String(idx), // placeholder; real lookup uses on_chain_index
    voter_address: voterLc,
    voter_pillar: pillarName,
    choice: choiceName,
    cast_at: nowOf(deps),
    vote_tx_hash: '0x0',
    recuse_reason: recuseReason !== ZERO_BYTES32 ? recuseReason : null,
  });
  await deps.chain.append({
    action: 'governance.vote_cast',
    actor: voterLc,
    subject_kind: 'proposal',
    subject_id: String(idx),
    payload: { choice: choiceName, pillar: pillarName, recuseReason },
  });
}

/**
 * Project a `ProposalEscalated` contract event.
 *
 * Side effects:
 *   1. `governance.proposal_escalated` audit row.
 *   2. Resolve recipient body per DECISION-010 (architect routing
 *      decision wins; falls back to recommended_recipient_body, then
 *      to the auto-derive based on pattern category + severity).
 *   3. Publish FR + EN dossier-render envelopes to
 *      `STREAMS.DOSSIER_RENDER`.
 *   4. `dossier.render_enqueued` audit row covering both languages.
 *
 * If the projection lookup fails (proposal not yet projected, or
 * finding not found), the function logs and returns without
 * throwing — the next escalation event will retry.
 */
export async function handleProposalEscalated(deps: VoteCeremonyDeps, idx: number): Promise<void> {
  await deps.chain.append({
    action: 'governance.proposal_escalated',
    actor: 'contract',
    subject_kind: 'proposal',
    subject_id: String(idx),
    payload: {},
  });

  try {
    const proposal = await deps.repo.getProposalByOnChainIndex(String(idx));
    if (!proposal) {
      deps.logger.warn({ idx }, 'escalated-proposal-not-projected; skipping render publish');
      return;
    }
    const finding = await deps.findingRepo.getById(proposal.finding_id);
    if (!finding) {
      deps.logger.warn(
        { idx, finding_id: proposal.finding_id },
        'finding-not-found; skipping render publish',
      );
      return;
    }

    // FIND-002 closure (whole-system-audit doc 10): refuse to publish
    // dossier.render envelopes if the finding does NOT meet the CONAC
    // delivery threshold (posterior >= 0.95 AND signal_count >= 5).
    // The council vote alone is not sufficient — the underlying
    // evidence must also clear the bar. This is the SECOND layer of
    // defence (the first is the repo default in
    // `FindingRepo.listEscalationCandidates`; the third is the SFTP
    // worker itself). Emit a structured audit row so the architect can
    // see in the audit log that a council-approved finding was held.
    if (!Constants.meetsCONACThreshold(finding)) {
      deps.logger.error(
        {
          idx,
          finding_id: finding.id,
          posterior: finding.posterior,
          signal_count: finding.signal_count,
          threshold_posterior: Constants.POSTERIOR_THRESHOLD_CONAC,
          threshold_signals: Constants.MIN_SIGNAL_COUNT_CONAC,
        },
        'finding-below-conac-threshold-held; refusing dossier.render publish',
      );
      await deps.chain.append({
        action: 'dossier.render_blocked_below_threshold',
        actor: 'system:worker-governance',
        subject_kind: 'finding',
        subject_id: finding.id,
        payload: {
          proposal_index: String(idx),
          posterior: finding.posterior,
          signal_count: finding.signal_count,
          threshold_posterior: Constants.POSTERIOR_THRESHOLD_CONAC,
          threshold_signals: Constants.MIN_SIGNAL_COUNT_CONAC,
          reason: 'FIND-002 gate — finding does not meet CONAC threshold',
        },
      });
      return;
    }

    const decision = await deps.dossierRepo.latestRoutingDecision(finding.id);
    let recipientBody: RecipientBodyName;
    if (decision !== null) {
      recipientBody = decision.recipient_body_name as RecipientBodyName;
    } else if (
      finding.recommended_recipient_body !== null &&
      finding.recommended_recipient_body !== undefined
    ) {
      recipientBody = finding.recommended_recipient_body as RecipientBodyName;
    } else {
      const parsed =
        finding.primary_pattern_id !== null && finding.primary_pattern_id !== undefined
          ? Routing.parsePatternId(finding.primary_pattern_id)
          : null;
      recipientBody = Routing.recommendRecipientBody({
        patternCategory: parsed?.category ?? 'A',
        severity: finding.severity as 'low' | 'medium' | 'high' | 'critical',
      });
      // Persist the auto-decision so subsequent re-publishes are
      // observable in the routing audit trail.
      await deps.dossierRepo.setRecipientBody(
        finding.id,
        recipientBody,
        'auto',
        `system:worker-governance:proposal:${idx}`,
        `Auto-derived from pattern category ${parsed?.category ?? 'A'} on escalation`,
      );
    }

    for (const language of ['fr', 'en'] as const) {
      const dedup = `render:${finding.id}:${language}`;
      const env = newEnvelope(
        'worker-governance',
        {
          finding_id: finding.id,
          language,
          recipient_body_name: recipientBody,
          proposal_index: String(idx),
        },
        dedup,
      );
      await deps.queue.publish(STREAMS.DOSSIER_RENDER, env);
    }

    await deps.chain.append({
      action: 'dossier.render_enqueued',
      actor: 'system:worker-governance',
      subject_kind: 'finding',
      subject_id: finding.id,
      payload: {
        proposal_index: String(idx),
        recipient_body_name: recipientBody,
        languages: ['fr', 'en'],
      },
    });

    deps.logger.info({ finding_id: finding.id, recipientBody, idx }, 'dossier-render-enqueued');
  } catch (err) {
    const e = err instanceof Error ? err : new Error(String(err));
    deps.logger.error(
      { err_name: e.name, err_message: e.message, idx },
      'dossier-render-publish-failed; will retry on next escalation event',
    );
  }
}

/**
 * Two simpler handlers for the lifecycle terminal states. Kept here
 * for symmetry; both just append to the audit chain.
 */
export async function handleProposalDismissed(deps: VoteCeremonyDeps, idx: number): Promise<void> {
  await deps.chain.append({
    action: 'governance.proposal_dismissed',
    actor: 'contract',
    subject_kind: 'proposal',
    subject_id: String(idx),
    payload: {},
  });
}

export async function handleProposalExpired(deps: VoteCeremonyDeps, idx: number): Promise<void> {
  await deps.chain.append({
    action: 'governance.proposal_expired',
    actor: 'contract',
    subject_kind: 'proposal',
    subject_id: String(idx),
    payload: {},
  });
}

/**
 * Bind the five handlers to a `GovernanceReadClient.watch` handler
 * shape. The watch contract uses sync callbacks; we wrap each in a
 * `void (async () => {})()` to honour the contract while keeping the
 * inner logic awaitable for tests.
 */
export function bindWatch(deps: VoteCeremonyDeps): {
  onProposalOpened: (idx: number, findingHash: string, proposer: string, uri: string) => void;
  onVoteCast: (
    idx: number,
    voter: string,
    choice: number,
    pillar: number,
    recuseReason: string,
  ) => void;
  onProposalEscalated: (idx: number) => void;
  onProposalDismissed: (idx: number) => void;
  onProposalExpired: (idx: number) => void;
} {
  // Tier-12 audit closure: normalise non-Error throwables in the 5
  // watch-handler catches so structured logs always carry err_name +
  // err_message rather than an opaque "[object Object]".
  const norm = (err: unknown): { err_name: string; err_message: string } => {
    const e = err instanceof Error ? err : new Error(String(err));
    return { err_name: e.name, err_message: e.message };
  };
  return {
    onProposalOpened: (idx, findingHash, proposer, uri) => {
      void handleProposalOpened(deps, idx, findingHash, proposer, uri).catch((err: unknown) =>
        deps.logger.error({ ...norm(err), idx }, 'proposal-opened-handler-failed'),
      );
    },
    onVoteCast: (idx, voter, choice, pillar, recuseReason) => {
      void handleVoteCast(deps, idx, voter, choice, pillar, recuseReason).catch((err: unknown) =>
        deps.logger.error({ ...norm(err), idx, voter }, 'vote-cast-handler-failed'),
      );
    },
    onProposalEscalated: (idx) => {
      void handleProposalEscalated(deps, idx).catch((err: unknown) =>
        deps.logger.error({ ...norm(err), idx }, 'proposal-escalated-handler-failed'),
      );
    },
    onProposalDismissed: (idx) => {
      void handleProposalDismissed(deps, idx).catch((err: unknown) =>
        deps.logger.error({ ...norm(err), idx }, 'proposal-dismissed-handler-failed'),
      );
    },
    onProposalExpired: (idx) => {
      void handleProposalExpired(deps, idx).catch((err: unknown) =>
        deps.logger.error({ ...norm(err), idx }, 'proposal-expired-handler-failed'),
      );
    },
  };
}
