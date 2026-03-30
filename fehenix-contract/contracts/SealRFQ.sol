// SPDX-License-Identifier: MIT

pragma solidity ^0.8.24;

import "@fhenixprotocol/cofhe-contracts/FHE.sol";
import "./interfaces/IFHERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface ISealAuction {
    function getAuctionResult(bytes32 auctionId) external view returns (
        address winner,
        uint64 finalPrice,
        bool finalized
    );
}

contract SealRFQ is ReentrancyGuard, IFHERC20Receiver {
    error OnlyAdmin();
    error PlatformPaused();
    error RfqNotFound();
    error OnlyCreator();
    error WinnerNotSelected();
    error EscrowNotFunded();
    error AlreadyPaid();
    error TokenNotConfigured();
    error OperatorAccessMissing();
    error NotWinner();
    error InvalidStatus();
    error TimeoutNotReached();
    error NotInBiddingPhase();
    error NotInRevealPhase();
    error PendingTransferVerification();
    error AlreadyResponded();
    error ModeMismatch();
    error PaymentAlreadyReleased();
    error InsufficientBalance();
    error PublishLowestBidFirst();
    error InvalidRequiredAmount();
    error StakeTooSmall();
    error NoStakeToSlash();
    error BidDoesNotExist();
    error UntrustedAuctionContract();
    error WrongTokenType();
    error CannotImportIfBidsExist();
    error LowestBidAlreadyPublished();
    error NoStakeToProcess();
    error OnlySealInvoice();
    error InvalidPercentage();
    error RfqAlreadyExists();
    error EnoughBidsReceived();
    error WinnerAlreadyAccepted();
    error ResponseWindowNotPassed();
    error NotEnoughBids();
    error BidBelowMinimum();
    error NoEscrowToReclaim();
    error AmountTooLarge();
    error AlreadyBidOnRfq();
    error InvalidRfqId();
    error WindowNotPassed();
    error AuctionNotFinalized();
    error WinnerCannotRefundStake();
    error BiddingDeadlineMustBeFuture();
    error InvalidMinBidCount();
    error BiddingNotEnded();
    error FinalPaymentReleased();
    error BidExceedsMaximum();
    error BidAlreadySelected();
    error NotBidOwner();
    error PlatformNotConfigured();
    error DeadlineGapTooSmall();
    error BiddingDeadlinePassed();
    error MustBeInBiddingPhase();
    error InvalidWinner();
    error AmountTooSmall();
    error DeadlinePassed();
    error DeadlineNotPassed();
    error InvalidMetadataHash();
    error InvalidAdmin();
    error InvalidBidId();
    error InvalidMinBid();
    error NoEscrowToClaim();
    error RevealNotEnded();
    error AlreadyFunded();
    error AmountMustMatchWinningBid();
    error FeeTooHigh();

    uint64 public constant MAX_BID_AMOUNT = 1_000_000_000;
    uint256 public constant MAX_FEE_BPS = 10000;
    uint256 public constant WINNER_RESPONSE_BLOCKS = 2160;
    uint256 public constant ESCROW_TIMEOUT_BLOCKS = 2880;
    uint256 public constant SLASH_WINDOW_BLOCKS = 1440;
    uint256 public constant MIN_DEADLINE_GAP = 720;
    uint256 public constant ANTI_SNIPING_BLOCKS = 40;
    uint256 public constant PERMISSIONLESS_CLOSE_DELAY = 100;

    enum RFQStatus {
        None,
        Bidding,
        Reveal,
        WinnerSelected,
        EscrowFunded,
        Completed,
        Cancelled,
        Rejected
    }

    enum TokenType {
        Token1,
        Token2
    }

    enum RFQMode {
        Standard,
        Vickrey,
        Dutch
    }

    enum TransferPurpose {
        BidStake,
        EscrowFunding
    }

    struct PlatformConfig {
        address admin;
        uint256 feeBps;
        bool paused;
        uint256 treasuryToken1;
        uint256 treasuryToken2;
    }

    struct RFQ {
        address creator;
        uint256 biddingDeadline;
        uint256 revealDeadline;
        uint64 minBid;
        uint64 minBidCount;
        uint64 flatStake;
        bytes32 metadataHash;
        TokenType escrowToken;
        RFQMode mode;
        RFQStatus status;
        uint64 bidCount;
        address winnerAddress;
        uint256 lifecycleBlock;
        bool winnerAccepted;
        bool paid;
        bool finalPaymentReleased;
    }

    struct Bid {
        address owner;
        euint64 encryptedAmount;
        uint64 stake;
        bool revealed;
        uint64 revealedAmount;
    }

    struct Escrow {
        uint64 originalAmount;
        uint64 currentAmount;
        uint64 totalReleased;
    }

    struct PendingBidTransfer {
        bytes32 rfqId;
        bytes32 bidId;
        address bidder;
        uint64 stake;
        bool antiSnipingEligible;
    }

    struct PendingEscrowFunding {
        bytes32 rfqId;
        TokenType tokenType;
        uint64 amount;
    }

    PlatformConfig public platformConfig;
    IFHERC20 public token1;
    IFHERC20 public token2;
    address public sealInvoiceAddress;
    euint64 private immutable _encryptedMaxBidAmount;

    mapping(bytes32 => RFQ) public rfqs;
    mapping(bytes32 => mapping(bytes32 => Bid)) public bids;
    mapping(bytes32 => mapping(bytes32 => ebool)) public bidRangeChecks;
    mapping(bytes32 => bytes32[]) private rfqBidIds;
    mapping(bytes32 => bytes32) public winnerBids;
    mapping(bytes32 => Escrow) public escrows;
    mapping(bytes32 => euint64) public lowestEncryptedBid;
    mapping(bytes32 => bytes32) public lowestBidId;
    mapping(bytes32 => uint64) public lowestPublishedBid;
    mapping(bytes32 => bool) public lowestBidPublished;
    mapping(bytes32 => mapping(address => bool)) public hasVendorBid;
    mapping(address => bool) public trustedAuctionContracts;
    mapping(bytes32 => bytes32) public auctionSource;
    mapping(bytes32 => uint64) public importedWinnerPrice;
    mapping(bytes32 => bytes32) public invoiceReceipts;
    mapping(bytes32 => bytes32) public pendingTransferCheckCt;
    mapping(bytes32 => PendingBidTransfer) private pendingBidTransfers;
    mapping(bytes32 => uint64) private pendingBidCount;
    mapping(bytes32 => PendingEscrowFunding) private pendingEscrowFundingTransfers;
    mapping(bytes32 => bytes32) private pendingEscrowTransferId;
    uint256 public transferVerificationNonce;

    event PlatformConfigured(address indexed admin, uint256 feeBps, bool paused);
    event RFQCreated(bytes32 indexed rfqId, address indexed creator, uint256 biddingDeadline, uint256 revealDeadline);
    event BidSubmitted(bytes32 indexed rfqId, bytes32 indexed bidId, address indexed vendor, uint64 stake);
    event BidDeadlineExtended(bytes32 indexed rfqId, uint256 newBiddingDeadline, uint256 newRevealDeadline);
    event LowestBidPublished(bytes32 indexed rfqId, uint64 amount);
    event WinnerSelected(bytes32 indexed rfqId, bytes32 indexed bidId, address indexed winner, uint64 amount);
    event WinnerResponded(bytes32 indexed rfqId, address indexed winner, bool accepted);
    event AuctionResultImported(bytes32 indexed rfqId, bytes32 indexed auctionId, address winner, uint64 price, uint8 auctionType);
    event EscrowFunded(bytes32 indexed rfqId, uint64 amount, TokenType tokenType);
    event PaymentReleased(bytes32 indexed rfqId, address indexed recipient, uint64 amount, uint8 percentage);
    event StakeRefunded(bytes32 indexed rfqId, bytes32 indexed bidId, address indexed vendor, uint64 amount);
    event StakeSlashed(bytes32 indexed rfqId, bytes32 indexed bidId, address indexed creator, uint64 amount);
    event RFQCancelled(bytes32 indexed rfqId, address indexed creator);
    event EscrowReclaimed(bytes32 indexed rfqId, address indexed claimer, uint64 amount);
    event InvoicePaymentRecorded(bytes32 indexed rfqId, bytes32 indexed receiptId);
    event TrustedAuctionSet(address indexed auction, bool trusted);
    event SealInvoiceAddressSet(address indexed newAddress);
    event EncryptedBidTrackerUpdated(bytes32 indexed rfqId, bytes32 newLowestCtHash);
    event OperatorAccessVerified(bytes32 indexed actionId, address indexed account, address indexed token);
    event TransferVerificationRequested(bytes32 indexed transferId, bytes32 indexed successCtHash);
    event TransferVerified(bytes32 indexed transferId, bool success);

    modifier onlyAdmin() {
        if (msg.sender != platformConfig.admin) revert OnlyAdmin();
        _;
    }

    modifier notPaused() {
        if (platformConfig.paused) revert PlatformPaused();
        _;
    }

    modifier rfqExists(bytes32 rfqId) {
        if (rfqs[rfqId].creator == address(0)) revert RfqNotFound();
        _;
    }

    constructor(address _admin, address _token1, address _token2) {
        if (_admin == address(0)) revert InvalidAdmin();
        platformConfig.admin = _admin;
        token1 = IFHERC20(_token1);
        token2 = IFHERC20(_token2);
        _encryptedMaxBidAmount = FHE.asEuint64(MAX_BID_AMOUNT);
        FHE.allowThis(_encryptedMaxBidAmount);
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

    function _confidentialToken(TokenType tokenType) internal view returns (IFHERC20) {
        if (tokenType == TokenType.Token1) {
            return token1;
        }
        if (tokenType == TokenType.Token2) {
            return token2;
        }
        revert("Invalid token type");
    }

    function _winningAmount(bytes32 rfqId) internal view returns (uint64) {
        bytes32 bidId = winnerBids[rfqId];
        Bid storage bid = bids[rfqId][bidId];

        if (auctionSource[rfqId] != bytes32(0)) {
            return importedWinnerPrice[rfqId];
        }

        return bid.revealedAmount;
    }

    function _confidentialTransferExact(
        IFHERC20 token,
        address to,
        uint64 amount,
        bytes32 transferScope
    ) internal {
        euint64 encryptedAmount = FHE.asEuint64(amount);
        FHE.allowTransient(encryptedAmount, address(token));

        euint64 transferred = token.confidentialTransfer(to, encryptedAmount);
        _queueTransferCheck(transferScope, transferred, encryptedAmount);
        FHE.allow(transferred, to);
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

    function _submitBid(
        bytes32 rfqId,
        bytes32 bidId,
        InEuint64 calldata encryptedBid,
        address bidder
    ) internal {
        RFQ storage rfq = rfqs[rfqId];

        if (rfq.status != RFQStatus.Bidding) revert NotInBiddingPhase();
        if (block.number >= rfq.biddingDeadline) revert BiddingDeadlinePassed();
        if (hasVendorBid[rfqId][bidder]) revert AlreadyBidOnRfq();
        if (bidId == bytes32(0)) revert InvalidBidId();
        require(bids[rfqId][bidId].owner == address(0), "Bid ID already used");

        IFHERC20 stakeToken = _confidentialToken(rfq.escrowToken);
        if (address(stakeToken) == address(0)) revert TokenNotConfigured();
        if (!stakeToken.isOperator(bidder, address(this))) revert OperatorAccessMissing();
        emit OperatorAccessVerified(bidId, bidder, address(stakeToken));

        euint64 bidAmount = FHE.asEuint64(encryptedBid);

        euint64 encryptedMinBid = FHE.asEuint64(rfq.minBid);
        ebool aboveMin = FHE.gte(bidAmount, encryptedMinBid);
        ebool belowMax = FHE.lte(bidAmount, _encryptedMaxBidAmount);
        ebool validRange = FHE.and(aboveMin, belowMax);

        euint64 encryptedStake = FHE.asEuint64(rfq.flatStake);
        FHE.allowTransient(encryptedStake, address(stakeToken));

        euint64 transferred = stakeToken.confidentialTransferFromAndCall(
            bidder,
            address(this),
            encryptedStake,
            abi.encode(uint8(TransferPurpose.BidStake), rfqId, bidId, rfq.flatStake)
        );
        bytes32 transferId = _queueTransferCheck(
            keccak256(abi.encodePacked("rfq-bid-stake", rfqId, bidId)),
            transferred,
            encryptedStake
        );
        FHE.allowSender(transferred);

        bidRangeChecks[rfqId][bidId] = validRange;
        FHE.allowThis(bidRangeChecks[rfqId][bidId]);
        bids[rfqId][bidId] = Bid({
            owner: bidder,
            encryptedAmount: bidAmount,
            stake: 0,
            revealed: false,
            revealedAmount: 0
        });
        FHE.allowThis(bids[rfqId][bidId].encryptedAmount);
        FHE.allow(bids[rfqId][bidId].encryptedAmount, bidder);
        hasVendorBid[rfqId][bidder] = true;
        pendingBidCount[rfqId]++;

        pendingBidTransfers[transferId] = PendingBidTransfer({
            rfqId: rfqId,
            bidId: bidId,
            bidder: bidder,
            stake: rfq.flatStake,
            antiSnipingEligible: (
                rfq.biddingDeadline > ANTI_SNIPING_BLOCKS &&
                block.number >= rfq.biddingDeadline - ANTI_SNIPING_BLOCKS
            )
        });
    }

    function _fundEscrowToken(
        bytes32 rfqId,
        TokenType tokenType,
        uint64 amount,
        address funder
    ) internal {
        RFQ storage rfq = rfqs[rfqId];

        if (funder != rfq.creator) revert OnlyCreator();
        if (rfq.status != RFQStatus.WinnerSelected) revert WinnerNotSelected();
        if (rfq.escrowToken != tokenType) revert WrongTokenType();
        require(rfq.winnerAccepted, "Winner hasn't accepted");
        if (escrows[rfqId].originalAmount != 0) revert AlreadyFunded();
        if (pendingEscrowTransferId[rfqId] != bytes32(0)) revert PendingTransferVerification();

        uint64 requiredAmount = _winningAmount(rfqId);
        if (requiredAmount == 0) revert InvalidRequiredAmount();
        if (amount != requiredAmount) revert AmountMustMatchWinningBid();

        IFHERC20 token = _confidentialToken(tokenType);
        if (address(token) == address(0)) revert TokenNotConfigured();
        if (!token.isOperator(funder, address(this))) revert OperatorAccessMissing();
        emit OperatorAccessVerified(rfqId, funder, address(token));

        euint64 encryptedAmount = FHE.asEuint64(amount);
        FHE.allowTransient(encryptedAmount, address(token));

        euint64 transferred = token.confidentialTransferFromAndCall(
            funder,
            address(this),
            encryptedAmount,
            abi.encode(uint8(TransferPurpose.EscrowFunding), rfqId, bytes32(0), amount)
        );
        bytes32 transferId = _queueTransferCheck(
            keccak256(abi.encodePacked("rfq-escrow-fund", rfqId)),
            transferred,
            encryptedAmount
        );
        FHE.allowSender(transferred);

        pendingEscrowFundingTransfers[transferId] = PendingEscrowFunding({
            rfqId: rfqId,
            tokenType: tokenType,
            amount: amount
        });
        pendingEscrowTransferId[rfqId] = transferId;
    }

    
    function configurePlatform(uint256 feeBps, bool paused) external onlyAdmin {
        if (feeBps >= MAX_FEE_BPS) revert FeeTooHigh();
        
        platformConfig.feeBps = feeBps;
        platformConfig.paused = paused;
        
        emit PlatformConfigured(msg.sender, feeBps, paused);
    }

    
    function setTrustedAuction(address auction, bool trusted) external onlyAdmin {
        require(auction != address(0), "Invalid address");
        trustedAuctionContracts[auction] = trusted;
        emit TrustedAuctionSet(auction, trusted);
    }

    
    function setSealInvoiceAddress(address _sealInvoiceAddress) external onlyAdmin {
        sealInvoiceAddress = _sealInvoiceAddress;
        emit SealInvoiceAddressSet(_sealInvoiceAddress);
    }

    
    function withdrawTokenFees(TokenType tokenType, uint256 amount) external onlyAdmin {
        require(amount > 0, "Invalid amount");
        if (amount > type(uint64).max) revert AmountTooLarge();
        
        if (tokenType == TokenType.Token1) {
            if (amount > platformConfig.treasuryToken1) revert InsufficientBalance();
            platformConfig.treasuryToken1 -= amount;
            _confidentialTransferExact(
                token1,
                msg.sender,
                uint64(amount),
                keccak256(abi.encodePacked("rfq-fee-withdraw", tokenType, amount))
            );
        } else if (tokenType == TokenType.Token2) {
            if (amount > platformConfig.treasuryToken2) revert InsufficientBalance();
            platformConfig.treasuryToken2 -= amount;
            _confidentialTransferExact(
                token2,
                msg.sender,
                uint64(amount),
                keccak256(abi.encodePacked("rfq-fee-withdraw", tokenType, amount))
            );
        } else {
            revert("Invalid token type");
        }
    }

    
    function recordInvoicePayment(bytes32 rfqId, bytes32 receiptId) external {
        if (msg.sender != sealInvoiceAddress) revert OnlySealInvoice();
        if (rfqs[rfqId].creator == address(0)) revert RfqNotFound();
        require(rfqs[rfqId].status == RFQStatus.EscrowFunded, "Invalid status");
        if (rfqs[rfqId].paid) revert AlreadyPaid();
        
        rfqs[rfqId].paid = true;
        invoiceReceipts[rfqId] = receiptId;
        
        emit InvoicePaymentRecorded(rfqId, receiptId);
    }

    
    function createRFQ(
        bytes32 rfqId,
        bytes32 salt,
        uint256 biddingDeadline,
        uint256 revealDeadline,
        uint64 minBid,
        uint64 minBidCount,
        bytes32 metadataHash,
        TokenType escrowToken,
        RFQMode mode
    ) external notPaused {
        if (rfqId == bytes32(0)) revert InvalidRfqId();
        if (rfqs[rfqId].creator != address(0)) revert RfqAlreadyExists();
        if (platformConfig.admin == address(0)) revert PlatformNotConfigured();
        
        require(rfqId == keccak256(abi.encodePacked(msg.sender, salt)), "Invalid RFQ ID hash");
        
        if (biddingDeadline <= block.number) revert BiddingDeadlineMustBeFuture();
        require(revealDeadline > biddingDeadline, "Reveal must be after bidding");
        if (revealDeadline - biddingDeadline < MIN_DEADLINE_GAP) revert DeadlineGapTooSmall();
        
        if (minBid == 0 || minBid >= MAX_BID_AMOUNT) revert InvalidMinBid();
        if (minBidCount == 0) revert InvalidMinBidCount();
        if (metadataHash == bytes32(0)) revert InvalidMetadataHash();
        if (address(_confidentialToken(escrowToken)) == address(0)) revert TokenNotConfigured();
        
        uint64 flatStake = (minBid * 10) / 100;
        if (flatStake == 0) revert StakeTooSmall();

        rfqs[rfqId] = RFQ({
            creator: msg.sender,
            biddingDeadline: biddingDeadline,
            revealDeadline: revealDeadline,
            minBid: minBid,
            minBidCount: minBidCount,
            flatStake: flatStake,
            metadataHash: metadataHash,
            escrowToken: escrowToken,
            mode: mode,
            status: RFQStatus.Bidding,
            bidCount: 0,
            winnerAddress: address(0),
            lifecycleBlock: 0,
            winnerAccepted: false,
            paid: false,
            finalPaymentReleased: false
        });

        lowestEncryptedBid[rfqId] = _encryptedMaxBidAmount;
        FHE.allowThis(lowestEncryptedBid[rfqId]);
        
        emit RFQCreated(rfqId, msg.sender, biddingDeadline, revealDeadline);
    }

    
    function submitBid(
        bytes32 rfqId,
        bytes32 bidId,
        InEuint64 calldata encryptedBid
    ) external rfqExists(rfqId) notPaused {
        _submitBid(rfqId, bidId, encryptedBid, msg.sender);
    }

    
    function permitAndSubmitBid(
        bytes32 rfqId,
        bytes32 bidId,
        InEuint64 calldata encryptedBid,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external rfqExists(rfqId) notPaused {
        IFHERC20 stakeToken = _confidentialToken(rfqs[rfqId].escrowToken);
        _permitShortLivedOperator(address(stakeToken), msg.sender, deadline, v, r, s);
        _submitBid(rfqId, bidId, encryptedBid, msg.sender);
    }

    
    function closeBidding(bytes32 rfqId) external rfqExists(rfqId) {
        RFQ storage rfq = rfqs[rfqId];
        
        if (rfq.status != RFQStatus.Bidding) revert NotInBiddingPhase();
        if (block.number < rfq.biddingDeadline) revert BiddingNotEnded();
        if (pendingBidCount[rfqId] != 0) revert PendingTransferVerification();
        if (rfq.bidCount < rfq.minBidCount) revert NotEnoughBids();
        
        if (msg.sender != rfq.creator) {
            require(
                block.number >= rfq.biddingDeadline + PERMISSIONLESS_CLOSE_DELAY,
                "Only creator can close before permissionless window"
            );
        }
        
        FHE.allowPublic(lowestEncryptedBid[rfqId]);
        
        rfq.status = RFQStatus.Reveal;
    }

    
    function publishLowestBid(
        bytes32 rfqId,
        uint64 plaintext,
        bytes calldata signature
    ) external rfqExists(rfqId) {
        RFQ storage rfq = rfqs[rfqId];

        if (rfq.status != RFQStatus.Reveal) revert NotInRevealPhase();
        if (lowestBidPublished[rfqId]) revert LowestBidAlreadyPublished();

        FHE.publishDecryptResult(lowestEncryptedBid[rfqId], plaintext, signature);

        lowestBidPublished[rfqId] = true;
        lowestPublishedBid[rfqId] = plaintext;

        emit LowestBidPublished(rfqId, plaintext);
    }

    
    function importAuctionResult(
        bytes32 rfqId,
        bytes32 auctionId,
        address auctionContract,
        uint8 auctionType
    ) external rfqExists(rfqId) {
        RFQ storage rfq = rfqs[rfqId];
        
        if (msg.sender != rfq.creator) revert OnlyCreator();
        if (pendingBidCount[rfqId] != 0) revert PendingTransferVerification();
        if (rfq.status != RFQStatus.Bidding) revert MustBeInBiddingPhase();
        if (rfq.bidCount != 0) revert CannotImportIfBidsExist();
        require(auctionSource[rfqId] == bytes32(0), "Already imported");
        if (!trustedAuctionContracts[auctionContract]) revert UntrustedAuctionContract();
        
        if (auctionType == 1) {
            if (rfq.mode != RFQMode.Vickrey) revert ModeMismatch();
        } else if (auctionType == 2) {
            if (rfq.mode != RFQMode.Dutch) revert ModeMismatch();
        } else {
            revert("Invalid auction type");
        }
        
        (address winner, uint64 price, bool finalized) = ISealAuction(auctionContract).getAuctionResult(auctionId);
        
        if (!finalized) revert AuctionNotFinalized();
        if (winner == address(0)) revert InvalidWinner();
        if (price < rfq.minBid) revert BidBelowMinimum();
        
        auctionSource[rfqId] = keccak256(abi.encodePacked(auctionContract, auctionId, winner, price));
        
        importedWinnerPrice[rfqId] = price;
        
        bytes32 syntheticBidId = keccak256(abi.encodePacked("imported", rfqId, auctionId));
        bids[rfqId][syntheticBidId] = Bid({
            owner: winner,
            encryptedAmount: FHE.asEuint64(price),
            stake: 0,
            revealed: true,
            revealedAmount: price
        });
        FHE.allowThis(bids[rfqId][syntheticBidId].encryptedAmount);
        FHE.allow(bids[rfqId][syntheticBidId].encryptedAmount, winner);
        winnerBids[rfqId] = syntheticBidId;
        hasVendorBid[rfqId][winner] = true;
        
        rfq.winnerAddress = winner;
        rfq.status = RFQStatus.WinnerSelected;
        rfq.lifecycleBlock = block.number;
        
        emit AuctionResultImported(rfqId, auctionId, winner, price, auctionType);
    }

    
    function winnerRespondImported(bytes32 rfqId, bool accept) external rfqExists(rfqId) {
        RFQ storage rfq = rfqs[rfqId];
        
        if (rfq.status != RFQStatus.WinnerSelected) revert WinnerNotSelected();
        if (msg.sender != rfq.winnerAddress) revert NotWinner();
        if (rfq.winnerAccepted) revert AlreadyResponded();
        require(auctionSource[rfqId] != bytes32(0), "Not an imported auction");
        
        if (accept) {
            rfq.winnerAccepted = true;
        } else {
            rfq.status = RFQStatus.Rejected;
        }
        
        emit WinnerResponded(rfqId, msg.sender, accept);
    }

    
    function selectWinner(
        bytes32 rfqId,
        bytes32 bidId,
        uint64 plaintext,
        bytes calldata signature
    ) external rfqExists(rfqId) {
        RFQ storage rfq = rfqs[rfqId];
        Bid storage bid = bids[rfqId][bidId];
        
        if (msg.sender != rfq.creator) revert OnlyCreator();
        if (rfq.status != RFQStatus.Reveal) revert NotInRevealPhase();
        if (block.number < rfq.revealDeadline) revert RevealNotEnded();
        if (!lowestBidPublished[rfqId]) revert PublishLowestBidFirst();
        if (bid.owner == address(0)) revert BidDoesNotExist();
        if (bid.revealed) revert BidAlreadySelected();
        
        FHE.publishDecryptResult(bid.encryptedAmount, plaintext, signature);
        require(plaintext == lowestPublishedBid[rfqId], "Bid does not match lowest published value");
        
        if (plaintext < rfq.minBid) revert BidBelowMinimum();
        if (plaintext >= MAX_BID_AMOUNT) revert BidExceedsMaximum();
        
        bid.revealed = true;
        bid.revealedAmount = plaintext;
        
        rfq.winnerAddress = bid.owner;
        rfq.status = RFQStatus.WinnerSelected;
        rfq.lifecycleBlock = block.number;
        winnerBids[rfqId] = bidId;
        lowestBidId[rfqId] = bidId;
        
        emit WinnerSelected(rfqId, bidId, bid.owner, plaintext);
    }

    
    function winnerRespond(bytes32 rfqId, bool accept) external nonReentrant rfqExists(rfqId) {
        RFQ storage rfq = rfqs[rfqId];
        bytes32 bidId = winnerBids[rfqId];
        Bid storage bid = bids[rfqId][bidId];
        
        if (rfq.status != RFQStatus.WinnerSelected) revert WinnerNotSelected();
        if (msg.sender != rfq.winnerAddress) revert NotWinner();
        if (rfq.winnerAccepted) revert AlreadyResponded();
        if (bid.stake == 0) revert NoStakeToProcess();

        IFHERC20 stakeToken = _confidentialToken(rfq.escrowToken);
        if (accept) {
            uint64 stakeAmount = bid.stake;
            bid.stake = 0;
            _confidentialTransferExact(
                stakeToken,
                msg.sender,
                stakeAmount,
                keccak256(abi.encodePacked("rfq-winner-accept", rfqId, bidId))
            );
            rfq.winnerAccepted = true;
        } else {
            uint64 stakeAmount = bid.stake;
            bid.stake = 0;
            _confidentialTransferExact(
                stakeToken,
                rfq.creator,
                stakeAmount,
                keccak256(abi.encodePacked("rfq-winner-reject", rfqId, bidId))
            );
            rfq.status = RFQStatus.Rejected;
        }
        
        emit WinnerResponded(rfqId, msg.sender, accept);
    }

    
    function fundEscrowToken(
        bytes32 rfqId,
        TokenType tokenType,
        uint64 amount
    ) external rfqExists(rfqId) {
        _fundEscrowToken(rfqId, tokenType, amount, msg.sender);
    }

    
    function permitAndFundEscrow(
        bytes32 rfqId,
        TokenType tokenType,
        uint64 amount,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external rfqExists(rfqId) {
        _permitShortLivedOperator(address(_confidentialToken(tokenType)), msg.sender, deadline, v, r, s);
        _fundEscrowToken(rfqId, tokenType, amount, msg.sender);
    }

    
    function releasePartialPayment(
        bytes32 rfqId,
        uint8 percentage
    ) external nonReentrant rfqExists(rfqId) {
        RFQ storage rfq = rfqs[rfqId];
        Escrow storage escrow = escrows[rfqId];
        
        if (msg.sender != rfq.creator) revert OnlyCreator();
        if (rfq.status != RFQStatus.EscrowFunded) revert EscrowNotFunded();
        if (rfq.finalPaymentReleased) revert FinalPaymentReleased();
        require(!rfq.paid, "Already paid via invoice");
        if (percentage == 0 || percentage > 100) revert InvalidPercentage();
        
        uint64 releaseAmount = uint64((uint256(escrow.currentAmount) * uint256(percentage)) / 100);
        if (releaseAmount == 0) revert AmountTooSmall();
        
        uint64 fee = uint64((uint256(releaseAmount) * platformConfig.feeBps) / 10000);
        uint64 netAmount = releaseAmount - fee;
        
        escrow.currentAmount -= releaseAmount;
        escrow.totalReleased += releaseAmount;
        
        IFHERC20 token = _confidentialToken(rfq.escrowToken);
        if (rfq.escrowToken == TokenType.Token1) {
            platformConfig.treasuryToken1 += fee;
        } else {
            platformConfig.treasuryToken2 += fee;
        }
        _confidentialTransferExact(
            token,
            rfq.winnerAddress,
            netAmount,
            keccak256(abi.encodePacked("rfq-release", rfqId, percentage, releaseAmount))
        );
        
        if (escrow.currentAmount == 0) {
            rfq.status = RFQStatus.Completed;
            rfq.finalPaymentReleased = true;
        }
        
        emit PaymentReleased(rfqId, rfq.winnerAddress, releaseAmount, percentage);
    }

    
    function refundStake(bytes32 rfqId, bytes32 bidId) external nonReentrant rfqExists(rfqId) {
        RFQ storage rfq = rfqs[rfqId];
        Bid storage bid = bids[rfqId][bidId];
        
        if (bid.owner != msg.sender) revert NotBidOwner();
        require(bid.stake > 0, "No stake to refund");
        
        if (rfq.status == RFQStatus.Cancelled) {
            uint64 cancelledRefundAmount = bid.stake;
            bid.stake = 0;
            _confidentialTransferExact(
                _confidentialToken(rfq.escrowToken),
                msg.sender,
                cancelledRefundAmount,
                keccak256(abi.encodePacked("rfq-refund-cancelled", rfqId, bidId))
            );
            emit StakeRefunded(rfqId, bidId, msg.sender, cancelledRefundAmount);
            return;
        }
        
        require(
            rfq.status == RFQStatus.WinnerSelected ||
            rfq.status == RFQStatus.EscrowFunded ||
            rfq.status == RFQStatus.Completed ||
            rfq.status == RFQStatus.Rejected,
            "Cannot refund in current status"
        );
        if (winnerBids[rfqId] == bidId) revert WinnerCannotRefundStake();
        require(
            block.number > rfq.revealDeadline + SLASH_WINDOW_BLOCKS,
            "Slash window still open"
        );
        
        uint64 amount = bid.stake;
        bid.stake = 0;
        _confidentialTransferExact(
            _confidentialToken(rfq.escrowToken),
            msg.sender,
            amount,
            keccak256(abi.encodePacked("rfq-refund", rfqId, bidId))
        );
        emit StakeRefunded(rfqId, bidId, msg.sender, amount);
    }

    
    function slashNonRevealer(bytes32 rfqId, bytes32 bidId) external nonReentrant rfqExists(rfqId) {
        RFQ storage rfq = rfqs[rfqId];
        Bid storage bid = bids[rfqId][bidId];
        
        if (msg.sender != rfq.creator) revert OnlyCreator();
        if (rfq.status != RFQStatus.WinnerSelected) revert WinnerNotSelected();
        require(winnerBids[rfqId] == bidId, "Only winning bid slashable");
        if (rfq.winnerAccepted) revert WinnerAlreadyAccepted();
        if (block.number <= rfq.lifecycleBlock + WINNER_RESPONSE_BLOCKS) revert ResponseWindowNotPassed();
        if (bid.stake == 0) revert NoStakeToSlash();
        
        uint64 amount = bid.stake;
        bid.stake = 0;
        rfq.status = RFQStatus.Rejected;
        _confidentialTransferExact(
            _confidentialToken(rfq.escrowToken),
            msg.sender,
            amount,
            keccak256(abi.encodePacked("rfq-slash", rfqId, bidId))
        );
        emit StakeSlashed(rfqId, bidId, msg.sender, amount);
    }

    
    function cancelRFQ(bytes32 rfqId, uint8 cancelType) external rfqExists(rfqId) {
        RFQ storage rfq = rfqs[rfqId];
        if (pendingBidCount[rfqId] != 0 || pendingEscrowTransferId[rfqId] != bytes32(0)) {
            revert PendingTransferVerification();
        }
        
        if (cancelType == 3) {
            if (msg.sender != rfq.creator) revert OnlyCreator();
            if (rfq.status != RFQStatus.Bidding) revert InvalidStatus();
            if (block.number >= rfq.biddingDeadline) revert DeadlinePassed();
        } else if (cancelType == 0) {
            if (msg.sender != rfq.creator) revert OnlyCreator();
            if (rfq.status != RFQStatus.Bidding) revert InvalidStatus();
            if (block.number < rfq.biddingDeadline) revert DeadlineNotPassed();
            if (rfq.bidCount >= rfq.minBidCount) revert EnoughBidsReceived();
        } else if (cancelType == 1) {
            if (msg.sender != rfq.creator) revert OnlyCreator();
            if (rfq.status != RFQStatus.Reveal) revert InvalidStatus();
            if (block.number <= rfq.revealDeadline + SLASH_WINDOW_BLOCKS) revert WindowNotPassed();
        } else if (cancelType == 2) {
            if (msg.sender != rfq.creator) revert OnlyCreator();
            if (rfq.status != RFQStatus.WinnerSelected && rfq.status != RFQStatus.Rejected) revert InvalidStatus();
            if (block.number <= rfq.lifecycleBlock + WINNER_RESPONSE_BLOCKS) revert TimeoutNotReached();
        } else if (cancelType == 4) {
            if (rfq.status != RFQStatus.Bidding) revert InvalidStatus();
            if (block.number < rfq.biddingDeadline) revert DeadlineNotPassed();
            require(rfq.bidCount >= rfq.minBidCount, "Not enough bids for liveness cancel");
            require(
                block.number >= rfq.biddingDeadline + PERMISSIONLESS_CLOSE_DELAY + SLASH_WINDOW_BLOCKS,
                "Liveness timeout not reached"
            );
        } else {
            revert("Invalid cancel type");
        }
        
        rfq.status = RFQStatus.Cancelled;
        
        emit RFQCancelled(rfqId, msg.sender);
    }

    
    function creatorReclaimEscrow(bytes32 rfqId) external nonReentrant rfqExists(rfqId) {
        RFQ storage rfq = rfqs[rfqId];
        Escrow storage escrow = escrows[rfqId];
        
        if (msg.sender != rfq.creator) revert OnlyCreator();
        if (rfq.status != RFQStatus.EscrowFunded) revert EscrowNotFunded();
        if (block.number <= rfq.lifecycleBlock + ESCROW_TIMEOUT_BLOCKS) revert TimeoutNotReached();
        if (rfq.finalPaymentReleased) revert PaymentAlreadyReleased();
        if (rfq.paid) revert AlreadyPaid();
        if (escrow.currentAmount == 0) revert NoEscrowToReclaim();
        
        uint64 amount = escrow.currentAmount;
        escrow.currentAmount = 0;
        rfq.finalPaymentReleased = true;
        rfq.status = RFQStatus.Cancelled;
        _confidentialTransferExact(
            _confidentialToken(rfq.escrowToken),
            msg.sender,
            amount,
            keccak256(abi.encodePacked("rfq-reclaim-creator", rfqId))
        );
        emit EscrowReclaimed(rfqId, msg.sender, amount);
    }

    
    function winnerClaimEscrow(bytes32 rfqId) external nonReentrant rfqExists(rfqId) {
        RFQ storage rfq = rfqs[rfqId];
        Escrow storage escrow = escrows[rfqId];
        
        if (msg.sender != rfq.winnerAddress) revert NotWinner();
        if (rfq.status != RFQStatus.EscrowFunded) revert EscrowNotFunded();
        if (block.number <= rfq.lifecycleBlock + ESCROW_TIMEOUT_BLOCKS) revert TimeoutNotReached();
        if (rfq.paid) revert AlreadyPaid();
        if (rfq.finalPaymentReleased) revert PaymentAlreadyReleased();
        if (escrow.currentAmount == 0) revert NoEscrowToClaim();
        
        uint64 amount = escrow.currentAmount;
        escrow.currentAmount = 0;
        escrow.totalReleased += amount;
        rfq.finalPaymentReleased = true;
        rfq.status = RFQStatus.Completed;
        _confidentialTransferExact(
            _confidentialToken(rfq.escrowToken),
            msg.sender,
            amount,
            keccak256(abi.encodePacked("rfq-reclaim-winner", rfqId))
        );
        emit EscrowReclaimed(rfqId, msg.sender, amount);
    }

    
    function getRFQ(bytes32 rfqId) external view returns (RFQ memory) {
        return rfqs[rfqId];
    }

    
    function getRfqStatus(bytes32 rfqId) external view returns (uint8) {
        return uint8(rfqs[rfqId].status);
    }

    
    function getBidInfo(bytes32 rfqId, bytes32 bidId) external view returns (
        address owner,
        uint64 stake,
        bool revealed,
        uint64 revealedAmount
    ) {
        Bid storage bid = bids[rfqId][bidId];
        return (bid.owner, bid.stake, bid.revealed, bid.revealedAmount);
    }

    
    function getBidIds(bytes32 rfqId) external view returns (bytes32[] memory) {
        return rfqBidIds[rfqId];
    }

    
    function getLowestBidReveal(bytes32 rfqId) external view returns (uint64 amount, bool published) {
        return (lowestPublishedBid[rfqId], lowestBidPublished[rfqId]);
    }

    function getPendingTransferCheck(bytes32 transferId) external view returns (bytes32) {
        return pendingTransferCheckCt[transferId];
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

        PendingBidTransfer memory pendingBid = pendingBidTransfers[transferId];
        if (pendingBid.bidder != address(0)) {
            delete pendingBidTransfers[transferId];
            pendingBidCount[pendingBid.rfqId]--;

            if (success) {
                RFQ storage rfq = rfqs[pendingBid.rfqId];
                Bid storage bid = bids[pendingBid.rfqId][pendingBid.bidId];

                bid.stake = pendingBid.stake;
                rfqBidIds[pendingBid.rfqId].push(pendingBid.bidId);
                rfq.bidCount++;

                if (pendingBid.antiSnipingEligible) {
                    rfq.biddingDeadline += ANTI_SNIPING_BLOCKS;
                    rfq.revealDeadline += ANTI_SNIPING_BLOCKS;
                    emit BidDeadlineExtended(pendingBid.rfqId, rfq.biddingDeadline, rfq.revealDeadline);
                }

                euint64 bidAmount = bid.encryptedAmount;
                ebool isLower = FHE.lt(bidAmount, lowestEncryptedBid[pendingBid.rfqId]);
                euint64 newLowest = FHE.select(isLower, bidAmount, lowestEncryptedBid[pendingBid.rfqId]);
                lowestEncryptedBid[pendingBid.rfqId] = newLowest;
                FHE.allowThis(lowestEncryptedBid[pendingBid.rfqId]);

                emit EncryptedBidTrackerUpdated(pendingBid.rfqId, euint64.unwrap(newLowest));
                emit BidSubmitted(pendingBid.rfqId, pendingBid.bidId, pendingBid.bidder, pendingBid.stake);
            } else {
                delete hasVendorBid[pendingBid.rfqId][pendingBid.bidder];
                delete bids[pendingBid.rfqId][pendingBid.bidId];
            }
        }

        PendingEscrowFunding memory pendingEscrow = pendingEscrowFundingTransfers[transferId];
        if (pendingEscrow.rfqId != bytes32(0)) {
            delete pendingEscrowFundingTransfers[transferId];
            delete pendingEscrowTransferId[pendingEscrow.rfqId];

            if (success) {
                escrows[pendingEscrow.rfqId] = Escrow({
                    originalAmount: pendingEscrow.amount,
                    currentAmount: pendingEscrow.amount,
                    totalReleased: 0
                });

                RFQ storage escrowRfq = rfqs[pendingEscrow.rfqId];
                escrowRfq.status = RFQStatus.EscrowFunded;
                escrowRfq.lifecycleBlock = block.number;
                emit EscrowFunded(pendingEscrow.rfqId, pendingEscrow.amount, pendingEscrow.tokenType);
            }
        }

        delete pendingTransferCheckCt[transferId];
        emit TransferVerified(transferId, success);
    }

    
    function onConfidentialTransferReceived(
        address operator,
        address from,
        euint64 amount,
        bytes calldata data
    ) external override nonReentrant returns (ebool) {
        if (operator != address(this) || data.length != 128) {
            return _rejectTransfer();
        }

        (uint8 rawPurpose, bytes32 rfqId, bytes32 bidId, uint64 expectedAmount) =
            abi.decode(data, (uint8, bytes32, bytes32, uint64));
        if (rawPurpose > uint8(TransferPurpose.EscrowFunding)) {
            return _rejectTransfer();
        }
        RFQ storage rfq = rfqs[rfqId];
        if (rfq.creator == address(0)) {
            return _rejectTransfer();
        }

        IFHERC20 token = _confidentialToken(rfq.escrowToken);
        if (msg.sender != address(token)) {
            return _rejectTransfer();
        }

        euint64 expected = FHE.asEuint64(expectedAmount);

        if (rawPurpose == uint8(TransferPurpose.BidStake)) {
            if (rfq.status != RFQStatus.Bidding || block.number >= rfq.biddingDeadline) {
                return _rejectTransfer();
            }
            if (bidId == bytes32(0) || bids[rfqId][bidId].owner != address(0) || hasVendorBid[rfqId][from]) {
                return _rejectTransfer();
            }
            if (expectedAmount != rfq.flatStake) {
                return _rejectTransfer();
            }
            ebool stakeMatches = FHE.eq(amount, expected);
            FHE.allow(amount, from);
            return _allowCallbackResult(stakeMatches);
        }

        if (rfq.creator != from) {
            return _rejectTransfer();
        }
        if (rfq.status != RFQStatus.WinnerSelected || !rfq.winnerAccepted) {
            return _rejectTransfer();
        }
        if (escrows[rfqId].originalAmount != 0) {
            return _rejectTransfer();
        }
        if (expectedAmount != _winningAmount(rfqId)) {
            return _rejectTransfer();
        }
        ebool escrowMatches = FHE.eq(amount, expected);
        FHE.allow(amount, from);
        return _allowCallbackResult(escrowMatches);
    }

    
    function getEscrow(bytes32 rfqId) external view returns (Escrow memory) {
        return escrows[rfqId];
    }

    
    function hasBid(bytes32 rfqId, address vendor) external view returns (bool) {
        return hasVendorBid[rfqId][vendor];
    }
}
