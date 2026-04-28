import { createLogger, type Logger } from '@vigil/observability';
import { Errors } from '@vigil/shared';

import type { HashChain } from './hash-chain.js';
import type { PolygonAnchor } from './polygon-anchor.js';

/**
 * LedgerVerifier — runs hourly per CT-02. Reads the latest on-chain
 * commitment, recomputes the corresponding range of the local hash chain,
 * and asserts equality. Any mismatch is a fatal alert (HASH_CHAIN_BREAK)
 * surfaced to the dashboard immediately.
 */

export class LedgerVerifier {
  private readonly logger: Logger;

  constructor(
    private readonly chain: HashChain,
    private readonly anchor: PolygonAnchor,
    logger?: Logger,
  ) {
    this.logger = logger ?? createLogger({ service: 'ledger-verifier' });
  }

  async verifyLatest(): Promise<{ verified: number; commitmentsChecked: number }> {
    const total = await this.anchor.totalCommitments();
    if (total === 0) {
      this.logger.warn('no on-chain commitments yet — skipping');
      return { verified: 0, commitmentsChecked: 0 };
    }

    let commitmentsChecked = 0;
    let totalVerified = 0;

    // Verify the most recent commitment for liveness; older windows can be
    // verified on-demand via verifyAll().
    const commit = await this.anchor.getCommitment(total - 1);
    const verified = await this.chain.verify(commit.fromSeq, commit.toSeq);
    if (verified !== commit.toSeq - commit.fromSeq + 1) {
      throw new Errors.HashChainBrokenError(
        'verifier',
        String(commit.toSeq - commit.fromSeq + 1),
        String(verified),
      );
    }
    commitmentsChecked++;
    totalVerified += verified;
    this.logger.info({ fromSeq: commit.fromSeq, toSeq: commit.toSeq }, 'ledger-verified');
    return { verified: totalVerified, commitmentsChecked };
  }

  async verifyAll(): Promise<{ verified: number; commitmentsChecked: number }> {
    const total = await this.anchor.totalCommitments();
    let commitmentsChecked = 0;
    let totalVerified = 0;
    for (let i = 0; i < total; i++) {
      const c = await this.anchor.getCommitment(i);
      totalVerified += await this.chain.verify(c.fromSeq, c.toSeq);
      commitmentsChecked++;
    }
    return { verified: totalVerified, commitmentsChecked };
  }
}
