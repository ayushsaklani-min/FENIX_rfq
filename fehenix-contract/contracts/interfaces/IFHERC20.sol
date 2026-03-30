// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "@fhenixprotocol/cofhe-contracts/FHE.sol";

interface IFHERC20 {
    function confidentialTransfer(address to, InEuint64 memory inValue) external returns (euint64 transferred);
    function confidentialTransfer(address to, euint64 value) external returns (euint64 transferred);
    function confidentialTransferFrom(address from, address to, InEuint64 memory inValue) external returns (euint64 transferred);
    function confidentialTransferFrom(address from, address to, euint64 value) external returns (euint64 transferred);
    function confidentialTransferAndCall(address to, InEuint64 memory inValue, bytes calldata data) external returns (euint64 transferred);
    function confidentialTransferAndCall(address to, euint64 value, bytes calldata data) external returns (euint64 transferred);
    function confidentialTransferFromAndCall(address from, address to, InEuint64 memory inValue, bytes calldata data) external returns (euint64 transferred);
    function confidentialTransferFromAndCall(address from, address to, euint64 value, bytes calldata data) external returns (euint64 transferred);
    function confidentialBalanceOf(address account) external view returns (euint64);
    function setOperator(address operator, uint48 until) external;
    function isOperator(address holder, address spender) external view returns (bool);
}

/// @dev Optional extension for permit-enabled FHERC20 implementations that can authorize
///      short-lived operator access by signature before the existing operator-based flows run.
interface IFHERC20Permit {
    function permit(
        address owner,
        address spender,
        uint48 until,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;
}

interface IFHERC20Receiver {
    function onConfidentialTransferReceived(
        address operator,
        address from,
        euint64 amount,
        bytes calldata data
    ) external returns (ebool);
}
