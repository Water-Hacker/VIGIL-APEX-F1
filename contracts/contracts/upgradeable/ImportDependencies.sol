// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.27;

// Forces Hardhat to compile the proxy contracts so deploy scripts and
// tests can resolve their artifacts via `getContractFactory`. No code is
// derived from these imports — they exist solely to pull the artifacts
// into the compilation graph.

import {TransparentUpgradeableProxy} from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import {ProxyAdmin} from "@openzeppelin/contracts/proxy/transparent/ProxyAdmin.sol";

// Re-exporting types alone is a no-op for Solidity; the imports above
// are sufficient. Keeping this contract empty avoids any deployable bytecode.
abstract contract _ProxyDependenciesAnchor {
    // Concrete reference to the imported types so the optimiser does not
    // discard them. These have no runtime cost — they sit only in the ABI
    // table of an abstract contract that is never deployed.
    function _proxyType() internal pure returns (TransparentUpgradeableProxy) {
        return TransparentUpgradeableProxy(payable(address(0)));
    }

    function _adminType() internal pure returns (ProxyAdmin) {
        return ProxyAdmin(address(0));
    }
}
