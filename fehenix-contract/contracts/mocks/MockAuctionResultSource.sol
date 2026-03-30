// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract MockAuctionResultSource {
    struct Result {
        address winner;
        uint64 finalPrice;
        bool finalized;
    }

    mapping(bytes32 => Result) private _results;

    function setResult(bytes32 auctionId, address winner, uint64 finalPrice, bool finalized) external {
        _results[auctionId] = Result({winner: winner, finalPrice: finalPrice, finalized: finalized});
    }

    function getAuctionResult(bytes32 auctionId) external view returns (address winner, uint64 finalPrice, bool finalized) {
        Result memory result = _results[auctionId];
        return (result.winner, result.finalPrice, result.finalized);
    }
}
