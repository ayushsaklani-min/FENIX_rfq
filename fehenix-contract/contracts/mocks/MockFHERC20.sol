// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@fhenixprotocol/cofhe-contracts/FHE.sol";
import "../interfaces/IFHERC20.sol";

contract MockFHERC20 is IFHERC20, IFHERC20Permit {
    mapping(address => euint64) private _balances;
    mapping(address => mapping(address => uint48)) private _operators;

    event Mint(address indexed to, uint64 amount);
    event OperatorSet(address indexed owner, address indexed operator, uint48 until);
    event SimulatedCallback(bytes32 indexed decisionCtHash);

    function mint(address to, uint64 amount) external {
        euint64 updatedBalance = FHE.add(_balances[to], FHE.asEuint64(amount));
        _balances[to] = updatedBalance;
        FHE.allowThis(updatedBalance);
        FHE.allow(updatedBalance, to);
        emit Mint(to, amount);
    }

    function permit(
        address owner,
        address spender,
        uint48 until,
        uint256 deadline,
        uint8,
        bytes32,
        bytes32
    ) external override {
        require(block.timestamp <= deadline, "permit expired");
        _operators[owner][spender] = until;
        emit OperatorSet(owner, spender, until);
    }

    function setOperator(address operator, uint48 until) external override {
        _operators[msg.sender][operator] = until;
        emit OperatorSet(msg.sender, operator, until);
    }

    function isOperator(address holder, address spender) external view override returns (bool) {
        return _operators[holder][spender] >= block.timestamp;
    }

    function confidentialBalanceOf(address account) external view override returns (euint64) {
        return _balances[account];
    }

    function confidentialTransfer(address to, InEuint64 memory inValue) external override returns (euint64 transferred) {
        return confidentialTransfer(to, FHE.asEuint64(inValue));
    }

    function confidentialTransfer(address to, euint64 value) public override returns (euint64 transferred) {
        transferred = _transfer(msg.sender, to, value);
    }

    function confidentialTransferFrom(
        address from,
        address to,
        InEuint64 memory inValue
    ) external override returns (euint64 transferred) {
        return confidentialTransferFrom(from, to, FHE.asEuint64(inValue));
    }

    function confidentialTransferFrom(address from, address to, euint64 value) public override returns (euint64 transferred) {
        require(msg.sender == from || _operators[from][msg.sender] >= block.timestamp, "operator missing");
        transferred = _transfer(from, to, value);
    }

    function confidentialTransferAndCall(
        address to,
        InEuint64 memory inValue,
        bytes calldata data
    ) external override returns (euint64 transferred) {
        return confidentialTransferAndCall(to, FHE.asEuint64(inValue), data);
    }

    function confidentialTransferAndCall(
        address to,
        euint64 value,
        bytes calldata data
    ) public override returns (euint64 transferred) {
        transferred = _transfer(msg.sender, to, value);
        _invokeReceiver(msg.sender, msg.sender, to, transferred, data);
    }

    function confidentialTransferFromAndCall(
        address from,
        address to,
        InEuint64 memory inValue,
        bytes calldata data
    ) external override returns (euint64 transferred) {
        return confidentialTransferFromAndCall(from, to, FHE.asEuint64(inValue), data);
    }

    function confidentialTransferFromAndCall(
        address from,
        address to,
        euint64 value,
        bytes calldata data
    ) public override returns (euint64 transferred) {
        require(msg.sender == from || _operators[from][msg.sender] >= block.timestamp, "operator missing");
        transferred = _transfer(from, to, value);
        _invokeReceiver(msg.sender, from, to, transferred, data);
    }

    function _transfer(address from, address to, euint64 value) internal returns (euint64 transferred) {
        require(to != address(0), "invalid recipient");

        euint64 zero = FHE.asEuint64(0);
        ebool hasBalance = FHE.lte(value, _balances[from]);
        transferred = FHE.select(hasBalance, value, zero);

        euint64 newFromBalance = FHE.sub(_balances[from], transferred);
        euint64 newToBalance = FHE.add(_balances[to], transferred);

        _balances[from] = newFromBalance;
        _balances[to] = newToBalance;

        FHE.allowThis(newFromBalance);
        FHE.allowThis(newToBalance);
        FHE.allow(newFromBalance, from);
        FHE.allow(newToBalance, to);

        FHE.allowTransient(transferred, msg.sender);
        FHE.allow(transferred, from);
        FHE.allow(transferred, to);
    }

    function _invokeReceiver(
        address operator,
        address from,
        address to,
        euint64 transferred,
        bytes calldata data
    ) internal {
        if (to.code.length == 0) {
            return;
        }

        FHE.allowTransient(transferred, to);
        IFHERC20Receiver(to).onConfidentialTransferReceived(operator, from, transferred, data);
    }

    function simulateCallback(
        address receiver,
        address operator,
        address from,
        bytes32 amountCtHash,
        bytes calldata data
    ) external returns (bytes32 decisionCtHash) {
        euint64 amount = euint64.wrap(amountCtHash);
        if (amountCtHash != bytes32(0)) {
            FHE.allowTransient(amount, receiver);
        }

        ebool decision = IFHERC20Receiver(receiver).onConfidentialTransferReceived(operator, from, amount, data);
        decisionCtHash = ebool.unwrap(decision);
        emit SimulatedCallback(decisionCtHash);
    }
}
