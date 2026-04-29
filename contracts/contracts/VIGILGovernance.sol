// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.27;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title VIGILGovernance
 * @notice 5-pillar council with 3-of-5 escalation quorum (SRD §23).
 *
 * Pillars:
 *   0 = governance
 *   1 = judicial
 *   2 = civil_society
 *   3 = audit
 *   4 = technical
 *
 * Voting:
 *   choice ∈ { YES (0), NO (1), ABSTAIN (2), RECUSE (3) }
 *   - 3 YES → escalated
 *   - 3 NO  → dismissed
 *   - Neither reached within VOTE_WINDOW → expired (inconclusive)
 *   - Each member may vote at most once per proposal.
 *
 * The contract is deliberately minimal and non-upgradeable. Member rotations
 * require admin (off-chain 5-pillar decision) and emit MemberAdded /
 * MemberRemoved for audit.
 */
contract VIGILGovernance is AccessControl, ReentrancyGuard {
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
        string uri; // off-chain dossier reference (e.g. ipfs://CID)
        address proposer;
        State state;
        uint64 openedAt;
        uint64 closesAt;
        uint8 yes;
        uint8 no;
        uint8 abstain;
        uint8 recuse;
    }

    /// @notice One slot per pillar — at most one active member per pillar at a time.
    mapping(Pillar => Member) public memberByPillar;
    /// @notice Reverse lookup: account → (pillar, active).
    mapping(address => Member) public memberByAccount;

    Proposal[] private _proposals;
    /// @notice Per-proposal vote record per member. Sentinel choice = 255 → not voted.
    mapping(uint256 => mapping(address => uint8)) public votedChoice;
    mapping(uint256 => mapping(address => bytes32)) public recuseReason;

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

    error NotPillarMember();
    error AlreadyVoted();
    error ProposalNotOpen();
    error WindowClosed();
    error PillarOccupied();
    error ZeroAddress();
    error UnknownProposal();
    error InvalidChoice();

    constructor(address admin) {
        require(admin != address(0), "Zero admin");
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

    /* ----- Commit-reveal anti-front-running (B11 / SRD §22.6) -----
     * A bot watching the mempool would otherwise be able to copy an open
     * dossier URI before the proposer's tx confirms — and a hostile
     * relayer could withhold the original tx in favour of one with a
     * mutated URI. We therefore require a two-phase open:
     *
     *   1. commitProposal(commitment) where
     *      commitment = keccak256(abi.encode(findingHash, uri, salt, msg.sender))
     *      Locks the (proposer, commitment) tuple; bots see only the hash.
     *
     *   2. After REVEAL_DELAY blocks, openProposal(findingHash, uri, salt)
     *      checks the commitment matches and, if so, creates the proposal.
     *      The salt prevents brute-force pre-image attacks on the URI
     *      space (URIs are otherwise enumerable across IPFS gateways).
     */
    uint256 public constant REVEAL_DELAY = 2 minutes;
    mapping(address => mapping(bytes32 => uint64)) public commitments;

    event ProposalCommitted(
        address indexed proposer,
        bytes32 commitment,
        uint64 commitBlockTimestamp
    );

    error CommitmentNotFound();
    error CommitmentTooEarly();
    error CommitmentMismatch();

    function commitProposal(bytes32 commitment) external {
        Member storage m = memberByAccount[msg.sender];
        if (!m.active) revert NotPillarMember();
        require(commitment != bytes32(0), "Empty commitment");
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
        require(findingHash != bytes32(0), "Empty finding");

        bytes32 commitment = keccak256(abi.encode(findingHash, uri, salt, msg.sender));
        uint64 committedAt = commitments[msg.sender][commitment];
        if (committedAt == 0) revert CommitmentNotFound();
        if (block.timestamp < committedAt + REVEAL_DELAY) revert CommitmentTooEarly();
        // Spend the commitment (replay protection)
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
            // Auto-expire on touch
            p.state = State.Expired;
            emit ProposalExpired(proposalIndex);
            revert WindowClosed();
        }
        if (votedChoice[proposalIndex][msg.sender] != 0) revert AlreadyVoted();

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

        // Mark voted (we use 1-based to keep 0 == not voted; choice is encoded 1..4)
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

    /// @notice Anyone may settle an expired proposal — useful for housekeeping.
    function settleExpiredProposal(uint256 proposalIndex) external {
        if (proposalIndex >= _proposals.length) revert UnknownProposal();
        Proposal storage p = _proposals[proposalIndex];
        if (p.state != State.Open) revert ProposalNotOpen();
        require(block.timestamp > p.closesAt, "Not yet expired");
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
}
