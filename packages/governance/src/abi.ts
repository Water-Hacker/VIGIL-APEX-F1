/**
 * Stable ABIs for VIGILAnchor.sol and VIGILGovernance.sol.
 *
 * Hardhat regenerates these into typechain bindings; this file holds the
 * manual reference used by lightweight services that don't pull typechain.
 */

export const VIGIL_ANCHOR_ABI = [
  'function commit(uint256 fromSeq, uint256 toSeq, bytes32 rootHash) external',
  'function getCommitment(uint256 commitmentId) view returns (uint256 fromSeq, uint256 toSeq, bytes32 rootHash, address committer, uint256 timestamp)',
  'function totalCommitments() view returns (uint256)',
  'function committer() view returns (address)',
  'event Anchored(uint256 indexed commitmentId, uint256 fromSeq, uint256 toSeq, bytes32 rootHash, address indexed committer)',
] as const;

export const VIGIL_GOVERNANCE_ABI = [
  'function openProposal(bytes32 findingHash, string uri) external returns (uint256 proposalIndex)',
  'function vote(uint256 proposalIndex, uint8 choice, bytes32 recuseReason) external',
  'function getProposal(uint256 proposalIndex) view returns (bytes32 findingHash, string uri, uint8 state, uint256 openedAt, uint256 closesAt, uint8 yes, uint8 no, uint8 abstain, uint8 recuse)',
  'function totalProposals() view returns (uint256)',
  'function isPillarMember(address account) view returns (bool, uint8)',
  'function pillarOf(address account) view returns (uint8)',
  'function quorumRequired() view returns (uint8)',

  'event ProposalOpened(uint256 indexed proposalIndex, bytes32 findingHash, address indexed proposer, string uri)',
  'event VoteCast(uint256 indexed proposalIndex, address indexed voter, uint8 choice, uint8 pillar, bytes32 recuseReason)',
  'event ProposalEscalated(uint256 indexed proposalIndex)',
  'event ProposalDismissed(uint256 indexed proposalIndex)',
  'event ProposalExpired(uint256 indexed proposalIndex)',
  'event MemberAdded(address indexed account, uint8 pillar)',
  'event MemberRemoved(address indexed account, uint8 pillar)',
] as const;

export type Pillar = 'governance' | 'judicial' | 'civil_society' | 'audit' | 'technical';
export const PILLAR_ID: Record<Pillar, number> = {
  governance: 0,
  judicial: 1,
  civil_society: 2,
  audit: 3,
  technical: 4,
};
export const VOTE_CHOICE = { YES: 0, NO: 1, ABSTAIN: 2, RECUSE: 3 } as const;
export const PROPOSAL_STATE = { OPEN: 0, ESCALATED: 1, DISMISSED: 2, EXPIRED: 3 } as const;
