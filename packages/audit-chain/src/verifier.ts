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
    totalVerified += await this.verifyCommitment(commit);
    commitmentsChecked++;
    this.logger.info(
      { fromSeq: commit.fromSeq, toSeq: commit.toSeq, rootHash: commit.rootHash },
      'ledger-verified',
    );
    return { verified: totalVerified, commitmentsChecked };
  }

  async verifyAll(): Promise<{ verified: number; commitmentsChecked: number }> {
    const total = await this.anchor.totalCommitments();
    let commitmentsChecked = 0;
    let totalVerified = 0;
    for (let i = 0; i < total; i++) {
      const c = await this.anchor.getCommitment(i);
      totalVerified += await this.verifyCommitment(c);
      commitmentsChecked++;
    }
    return { verified: totalVerified, commitmentsChecked };
  }

  /**
   * Tier-0 audit closure: verify a single on-chain commitment against the
   * local hash chain. The pre-fix verifier only ran `chain.verify(...)`
   * for INTERNAL consistency of the local rows — it never compared the
   * actual computed tail hash against `commit.rootHash` from Polygon.
   * An attacker who consistently rewrote local rows (recomputing every
   * downstream link) would pass `chain.verify` while the on-chain
   * anchor showed a different rootHash — defeating the entire purpose
   * of the public anchor.
   *
   * Post-fix: after internal-consistency verification, we read the
   * body_hash at `commit.toSeq` and assert it equals `commit.rootHash`.
   * The on-chain witness is now load-bearing.
   */
  private async verifyCommitment(commit: {
    fromSeq: number;
    toSeq: number;
    rootHash: string;
  }): Promise<number> {
    // 1) Internal consistency of the local range.
    const verified = await this.chain.verify(commit.fromSeq, commit.toSeq);
    const expectedCount = commit.toSeq - commit.fromSeq + 1;
    if (verified !== expectedCount) {
      throw new Errors.HashChainBrokenError('verifier', String(expectedCount), String(verified));
    }

    // 2) On-chain witness comparison. The body_hash at toSeq is the
    // local chain's running rowHash at that point — it MUST equal the
    // rootHash that was anchored to Polygon at commit time. If it
    // doesn't, the local chain has been tampered with after the
    // anchor was committed.
    const localTail = await this.chain.bodyHashAt(commit.toSeq);
    if (localTail === null) {
      throw new Errors.HashChainBrokenError(
        `verifier:seq=${commit.toSeq}`,
        commit.rootHash,
        '<missing>',
      );
    }
    const localTailLower = localTail.toLowerCase();
    const anchorLower = commit.rootHash.toLowerCase();
    if (localTailLower !== anchorLower) {
      this.logger.error(
        {
          fromSeq: commit.fromSeq,
          toSeq: commit.toSeq,
          localTail: localTailLower,
          anchored: anchorLower,
        },
        'ledger-on-chain-divergence',
      );
      throw new Errors.HashChainBrokenError(
        `verifier:anchor:seq=${commit.toSeq}`,
        anchorLower,
        localTailLower,
      );
    }
    return verified;
  }
}
