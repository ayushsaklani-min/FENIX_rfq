// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { FHERC20 } from "fhenix-confidential-contracts/contracts/FHERC20.sol";
import { FHERC20Permit } from "fhenix-confidential-contracts/contracts/FHERC20Permit.sol";
import { euint64 } from "@fhenixprotocol/cofhe-contracts/FHE.sol";

contract SealDemoFHERC20Permit is FHERC20, FHERC20Permit, Ownable {
    event Minted(address indexed to, uint64 amount, bytes32 transferredCtHash);

    constructor(
        string memory name_,
        string memory symbol_,
        uint8 decimals_,
        address initialOwner,
        address initialRecipient,
        uint64 initialSupply
    )
        FHERC20(name_, symbol_, decimals_)
        FHERC20Permit(name_)
        Ownable(initialOwner)
    {
        if (initialSupply > 0) {
            address recipient = initialRecipient == address(0) ? initialOwner : initialRecipient;
            euint64 transferred = _mint(recipient, initialSupply);
            emit Minted(recipient, initialSupply, euint64.unwrap(transferred));
        }
    }

    function mint(address to, uint64 amount) external onlyOwner returns (bytes32 transferredCtHash) {
        euint64 transferred = _mint(to, amount);
        transferredCtHash = euint64.unwrap(transferred);
        emit Minted(to, amount, transferredCtHash);
    }
}
