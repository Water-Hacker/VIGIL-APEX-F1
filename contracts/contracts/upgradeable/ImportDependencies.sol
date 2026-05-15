// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.27;

// solhint-disable no-unused-import
// slither-disable-next-line unused-import
import {TransparentUpgradeableProxy} from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
// slither-disable-next-line unused-import
import {ProxyAdmin} from "@openzeppelin/contracts/proxy/transparent/ProxyAdmin.sol";

/**
 * @title ProxyDependenciesAnchor
 * @notice Forces Hardhat to compile the OZ proxy contracts so deploy
 * scripts + tests can resolve their artifacts via `getContractFactory`.
 *
 * No bytecode is generated for this contract — it is abstract and has
 * no functions. The imports above are the only thing that matters; they
 * pull TransparentUpgradeableProxy + ProxyAdmin into the Hardhat
 * compilation graph. The empty body intentionally has no public surface
 * for slither / solhint / etc to complain about.
 */
// solhint-disable-next-line no-empty-blocks
abstract contract ProxyDependenciesAnchor {}
