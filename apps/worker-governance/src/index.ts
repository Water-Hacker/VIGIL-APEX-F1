import { HashChain } from '@vigil/audit-chain';
import {
  DossierRepo,
  FindingRepo,
  GovernanceRepo,
  getDb,
  getPool,
  type RecipientBodyName,
} from '@vigil/db-postgres';
import { GovernanceReadClient } from '@vigil/governance';
import {
  createLogger,
  installShutdownHandler,
  initTracing,
  shutdownTracing,
  startMetricsServer,
  registerShutdown,
} from '@vigil/observability';
import { QueueClient, STREAMS, newEnvelope } from '@vigil/queue';
import { Ids, Routing } from '@vigil/shared';

const logger = createLogger({ service: 'worker-governance' });

/**
 * worker-governance — listens to VIGILGovernance contract events and projects
 * them into the Postgres governance schema. Also writes audit-chain entries
 * for every council action.
 *
 * On reconnect, it does NOT re-replay history — the audit chain is the
 * canonical record; this worker is a read-projection cache.
 */
async function main(): Promise<void> {
  await initTracing({ service: 'worker-governance' });
  const metrics = await startMetricsServer();
  registerShutdown('metrics', () => metrics.close());
  installShutdownHandler(logger);
  registerShutdown('tracing', shutdownTracing);

  const contractAddress =
    process.env.POLYGON_GOVERNANCE_CONTRACT ?? '0x0000000000000000000000000000000000000000';
  if (contractAddress === '0x0000000000000000000000000000000000000000') {
    logger.warn('POLYGON_GOVERNANCE_CONTRACT not deployed; running in idle mode');
  }

  const rpcUrl = process.env.POLYGON_RPC_URL ?? 'https://polygon-rpc.com';
  const db = await getDb();
  const repo = new GovernanceRepo(db);
  const findingRepo = new FindingRepo(db);
  const dossierRepo = new DossierRepo(db);
  const pool = await getPool();
  const chain = new HashChain(pool, logger);

  // Queue client for DOSSIER_RENDER publication on escalation.
  const queue = new QueueClient({ logger });
  registerShutdown('queue', () => queue.close());

  const client = new GovernanceReadClient(rpcUrl, contractAddress, logger);

  const unsubscribe = client.watch({
    onProposalOpened: (idx, findingHash, proposer, uri) => {
      void (async () => {
        logger.info({ idx, proposer, uri }, 'proposal-opened');
        await repo.insertProposal({
          id: Ids.newEventId() as string,
          on_chain_index: String(idx),
          finding_id: findingHash,
          dossier_id: null,
          state: 'open',
          opened_at: new Date(),
          closes_at: new Date(Date.now() + 14 * 86_400_000),
          closed_at: null,
          yes_votes: 0,
          no_votes: 0,
          abstain_votes: 0,
          recuse_votes: 0,
          proposal_tx_hash: null,
          closing_tx_hash: null,
        });
        await chain.append({
          action: 'governance.proposal_opened',
          actor: proposer,
          subject_kind: 'proposal',
          subject_id: String(idx),
          payload: { findingHash, uri },
        });
      })();
    },
    onVoteCast: (idx, voter, choice, pillar, recuseReason) => {
      void (async () => {
        logger.info({ idx, voter, choice, pillar }, 'vote-cast');
        const choiceMap = ['YES', 'NO', 'ABSTAIN', 'RECUSE'] as const;
        const pillarMap = ['governance', 'judicial', 'civil_society', 'audit', 'technical'] as const;
        await repo.insertVote({
          id: Ids.newEventId() as string,
          proposal_id: String(idx), // placeholder; real lookup uses on_chain_index
          voter_address: voter.toLowerCase(),
          voter_pillar: pillarMap[pillar] ?? 'governance',
          choice: choiceMap[choice] ?? 'ABSTAIN',
          cast_at: new Date(),
          vote_tx_hash: '0x0',
          recuse_reason: recuseReason !== '0x0000000000000000000000000000000000000000000000000000000000000000' ? recuseReason : null,
        });
        await chain.append({
          action: 'governance.vote_cast',
          actor: voter,
          subject_kind: 'proposal',
          subject_id: String(idx),
          payload: { choice: choiceMap[choice], pillar: pillarMap[pillar], recuseReason },
        });
      })();
    },
    onProposalEscalated: (idx) => {
      void (async () => {
        await chain.append({
          action: 'governance.proposal_escalated',
          actor: 'contract',
          subject_kind: 'proposal',
          subject_id: String(idx),
          payload: {},
        });
        // DECISION-010 — escalation triggers per-language dossier render.
        // Resolve finding → recipient body (latest routing decision wins;
        // falls back to recommended_recipient_body, then to auto-derive).
        try {
          const proposal = await repo.getProposalByOnChainIndex(String(idx));
          if (!proposal) {
            logger.warn(
              { idx },
              'escalated-proposal-not-projected; skipping render publish',
            );
            return;
          }
          const finding = await findingRepo.getById(proposal.finding_id);
          if (!finding) {
            logger.warn(
              { idx, finding_id: proposal.finding_id },
              'finding-not-found; skipping render publish',
            );
            return;
          }
          const decision = await dossierRepo.latestRoutingDecision(finding.id);
          let recipientBody: RecipientBodyName;
          if (decision !== null) {
            recipientBody = decision.recipient_body_name as RecipientBodyName;
          } else if (finding.recommended_recipient_body !== null && finding.recommended_recipient_body !== undefined) {
            recipientBody = finding.recommended_recipient_body as RecipientBodyName;
          } else {
            const parsed = finding.primary_pattern_id !== null && finding.primary_pattern_id !== undefined
              ? Routing.parsePatternId(finding.primary_pattern_id)
              : null;
            recipientBody = Routing.recommendRecipientBody({
              patternCategory: parsed?.category ?? 'A',
              severity: finding.severity as 'low' | 'medium' | 'high' | 'critical',
            });
            // Persist the auto-decision so subsequent re-publishes are
            // observable in the routing audit trail.
            await dossierRepo.setRecipientBody(
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
            await queue.publish(STREAMS.DOSSIER_RENDER, env);
          }

          await chain.append({
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

          logger.info(
            { finding_id: finding.id, recipientBody, idx },
            'dossier-render-enqueued',
          );
        } catch (err) {
          logger.error(
            { err, idx },
            'dossier-render-publish-failed; will retry on next escalation event',
          );
        }
      })();
    },
    onProposalDismissed: (idx) => {
      void chain.append({
        action: 'governance.proposal_dismissed',
        actor: 'contract',
        subject_kind: 'proposal',
        subject_id: String(idx),
        payload: {},
      });
    },
    onProposalExpired: (idx) => {
      void chain.append({
        action: 'governance.proposal_expired',
        actor: 'contract',
        subject_kind: 'proposal',
        subject_id: String(idx),
        payload: {},
      });
    },
  });
  registerShutdown('unsubscribe', () => unsubscribe());

  logger.info({ contract: contractAddress }, 'worker-governance-ready');
}

main().catch((e: unknown) => {
  logger.error({ err: e }, 'fatal-startup');
  process.exit(1);
});
