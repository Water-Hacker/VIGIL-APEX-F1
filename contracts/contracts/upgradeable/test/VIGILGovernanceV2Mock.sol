// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.27;

import {VIGILGovernanceV1} from "../VIGILGovernanceV1.sol";

/**
 * @title VIGILGovernanceV2Mock
 * @notice Test-only mock that demonstrates the upgrade path works.
 *
 * Adds a single new feature on top of V1:
 *   - `delegationFactor(pillar)` — a per-pillar voting weight, intended for
 *     the federation roadmap (multi-council weighted voting). Defaults to 1.
 *
 * Storage extension is appended (consumes a slot from V1's `__gap`); no
 * existing slot is reordered. The mock is the contract a federation upgrade
 * could deploy via ProxyAdmin.upgradeAndCall().
 */
contract VIGILGovernanceV2Mock is VIGILGovernanceV1 {
    mapping(Pillar => uint8) private _delegationFactor;

    event DelegationFactorSet(uint8 pillar, uint8 factor);

    /// @notice Re-entrant-safe re-initialiser for the V2 storage extension.
    /// Marked `reinitializer(2)` so a proxy can call it exactly once during
    /// upgrade. Subsequent V3 reinitialisers would use `reinitializer(3)`.
    function initializeV2(uint8 defaultFactor) external reinitializer(2) {
        for (uint8 i = 0; i < PILLAR_COUNT; i++) {
            _delegationFactor[Pillar(i)] = defaultFactor;
        }
    }

    function setDelegationFactor(Pillar pillar, uint8 factor) external onlyRole(ADMIN_ROLE) {
        _delegationFactor[pillar] = factor;
        emit DelegationFactorSet(uint8(pillar), factor);
    }

    function delegationFactor(Pillar pillar) external view returns (uint8) {
        return _delegationFactor[pillar];
    }

    function contractVersion() external pure override returns (string memory) {
        return "v2-mock";
    }
}
