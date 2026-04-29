// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.27;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

/**
 * @title VIGILAnchor
 * @notice Append-only registry of audit-chain root commitments.
 *         Per SRD §22.3 + W-11. Each commitment records [fromSeq, toSeq, rootHash].
 *         The contract is intentionally narrow: only the designated `committer`
 *         (the YubiKey-backed signing wallet) can write; everything else is read-only.
 *
 *         Properties:
 *           - Immutable history: a committed entry cannot be edited or removed.
 *           - Monotonic: each new (fromSeq, toSeq) must satisfy
 *             fromSeq == lastToSeq + 1, fromSeq <= toSeq.
 *           - Non-zero rootHash (rejects accidental empty commits).
 *
 *         Upgradeability: NONE (per SRD §22.9). A new contract address
 *         supersedes; the dashboard tracks the chain of addresses.
 */
contract VIGILAnchor is Ownable2Step {
    struct Commitment {
        uint256 fromSeq;
        uint256 toSeq;
        bytes32 rootHash;
        address committer;
        uint64 timestamp;
    }

    /// @notice The single account allowed to commit. Set at deploy; rotatable.
    address public committer;

    Commitment[] private _commitments;

    /// @notice Last committed `toSeq` — enforces monotonicity.
    uint256 public lastToSeq;

    event Anchored(
        uint256 indexed commitmentId,
        uint256 fromSeq,
        uint256 toSeq,
        bytes32 rootHash,
        address indexed committer
    );

    event CommitterRotated(address indexed previousCommitter, address indexed newCommitter);

    error NotCommitter();
    error InvalidRange();
    error EmptyRoot();
    error NonContiguous();
    error CommitmentNotFound();
    error ZeroCommitterAddress();

    modifier onlyCommitter() {
        if (msg.sender != committer) revert NotCommitter();
        _;
    }

    constructor(address _committer) Ownable(msg.sender) {
        if (_committer == address(0)) revert ZeroCommitterAddress();
        committer = _committer;
    }

    /**
     * @notice Append a new commitment.
     * @param fromSeq Inclusive lower bound of the audit-chain range covered.
     * @param toSeq   Inclusive upper bound.
     * @param rootHash 32-byte root of the canonical hash chain over [fromSeq..toSeq].
     */
    function commit(uint256 fromSeq, uint256 toSeq, bytes32 rootHash) external onlyCommitter {
        if (fromSeq > toSeq) revert InvalidRange();
        if (rootHash == bytes32(0)) revert EmptyRoot();
        if (lastToSeq != 0 && fromSeq != lastToSeq + 1) revert NonContiguous();

        uint256 id = _commitments.length;
        _commitments.push(
            Commitment({
                fromSeq: fromSeq,
                toSeq: toSeq,
                rootHash: rootHash,
                committer: msg.sender,
                timestamp: uint64(block.timestamp)
            })
        );
        lastToSeq = toSeq;
        emit Anchored(id, fromSeq, toSeq, rootHash, msg.sender);
    }

    /**
     * @notice Owner-only rotation of the committer wallet (e.g. annual YubiKey
     *         rotation per HSK §10.4). The owner is itself a multisig / 5-pillar
     *         off-chain decision per OPERATIONS.md.
     */
    function rotateCommitter(address newCommitter) external onlyOwner {
        if (newCommitter == address(0)) revert ZeroCommitterAddress();
        emit CommitterRotated(committer, newCommitter);
        committer = newCommitter;
    }

    function totalCommitments() external view returns (uint256) {
        return _commitments.length;
    }

    function getCommitment(
        uint256 commitmentId
    )
        external
        view
        returns (
            uint256 fromSeq,
            uint256 toSeq,
            bytes32 rootHash,
            address committedBy,
            uint256 timestamp
        )
    {
        if (commitmentId >= _commitments.length) revert CommitmentNotFound();
        Commitment storage c = _commitments[commitmentId];
        return (c.fromSeq, c.toSeq, c.rootHash, c.committer, c.timestamp);
    }
}
