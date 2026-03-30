// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@fhenixprotocol/cofhe-contracts/FHE.sol";
import "../interfaces/IFHERC20.sol";

contract MockCallbackProbe {
    event CallbackDecision(bytes32 indexed decisionCtHash);

    function callReceiver(
        address receiver,
        address operator,
        address from,
        bytes32 amountCtHash,
        bytes calldata data
    ) external returns (bytes32 decisionCtHash) {
        ebool decision = IFHERC20Receiver(receiver).onConfidentialTransferReceived(
            operator,
            from,
            euint64.wrap(amountCtHash),
            data
        );
        decisionCtHash = ebool.unwrap(decision);
        emit CallbackDecision(decisionCtHash);
    }
}
