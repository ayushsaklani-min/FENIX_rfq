// SPDX-License-Identifier: MIT

pragma solidity ^0.8.24;

import "@fhenixprotocol/cofhe-contracts/FHE.sol";
import "./interfaces/IFHERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface ISealRFQ {
    function recordInvoicePayment(bytes32 rfqId, bytes32 receiptId) external;
}

contract SealInvoice is ReentrancyGuard, IFHERC20Receiver {

    enum InvoiceStatus {
        None,
        Pending,
        Paid,
        Completed,
        Cancelled,
        Refunded
    }

    struct Invoice {
        bytes32 invoiceId;
        address payer;
        address payee;
        address token;
        uint256 amount;
        bytes32 rfqId;
        bytes32 orderId;
        InvoiceStatus status;
        uint256 createdAt;
        uint256 paidAt;
        bytes32 descriptionHash;
    }

    struct PaymentReceipt {
        bytes32 receiptId;
        bytes32 invoiceId;
        address payer;
        address payee;
        address token;
        uint256 amount;
        uint256 timestamp;
        bytes32 txHash;
    }

    struct PendingDirectPayment {
        bytes32 paymentId;
        address from;
        address to;
        address token;
        uint256 amount;
    }

    address public sealRFQAddress;
    address public admin;
    
    mapping(bytes32 => Invoice) public invoices;
    mapping(bytes32 => PaymentReceipt) public receipts;
    mapping(bytes32 => bytes32) public invoiceToReceipt;
    mapping(bytes32 => bytes32) public pendingPaymentCt;
    mapping(bytes32 => bytes32) public pendingTransferCheckCt;
    mapping(bytes32 => PendingDirectPayment) public pendingDirectPayments;
    mapping(address => bytes32[]) public payerInvoices;
    mapping(address => bytes32[]) public payeeInvoices;
    mapping(bytes32 => bytes32[]) public rfqInvoices;

    uint256 public invoiceCount;
    uint256 public receiptCount;
    uint256 public transferVerificationNonce;

    event InvoiceCreated(
        bytes32 indexed invoiceId,
        address indexed payer,
        address indexed payee,
        address token,
        uint256 amount,
        bytes32 rfqId,
        bytes32 orderId,
        string description
    );
    event InvoicePaid(
        bytes32 indexed invoiceId,
        bytes32 indexed receiptId,
        address indexed payer,
        uint256 amount,
        uint256 timestamp
    );
    event InvoicePaymentPending(bytes32 indexed invoiceId, bytes32 indexed amountCtHash);
    event InvoiceCancelled(
        bytes32 indexed invoiceId,
        address indexed canceller,
        string reason
    );
    event PaymentRefunded(
        bytes32 indexed invoiceId,
        address indexed payee,
        address indexed payer,
        uint256 amount
    );
    event InvoiceCompleted(bytes32 indexed invoiceId, address indexed payee, uint256 amount);
    event DirectPayment(
        bytes32 indexed paymentId,
        address indexed from,
        address indexed to,
        address token,
        uint256 amount
    );
    event OperatorAccessVerified(bytes32 indexed actionId, address indexed account, address indexed token);
    event TransferVerificationRequested(bytes32 indexed transferId, bytes32 indexed successCtHash);
    event TransferVerified(bytes32 indexed transferId, bool success);
    event SealRFQAddressSet(address indexed newAddress);
    event RFQSyncFailed(bytes32 indexed rfqId, bytes32 indexed receiptId);

    constructor(address _sealRFQAddress) {
        sealRFQAddress = _sealRFQAddress;
        admin = msg.sender;
    }

    function _asUint64(uint256 amount) internal pure returns (uint64) {
        require(amount <= type(uint64).max, "Amount exceeds FHERC20 range");
        return uint64(amount);
    }

    function _createReceipt(Invoice storage invoice, address payer) internal returns (bytes32 receiptId) {
        receiptId = keccak256(abi.encodePacked(
            invoice.invoiceId,
            payer,
            receiptCount,
            block.timestamp
        ));

        receipts[receiptId] = PaymentReceipt({
            receiptId: receiptId,
            invoiceId: invoice.invoiceId,
            payer: payer,
            payee: invoice.payee,
            token: invoice.token,
            amount: invoice.amount,
            timestamp: block.timestamp,
            txHash: bytes32(0)
        });

        invoiceToReceipt[invoice.invoiceId] = receiptId;
        receiptCount++;
    }

    function _notifyRfq(bytes32 rfqId, bytes32 receiptId) internal {
        if (rfqId != bytes32(0) && sealRFQAddress != address(0)) {
            try ISealRFQ(sealRFQAddress).recordInvoicePayment(rfqId, receiptId) {} 
            catch {
                emit RFQSyncFailed(rfqId, receiptId);
            }
        }
    }

    function _allowCallbackResult(ebool decision) internal returns (ebool) {
        FHE.allowTransient(decision, msg.sender);
        return decision;
    }

    function _rejectTransfer() internal returns (ebool) {
        ebool rejected = FHE.asEbool(false);
        return _allowCallbackResult(rejected);
    }

    function _queueTransferCheck(
        bytes32 scope,
        euint64 transferred,
        euint64 expected
    ) internal returns (bytes32 transferId) {
        ebool transferOk = FHE.eq(transferred, expected);
        FHE.allowThis(transferOk);
        FHE.allowPublic(transferOk);

        transferId = keccak256(abi.encodePacked(address(this), scope, transferVerificationNonce));
        transferVerificationNonce++;
        pendingTransferCheckCt[transferId] = ebool.unwrap(transferOk);

        emit TransferVerificationRequested(transferId, ebool.unwrap(transferOk));
    }

    function _confidentialTransferExact(
        address token,
        address to,
        uint256 amount,
        bytes32 transferScope
    ) internal returns (bytes32 transferId) {
        euint64 encryptedAmount = FHE.asEuint64(_asUint64(amount));
        FHE.allowTransient(encryptedAmount, token);

        euint64 transferred = IFHERC20(token).confidentialTransfer(to, encryptedAmount);
        FHE.allow(transferred, to);

        transferId = _queueTransferCheck(transferScope, transferred, encryptedAmount);
    }

    function _permitShortLivedOperator(
        address token,
        address owner,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) internal {
        IFHERC20Permit(token).permit(
            owner,
            address(this),
            uint48(block.timestamp + 10 minutes),
            deadline,
            v,
            r,
            s
        );
    }

    function _payInvoice(bytes32 invoiceId, address payer) internal {
        Invoice storage invoice = invoices[invoiceId];

        require(invoice.status == InvoiceStatus.Pending, "Invoice not pending");
        require(payer == invoice.payer, "Only payer can pay");
        require(invoice.token != address(0), "Use payInvoiceNative for native token");
        require(pendingPaymentCt[invoiceId] == bytes32(0), "Payment already pending");

        IFHERC20 token = IFHERC20(invoice.token);
        require(token.isOperator(payer, address(this)), "Grant short-lived operator first");
        emit OperatorAccessVerified(invoiceId, payer, invoice.token);

        euint64 encryptedAmount = FHE.asEuint64(_asUint64(invoice.amount));
        FHE.allowTransient(encryptedAmount, invoice.token);

        euint64 transferred = token.confidentialTransferFromAndCall(
            payer,
            address(this),
            encryptedAmount,
            abi.encode(invoiceId)
        );
        _queueTransferCheck(keccak256(abi.encodePacked("invoice-pay", invoiceId)), transferred, encryptedAmount);

        require(pendingPaymentCt[invoiceId] != bytes32(0), "Payment callback failed");
    }

    function _directPayment(
        bytes32 paymentId,
        address from,
        address to,
        address token,
        uint256 amount
    ) internal {
        require(paymentId != bytes32(0), "Invalid payment ID");
        require(to != address(0), "Invalid recipient");
        require(to != from, "Cannot pay self");
        require(amount > 0, "Amount must be positive");
        require(token != address(0), "Use directPaymentNative for native token");
        IFHERC20 fherc20 = IFHERC20(token);
        require(fherc20.isOperator(from, address(this)), "Grant short-lived operator first");
        emit OperatorAccessVerified(paymentId, from, token);

        euint64 encryptedAmount = FHE.asEuint64(_asUint64(amount));
        FHE.allowTransient(encryptedAmount, token);

        euint64 transferred = fherc20.confidentialTransferFrom(from, to, encryptedAmount);
        FHE.allow(transferred, to);
        bytes32 transferId = _queueTransferCheck(
            keccak256(abi.encodePacked("direct-payment", paymentId)),
            transferred,
            encryptedAmount
        );

        pendingDirectPayments[transferId] = PendingDirectPayment({
            paymentId: paymentId,
            from: from,
            to: to,
            token: token,
            amount: amount
        });
    }

    
    
    function setSealRFQAddress(address _sealRFQAddress) external {
        require(msg.sender == admin, "Only admin");
        sealRFQAddress = _sealRFQAddress;
        emit SealRFQAddressSet(_sealRFQAddress);
    }

    modifier invoiceExists(bytes32 invoiceId) {
        require(invoices[invoiceId].payer != address(0), "Invoice does not exist");
        _;
    }

    
    function createInvoice(
        bytes32 invoiceId,
        bytes32 salt,
        address payee,
        address token,
        uint256 amount,
        bytes32 rfqId,
        bytes32 orderId,
        string calldata description
    ) external {
        require(invoiceId != bytes32(0), "Invalid invoice ID");
        require(invoices[invoiceId].payer == address(0), "Invoice already exists");
        require(payee != address(0), "Invalid payee");
        require(payee != msg.sender, "Cannot invoice self");
        require(amount > 0, "Amount must be positive");
        if (token != address(0)) {
            require(amount <= type(uint64).max, "FHERC20 amount too large");
        }
        
        if (salt != bytes32(0)) {
            require(
                invoiceId == keccak256(abi.encodePacked(msg.sender, payee, amount, salt)),
                "Invalid invoice ID hash"
            );
        }

        invoices[invoiceId] = Invoice({
            invoiceId: invoiceId,
            payer: msg.sender,
            payee: payee,
            token: token,
            amount: amount,
            rfqId: rfqId,
            orderId: orderId,
            status: InvoiceStatus.Pending,
            createdAt: block.timestamp,
            paidAt: 0,
            descriptionHash: keccak256(bytes(description))
        });

        payerInvoices[msg.sender].push(invoiceId);
        payeeInvoices[payee].push(invoiceId);
        
        if (rfqId != bytes32(0)) {
            rfqInvoices[rfqId].push(invoiceId);
        }
        
        invoiceCount++;

        emit InvoiceCreated(invoiceId, msg.sender, payee, token, amount, rfqId, orderId, description);
    }

    
    function payInvoice(bytes32 invoiceId) external invoiceExists(invoiceId) {
        _payInvoice(invoiceId, msg.sender);
    }

    
    function permitAndPayInvoice(
        bytes32 invoiceId,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external invoiceExists(invoiceId) {
        Invoice storage invoice = invoices[invoiceId];
        _permitShortLivedOperator(invoice.token, msg.sender, deadline, v, r, s);
        _payInvoice(invoiceId, msg.sender);
    }

    
    function confirmInvoicePayment(
        bytes32 invoiceId,
        uint64 plaintext,
        bytes calldata signature
    ) external invoiceExists(invoiceId) {
        Invoice storage invoice = invoices[invoiceId];

        require(invoice.status == InvoiceStatus.Pending, "Invoice not pending");
        require(msg.sender == invoice.payer, "Only payer can confirm");
        require(pendingPaymentCt[invoiceId] != bytes32(0), "No pending payment");

        euint64 pendingAmount = FHE.wrapEuint64(pendingPaymentCt[invoiceId]);
        require(FHE.verifyDecryptResult(pendingAmount, plaintext, signature), "Invalid payment proof");
        require(plaintext == _asUint64(invoice.amount), "Payment amount mismatch");

        invoice.status = InvoiceStatus.Paid;
        invoice.paidAt = block.timestamp;

        bytes32 receiptId = _createReceipt(invoice, msg.sender);
        delete pendingPaymentCt[invoiceId];
        _notifyRfq(invoice.rfqId, receiptId);

        emit InvoicePaid(invoiceId, receiptId, msg.sender, invoice.amount, block.timestamp);
    }

    
    function payInvoiceNative(bytes32 invoiceId) external payable nonReentrant invoiceExists(invoiceId) {
        Invoice storage invoice = invoices[invoiceId];
        
        require(invoice.status == InvoiceStatus.Pending, "Invoice not pending");
        require(msg.sender == invoice.payer, "Only payer can pay");
        require(invoice.token == address(0), "Use payInvoice for FHERC20");
        require(msg.value == invoice.amount, "Incorrect payment amount");

        invoice.status = InvoiceStatus.Paid;
        invoice.paidAt = block.timestamp;

        bytes32 receiptId = _createReceipt(invoice, msg.sender);
        _notifyRfq(invoice.rfqId, receiptId);

        emit InvoicePaid(invoiceId, receiptId, msg.sender, invoice.amount, block.timestamp);
    }

    
    function cancelInvoice(bytes32 invoiceId, string calldata reason) external invoiceExists(invoiceId) {
        Invoice storage invoice = invoices[invoiceId];
        
        require(invoice.status == InvoiceStatus.Pending, "Invoice not pending");
        require(
            msg.sender == invoice.payer || msg.sender == invoice.payee,
            "Only payer or payee can cancel"
        );

        invoice.status = InvoiceStatus.Cancelled;

        emit InvoiceCancelled(invoiceId, msg.sender, reason);
    }

    
    function withdrawPayment(bytes32 invoiceId) external nonReentrant invoiceExists(invoiceId) {
        Invoice storage invoice = invoices[invoiceId];
        
        require(invoice.status == InvoiceStatus.Paid, "Invoice not paid");
        require(msg.sender == invoice.payee, "Only payee");
        require(invoice.token != address(0), "Use withdrawPaymentNative for native token");
        
        invoice.status = InvoiceStatus.Completed;
        _confidentialTransferExact(
            invoice.token,
            invoice.payee,
            invoice.amount,
            keccak256(abi.encodePacked("invoice-withdraw", invoiceId))
        );
        emit InvoiceCompleted(invoiceId, invoice.payee, invoice.amount);
    }

    
    function withdrawPaymentNative(bytes32 invoiceId) external nonReentrant invoiceExists(invoiceId) {
        Invoice storage invoice = invoices[invoiceId];
        
        require(invoice.status == InvoiceStatus.Paid, "Invoice not paid");
        require(msg.sender == invoice.payee, "Only payee");
        require(invoice.token == address(0), "Use withdrawPayment for FHERC20");
        
        invoice.status = InvoiceStatus.Completed;
        (bool success, ) = payable(invoice.payee).call{value: invoice.amount}("");
        require(success, "Transfer failed");
    }

    
    function refundInvoice(bytes32 invoiceId) external nonReentrant invoiceExists(invoiceId) {
        Invoice storage invoice = invoices[invoiceId];
        
        require(invoice.status == InvoiceStatus.Paid, "Invoice not paid");
        require(msg.sender == invoice.payee, "Only payee can refund");
        require(invoice.token != address(0), "Use refundInvoiceNative for native token");

        invoice.status = InvoiceStatus.Refunded;
        _confidentialTransferExact(
            invoice.token,
            invoice.payer,
            invoice.amount,
            keccak256(abi.encodePacked("invoice-refund", invoiceId))
        );

        emit PaymentRefunded(invoiceId, invoice.payee, invoice.payer, invoice.amount);
    }

    
    function refundInvoiceNative(bytes32 invoiceId) external nonReentrant invoiceExists(invoiceId) {
        Invoice storage invoice = invoices[invoiceId];
        
        require(invoice.status == InvoiceStatus.Paid, "Invoice not paid");
        require(msg.sender == invoice.payee, "Only payee can refund");
        require(invoice.token == address(0), "Use refundInvoice for FHERC20");

        (bool success, ) = payable(invoice.payer).call{value: invoice.amount}("");
        require(success, "Refund transfer failed");

        invoice.status = InvoiceStatus.Refunded;

        emit PaymentRefunded(invoiceId, invoice.payee, invoice.payer, invoice.amount);
    }

    
    function directPayment(
        bytes32 paymentId,
        address to,
        address token,
        uint256 amount
    ) external nonReentrant {
        _directPayment(paymentId, msg.sender, to, token, amount);
    }

    
    function directPaymentNative(
        bytes32 paymentId,
        address to
    ) external payable nonReentrant {
        require(paymentId != bytes32(0), "Invalid payment ID");
        require(to != address(0), "Invalid recipient");
        require(to != msg.sender, "Cannot pay self");
        require(msg.value > 0, "Amount must be positive");

        (bool success, ) = payable(to).call{value: msg.value}("");
        require(success, "Transfer failed");

        emit DirectPayment(paymentId, msg.sender, to, address(0), msg.value);
    }

    
    function confirmTransferVerification(
        bytes32 transferId,
        bool success,
        bytes calldata signature
    ) external {
        bytes32 transferCheckCt = pendingTransferCheckCt[transferId];
        require(transferCheckCt != bytes32(0), "No pending transfer verification");

        ebool transferOk = FHE.wrapEbool(transferCheckCt);
        require(FHE.verifyDecryptResult(transferOk, success, signature), "Invalid transfer proof");

        PendingDirectPayment memory pendingDirect = pendingDirectPayments[transferId];
        if (pendingDirect.from != address(0)) {
            delete pendingDirectPayments[transferId];
            if (success) {
                emit DirectPayment(
                    pendingDirect.paymentId,
                    pendingDirect.from,
                    pendingDirect.to,
                    pendingDirect.token,
                    pendingDirect.amount
                );
            }
        }

        delete pendingTransferCheckCt[transferId];
        emit TransferVerified(transferId, success);
    }

    
    function getInvoice(bytes32 invoiceId) external view returns (Invoice memory) {
        return invoices[invoiceId];
    }

    
    function getReceipt(bytes32 receiptId) external view returns (PaymentReceipt memory) {
        return receipts[receiptId];
    }

    
    function getReceiptForInvoice(bytes32 invoiceId) external view returns (PaymentReceipt memory) {
        bytes32 receiptId = invoiceToReceipt[invoiceId];
        require(receiptId != bytes32(0), "No receipt for invoice");
        return receipts[receiptId];
    }

    
    function getPayerInvoices(address payer) external view returns (bytes32[] memory) {
        return payerInvoices[payer];
    }

    
    function getPayeeInvoices(address payee) external view returns (bytes32[] memory) {
        return payeeInvoices[payee];
    }

    
    function getRfqInvoices(bytes32 rfqId) external view returns (bytes32[] memory) {
        return rfqInvoices[rfqId];
    }

    
    function getCounts() external view returns (uint256 _invoiceCount, uint256 _receiptCount) {
        return (invoiceCount, receiptCount);
    }

    
    function getPendingPayment(bytes32 invoiceId) external view returns (bytes32) {
        return pendingPaymentCt[invoiceId];
    }

    
    function getPendingTransferCheck(bytes32 transferId) external view returns (bytes32) {
        return pendingTransferCheckCt[transferId];
    }

    
    function onConfidentialTransferReceived(
        address operator,
        address from,
        euint64 amount,
        bytes calldata data
    ) external override nonReentrant returns (ebool) {
        if (operator != address(this) || data.length != 32) {
            return _rejectTransfer();
        }

        bytes32 invoiceId = abi.decode(data, (bytes32));
        Invoice storage invoice = invoices[invoiceId];

        if (invoice.payer == address(0)) {
            return _rejectTransfer();
        }
        if (invoice.status != InvoiceStatus.Pending) {
            return _rejectTransfer();
        }
        if (invoice.token == address(0) || msg.sender != invoice.token) {
            return _rejectTransfer();
        }
        if (invoice.payer != from) {
            return _rejectTransfer();
        }
        if (pendingPaymentCt[invoiceId] != bytes32(0)) {
            return _rejectTransfer();
        }

        pendingPaymentCt[invoiceId] = euint64.unwrap(amount);
        emit InvoicePaymentPending(invoiceId, euint64.unwrap(amount));

        FHE.allowThis(amount);
        FHE.allow(amount, from);
        ebool accepted = FHE.asEbool(true);
        return _allowCallbackResult(accepted);
    }

    receive() external payable {
        revert("Direct ETH not accepted");
    }
}
