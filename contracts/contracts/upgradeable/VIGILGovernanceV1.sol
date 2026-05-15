// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.27;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {Initializable} from "./Initializable.sol";

/**
 * @title VIGILGovernanceV1
 * @notice Upgradeable variant of VIGILGovernance for the federation roadmap.
 *
 * FRONTIER-AUDIT closure: the original `VIGILGovernance.sol` is intentionally
 * non-upgradeable (a single-council mainnet anchor). The federation roadmap
 * (multi-council voting, delegation, weighted votes) needs the ability to
 * evolve the contract logic without rotating the deployed address. This
 * variant fronts the same 5-pillar / 3-of-5-quorum logic behind a
 * TransparentUpgradeableProxy so future upgrades land at the same address
 * the off-chain code references.
 *
 * Upgrade-safety rules respected:
 *   - No constructor logic that touches state (only `_disableInitializers`).
 *   - All initialisation in `initialize(admin)`, gated by `initializer`.
 *   - Storage slots are append-only; the `__gap` array reserves room for
 *     future variables without shifting existing layout.
 *   - Inherits OZ v5 AccessControl (no state-touching constructor) and
 *     ReentrancyGuard (ERC-7201 namespaced storage).
 *
 * Behaviour mirrors `VIGILGovernance.sol` exactly so the deployed proxy is a
 * drop-in for the same off-chain ABI. The only difference is the
 * `initialize(admin)` entry point in place of the immutable constructor.
 */
contract VIGILGovernanceV1 is Initializable, AccessControl, ReentrancyGuard {
    bytes32 public constant ADMIN_ROLE = DEFAULT_ADMIN_ROLE;

    uint8 public constant PILLAR_COUNT = 5;
    uint8 public constant QUORUM_REQUIRED = 3;
    uint64 public constant VOTE_WINDOW = 14 days;

    enum Pillar {
        Governance,
        Judicial,
        CivilSociety,
        Audit,
        Technical
    }
    enum Choice {
        Yes,
        No,
        Abstain,
        Recuse
    }
    enum State {
        Open,
        Escalated,
        Dismissed,
        Expired
    }

    struct Member {
        address account;
        Pillar pillar;
        bool active;
    }

    struct Proposal {
        bytes32 findingHash;
        string uri;
        address proposer;
        State state;
        uint64 openedAt;
        uint64 closesAt;
        uint8 yes;
        uint8 no;
        uint8 abstain;
        uint8 recuse;
    }

    mapping(Pillar => Member) public memberByPillar;
    mapping(address => Member) public memberByAccount;

    Proposal[] private _proposals;
    uint8 private constant NOT_VOTED = 0;
    mapping(uint256 => mapping(address => uint8)) public votedChoice;
    mapping(uint256 => mapping(address => bytes32)) public recuseReason;

    // Commit-reveal anti-front-running
    uint256 public constant REVEAL_DELAY = 2 minutes;
    mapping(address => mapping(bytes32 => uint64)) public commitments;

    /// @custom:storage-gap reserved for future upgrades (federation, delegated votes)
    uint256[40] private __gap;

    event ProposalOpened(
        uint256 indexed proposalIndex,
        bytes32 findingHash,
        address indexed proposer,
        string uri
    );
    event VoteCast(
        uint256 indexed proposalIndex,
        address indexed voter,
        uint8 choice,
        uint8 pillar,
        bytes32 recuseReason
    );
    event ProposalEscalated(uint256 indexed proposalIndex);
    event ProposalDismissed(uint256 indexed proposalIndex);
    event ProposalExpired(uint256 indexed proposalIndex);
    event MemberAdded(address indexed account, uint8 pillar);
    event MemberRemoved(address indexed account, uint8 pillar);
    event ProposalCommitted(
        address indexed proposer,
        bytes32 commitment,
        uint64 commitBlockTimestamp
    );

    error NotPillarMember();
    error AlreadyVoted();
    error ProposalNotOpen();
    error WindowClosed();
    error PillarOccupied();
    error ZeroAddress();
    error UnknownProposal();
    error InvalidChoice();
    error EmptyCommitment();
    error EmptyFinding();
    error NotYetExpired();
    error CommitmentNotFound();
    error CommitmentTooEarly();

    /// @dev Lock the implementation against direct initialisation. Only the
    /// proxy (with its own delegatecalled storage) may initialise.
    constructor() {
        _disableInitializers();
    }

    function initialize(address admin) external initializer {
        if (admin == address(0)) revert ZeroAddress();
        _grantRole(ADMIN_ROLE, admin);
    }

    /* ==================== Member management ============================ */

    function addMember(address account, Pillar pillar) external onlyRole(ADMIN_ROLE) {
        if (account == address(0)) revert ZeroAddress();
        Member storage seat = memberByPillar[pillar];
        if (seat.active) revert PillarOccupied();
        memberByPillar[pillar] = Member({account: account, pillar: pillar, active: true});
        memberByAccount[account] = Member({account: account, pillar: pillar, active: true});
        emit MemberAdded(account, uint8(pillar));
    }

    function removeMember(Pillar pillar) external onlyRole(ADMIN_ROLE) {
        Member storage seat = memberByPillar[pillar];
        if (!seat.active) revert NotPillarMember();
        address acct = seat.account;
        seat.active = false;
        memberByAccount[acct].active = false;
        emit MemberRemoved(acct, uint8(pillar));
    }

    function isPillarMember(address account) external view returns (bool, uint8) {
        Member storage m = memberByAccount[account];
        return (m.active, uint8(m.pillar));
    }

    function pillarOf(address account) external view returns (uint8) {
        return uint8(memberByAccount[account].pillar);
    }

    function quorumRequired() external pure returns (uint8) {
        return QUORUM_REQUIRED;
    }

    /* ==================== Proposals + voting =========================== */

    function commitProposal(bytes32 commitment) external {
        Member storage m = memberByAccount[msg.sender];
        if (!m.active) revert NotPillarMember();
        if (commitment == bytes32(0)) revert EmptyCommitment();
        commitments[msg.sender][commitment] = uint64(block.timestamp);
        emit ProposalCommitted(msg.sender, commitment, uint64(block.timestamp));
    }

    function openProposal(
        bytes32 findingHash,
        string calldata uri,
        bytes32 salt
    ) external returns (uint256 idx) {
        Member storage m = memberByAccount[msg.sender];
        if (!m.active) revert NotPillarMember();
        if (findingHash == bytes32(0)) revert EmptyFinding();

        bytes32 commitment = keccak256(abi.encode(findingHash, uri, salt, msg.sender));
        uint64 committedAt = commitments[msg.sender][commitment];
        if (committedAt == 0) revert CommitmentNotFound();
        if (block.timestamp < committedAt + REVEAL_DELAY) revert CommitmentTooEarly();
        delete commitments[msg.sender][commitment];

        idx = _proposals.length;
        _proposals.push(
            Proposal({
                findingHash: findingHash,
                uri: uri,
                proposer: msg.sender,
                state: State.Open,
                openedAt: uint64(block.timestamp),
                closesAt: uint64(block.timestamp) + VOTE_WINDOW,
                yes: 0,
                no: 0,
                abstain: 0,
                recuse: 0
            })
        );
        emit ProposalOpened(idx, findingHash, msg.sender, uri);
    }

    function vote(uint256 proposalIndex, uint8 choice, bytes32 reason) external nonReentrant {
        if (proposalIndex >= _proposals.length) revert UnknownProposal();
        Member storage m = memberByAccount[msg.sender];
        if (!m.active) revert NotPillarMember();

        Proposal storage p = _proposals[proposalIndex];
        if (p.state != State.Open) revert ProposalNotOpen();
        if (block.timestamp > p.closesAt) {
            p.state = State.Expired;
            emit ProposalExpired(proposalIndex);
            revert WindowClosed();
        }
        if (votedChoice[proposalIndex][msg.sender] != NOT_VOTED) revert AlreadyVoted();

        if (choice == uint8(Choice.Yes)) {
            p.yes += 1;
        } else if (choice == uint8(Choice.No)) {
            p.no += 1;
        } else if (choice == uint8(Choice.Abstain)) {
            p.abstain += 1;
        } else if (choice == uint8(Choice.Recuse)) {
            p.recuse += 1;
            recuseReason[proposalIndex][msg.sender] = reason;
        } else {
            revert InvalidChoice();
        }

        votedChoice[proposalIndex][msg.sender] = choice + 1;
        emit VoteCast(proposalIndex, msg.sender, choice, uint8(m.pillar), reason);

        if (p.yes >= QUORUM_REQUIRED) {
            p.state = State.Escalated;
            emit ProposalEscalated(proposalIndex);
        } else if (p.no >= QUORUM_REQUIRED) {
            p.state = State.Dismissed;
            emit ProposalDismissed(proposalIndex);
        }
    }

    function settleExpiredProposal(uint256 proposalIndex) external {
        if (proposalIndex >= _proposals.length) revert UnknownProposal();
        Proposal storage p = _proposals[proposalIndex];
        if (p.state != State.Open) revert ProposalNotOpen();
        if (block.timestamp <= p.closesAt) revert NotYetExpired();
        p.state = State.Expired;
        emit ProposalExpired(proposalIndex);
    }

    function totalProposals() external view returns (uint256) {
        return _proposals.length;
    }

    function getProposal(
        uint256 proposalIndex
    )
        external
        view
        returns (
            bytes32 findingHash,
            string memory uri,
            uint8 state,
            uint256 openedAt,
            uint256 closesAt,
            uint8 yes,
            uint8 no,
            uint8 abstain,
            uint8 recuse
        )
    {
        if (proposalIndex >= _proposals.length) revert UnknownProposal();
        Proposal storage p = _proposals[proposalIndex];
        return (
            p.findingHash,
            p.uri,
            uint8(p.state),
            p.openedAt,
            p.closesAt,
            p.yes,
            p.no,
            p.abstain,
            p.recuse
        );
    }

    /// @notice On-chain version marker, separate from initializer version.
    /// Off-chain code reads this to know which features the deployed
    /// implementation supports.
    function contractVersion() external pure virtual returns (string memory) {
        return "v1";
    }
}
