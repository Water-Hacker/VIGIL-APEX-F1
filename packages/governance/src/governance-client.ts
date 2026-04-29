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
    const r = (await this.contract.getFunction('getProposal').staticCall(idx)) as [string, string, bigint, bigint, bigint, bigint, bigint, bigint, bigint];
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
  }

  async totalProposals(): Promise<number> {
    return Number((await this.contract.getFunction('totalProposals').staticCall()) as bigint);
  }

  async quorumRequired(): Promise<number> {
    return Number((await this.contract.getFunction('quorumRequired').staticCall()) as bigint);
  }

  /** Watch contract events. Returns an unsubscribe function. */
  watch(handlers: {
    onProposalOpened?: (proposalIndex: number, findingHash: string, proposer: string, uri: string) => void;
    onVoteCast?: (proposalIndex: number, voter: string, choice: number, pillar: number, recuseReason: string) => void;
    onProposalEscalated?: (proposalIndex: number) => void;
    onProposalDismissed?: (proposalIndex: number) => void;
    onProposalExpired?: (proposalIndex: number) => void;
  }): () => void {
    const subs: Array<() => void> = [];
    if (handlers.onProposalOpened) {
      const fn = (idx: bigint, h: string, p: string, u: string): void =>
        handlers.onProposalOpened!(Number(idx), h, p, u);
      void this.contract.on('ProposalOpened', fn);
      subs.push(() => void this.contract.off('ProposalOpened', fn));
    }
    if (handlers.onVoteCast) {
      const fn = (idx: bigint, voter: string, choice: bigint, pillar: bigint, reason: string): void =>
        handlers.onVoteCast!(Number(idx), voter, Number(choice), Number(pillar), reason);
      void this.contract.on('VoteCast', fn);
      subs.push(() => void this.contract.off('VoteCast', fn));
    }
    if (handlers.onProposalEscalated) {
      const fn = (idx: bigint): void => handlers.onProposalEscalated!(Number(idx));
      void this.contract.on('ProposalEscalated', fn);
      subs.push(() => void this.contract.off('ProposalEscalated', fn));
    }
    if (handlers.onProposalDismissed) {
      const fn = (idx: bigint): void => handlers.onProposalDismissed!(Number(idx));
      void this.contract.on('ProposalDismissed', fn);
      subs.push(() => void this.contract.off('ProposalDismissed', fn));
    }
    if (handlers.onProposalExpired) {
      const fn = (idx: bigint): void => handlers.onProposalExpired!(Number(idx));
      void this.contract.on('ProposalExpired', fn);
      subs.push(() => void this.contract.off('ProposalExpired', fn));
    }
    return (): void => {
      for (const u of subs) u();
    };
  }
}
