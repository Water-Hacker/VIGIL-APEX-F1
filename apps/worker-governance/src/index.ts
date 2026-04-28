import { HashChain } from '@vigil/audit-chain';
import { GovernanceRepo, getDb, getPool } from '@vigil/db-postgres';
import { GovernanceReadClient } from '@vigil/governance';
import {
  createLogger,
  installShutdownHandler,
  initTracing,
  shutdownTracing,
  startMetricsServer,
  registerShutdown,
} from '@vigil/observability';
import { Ids } from '@vigil/shared';

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
  const pool = await getPool();
  const chain = new HashChain(pool, logger);

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
      void chain.append({
        action: 'governance.proposal_escalated',
        actor: 'contract',
        subject_kind: 'proposal',
        subject_id: String(idx),
        payload: {},
      });
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
