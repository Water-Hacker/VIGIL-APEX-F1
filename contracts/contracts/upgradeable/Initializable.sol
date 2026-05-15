// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.27;

/**
 * @title Initializable
 * @notice Minimal upgrade-safe initializer pattern, ERC-7201-storage-slot variant.
 *
 * Inlined to avoid pulling in the full OpenZeppelin contracts-upgradeable
 * package — we use only the initializer modifier and the constructor disable
 * pattern. The storage slot is the OpenZeppelin canonical one so that any
 * future migration to the contracts-upgradeable package is layout-compatible.
 *
 * State stored at a custom slot (ERC-7201) so child contract storage layout is
 * unaffected; the `_initialized` and `_initializing` fields therefore do not
 * count toward the child's storage slots and adding/removing them cannot
 * silently shift other variables.
 */
abstract contract Initializable {
    /// @custom:storage-location erc7201:openzeppelin.storage.Initializable
    struct InitializableStorage {
        uint64 _initialized;
        bool _initializing;
    }

    // keccak256(abi.encode(uint256(keccak256("openzeppelin.storage.Initializable")) - 1))
    //   & ~bytes32(uint256(0xff))
    bytes32 private constant INITIALIZABLE_STORAGE =
        0xf0c57e16840df040f15088dc2f81fe391c3923bec73e23a9662efc9c229c6a00;

    error InvalidInitialization();
    error NotInitializing();

    event Initialized(uint64 version);

    modifier initializer() {
        InitializableStorage storage $ = _getInitializableStorage();
        bool isTopLevelCall = !$._initializing;
        uint64 initialized = $._initialized;
        if (
            !(isTopLevelCall && initialized < 1) &&
            !(address(this).code.length == 0 && initialized == 1)
        ) {
            revert InvalidInitialization();
        }
        $._initialized = 1;
        if (isTopLevelCall) {
            $._initializing = true;
        }
        _;
        if (isTopLevelCall) {
            $._initializing = false;
            emit Initialized(1);
        }
    }

    modifier reinitializer(uint64 version) {
        InitializableStorage storage $ = _getInitializableStorage();
        if ($._initializing || $._initialized >= version) revert InvalidInitialization();
        $._initialized = version;
        $._initializing = true;
        _;
        $._initializing = false;
        emit Initialized(version);
    }

    modifier onlyInitializing() {
        if (!_getInitializableStorage()._initializing) revert NotInitializing();
        _;
    }

    /**
     * @notice Locks the implementation contract against initialization.
     * Call from the implementation's constructor so the bare implementation
     * cannot be initialised — only proxies can.
     */
    function _disableInitializers() internal {
        InitializableStorage storage $ = _getInitializableStorage();
        if ($._initializing) revert InvalidInitialization();
        if ($._initialized != type(uint64).max) {
            $._initialized = type(uint64).max;
            emit Initialized(type(uint64).max);
        }
    }

    /// @dev Returns the storage struct at the ERC-7201 canonical slot.
    /// Inline assembly is required because Solidity does not provide a
    /// way to assign an arbitrary storage slot to a typed reference at
    /// the language level. This is the exact pattern OpenZeppelin's
    /// upstream Initializable uses and is the documented ERC-7201
    /// idiom; the solhint exception is therefore safe.
    function _getInitializableStorage() private pure returns (InitializableStorage storage $) {
        // slither-disable-next-line assembly
        // solhint-disable-next-line no-inline-assembly
        assembly {
            $.slot := INITIALIZABLE_STORAGE
        }
    }
}
