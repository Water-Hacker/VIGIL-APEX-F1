import { createLogger, type Logger } from '@vigil/observability';
import { ethers } from 'ethers';

import { VIGIL_GOVERNANCE_ABI } from './abi.js';

/**
 * Read-side client for VIGILGovernance. Write-side calls go through
 * `vigil-polygon-signer` (host service); never construct a wallet here.
 */
export class GovernanceReadClient {
  public readonly contract: ethers.Contract;
  private readonly logger: Logger;

  constructor(rpcUrl: string, contractAddress: string, logger?: Logger) {
    this.logger = logger ?? createLogger({ service: 'gov-read-client' });
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    this.contract = new ethers.Contract(contractAddress, VIGIL_GOVERNANCE_ABI, provider);
  }

  async getProposal(idx: number): Promise<{
    findingHash: string;
    uri: string;
    state: number;
    openedAt: number;
    closesAt: number;
    yes: number;
    no: number;
    abstain: number;
    recuse: number;
  }> {
    try {
      const r = (await this.contract.getFunction('getProposal').staticCall(idx)) as [
        string,
        string,
        bigint,
        bigint,
        bigint,
        bigint,
        bigint,
        bigint,
        bigint,
      ];
      return {
        findingHash: r[0],
        uri: r[1],
        state: Number(r[2]),
        openedAt: Number(r[3]),
        closesAt: Number(r[4]),
        yes: Number(r[5]),
        no: Number(r[6]),
        abstain: Number(r[7]),
        recuse: Number(r[8]),
      };
    } catch (err) {
      // AUDIT-053: emit on error so council-vote pipeline failures
      // leave a structured trail at the SDK boundary.
      this.logger.error(
        { err, method: 'getProposal', proposalIndex: idx },
        'governance-read-client-call-failed',
      );
      throw err;
    }
  }

  async totalProposals(): Promise<number> {
    try {
      return Number((await this.contract.getFunction('totalProposals').staticCall()) as bigint);
    } catch (err) {
      this.logger.error({ err, method: 'totalProposals' }, 'governance-read-client-call-failed');
      throw err;
    }
  }

  async quorumRequired(): Promise<number> {
    try {
      return Number((await this.contract.getFunction('quorumRequired').staticCall()) as bigint);
    } catch (err) {
      this.logger.error({ err, method: 'quorumRequired' }, 'governance-read-client-call-failed');
      throw err;
    }
  }

  /** Watch contract events. Returns an unsubscribe function.
   *
   *  AUDIT-053: each ethers callback is wrapped in a try/catch so a
   *  user-handler that throws does not kill the listener set or
   *  silently swallow context. Errors are logged at `warn` (handler
   *  isolation) — the listener stays subscribed.
   */
  watch(handlers: {
    onProposalOpened?: (
      proposalIndex: number,
      findingHash: string,
      proposer: string,
      uri: string,
    ) => void;
    onVoteCast?: (
      proposalIndex: number,
      voter: string,
      choice: number,
      pillar: number,
      recuseReason: string,
    ) => void;
    onProposalEscalated?: (proposalIndex: number) => void;
    onProposalDismissed?: (proposalIndex: number) => void;
    onProposalExpired?: (proposalIndex: number) => void;
  }): () => void {
    const subs: Array<() => void> = [];
    const isolate =
      <A extends unknown[]>(event: string, fn: (...a: A) => void) =>
      (...a: A): void => {
        try {
          fn(...a);
        } catch (err) {
          this.logger.warn({ err, event }, 'governance-read-client-watch-handler-threw');
        }
      };
    if (handlers.onProposalOpened) {
      const fn = isolate('ProposalOpened', (idx: bigint, h: string, p: string, u: string): void =>
        handlers.onProposalOpened!(Number(idx), h, p, u),
      );
      void this.contract.on('ProposalOpened', fn);
      subs.push(() => void this.contract.off('ProposalOpened', fn));
    }
    if (handlers.onVoteCast) {
      const fn = isolate(
        'VoteCast',
        (idx: bigint, voter: string, choice: bigint, pillar: bigint, reason: string): void =>
          handlers.onVoteCast!(Number(idx), voter, Number(choice), Number(pillar), reason),
      );
      void this.contract.on('VoteCast', fn);
      subs.push(() => void this.contract.off('VoteCast', fn));
    }
    if (handlers.onProposalEscalated) {
      const fn = isolate('ProposalEscalated', (idx: bigint): void =>
        handlers.onProposalEscalated!(Number(idx)),
      );
      void this.contract.on('ProposalEscalated', fn);
      subs.push(() => void this.contract.off('ProposalEscalated', fn));
    }
    if (handlers.onProposalDismissed) {
      const fn = isolate('ProposalDismissed', (idx: bigint): void =>
        handlers.onProposalDismissed!(Number(idx)),
      );
      void this.contract.on('ProposalDismissed', fn);
      subs.push(() => void this.contract.off('ProposalDismissed', fn));
    }
    if (handlers.onProposalExpired) {
      const fn = isolate('ProposalExpired', (idx: bigint): void =>
        handlers.onProposalExpired!(Number(idx)),
      );
      void this.contract.on('ProposalExpired', fn);
      subs.push(() => void this.contract.off('ProposalExpired', fn));
    }
    return (): void => {
      for (const u of subs) u();
    };
  }
}
