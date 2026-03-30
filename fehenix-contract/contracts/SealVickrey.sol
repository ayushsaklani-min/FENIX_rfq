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

contract SealVickrey is ReentrancyGuard, ISealAuction, IFHERC20Receiver {
    uint64 public constant MAX_BID_AMOUNT = type(uint64).max - 1;
    uint256 public constant MIN_REVEAL_GAP = 10;
    uint256 public constant SLASH_WINDOW_BLOCKS = 1440;
    uint256 public constant MAX_DEADLINE_FUTURE = 100000;
    uint256 public constant PERMISSIONLESS_CLOSE_DELAY = 100;

    enum AuctionStatus {
        None,
        Open,
        Reveal,
        Finalized,
        Cancelled
    }

    struct Auction {
        address creator;
        bytes32 rfqId;
        uint256 biddingDeadline;
        uint256 revealDeadline;
        uint64 flatStake;
        uint64 minBidCount;
        AuctionStatus status;
        uint64 bidCount;
        uint64 revealedCount;
        address finalWinner;
        uint64 finalPrice;
        bool finalized;
    }

    struct Bid {
        address owner;
        euint64 encryptedAmount;
        uint64 stake;
        bool revealed;
        uint64 revealedAmount;
    }

    struct PendingBidTransfer {
        bytes32 auctionId;
        bytes32 bidId;
        address bidder;
        uint64 stake;
    }

    IFHERC20 public immutable stakeToken;
    euint64 private immutable _encryptedMaxBidAmount;

    mapping(bytes32 => Auction) public auctions;
    mapping(bytes32 => mapping(bytes32 => Bid)) public bids;
    mapping(bytes32 => mapping(address => bool)) public hasVendorBid;
    mapping(bytes32 => mapping(bytes32 => ebool)) public bidRangeChecks;
    mapping(bytes32 => euint64) public encryptedLowestBid;
    mapping(bytes32 => euint64) public encryptedSecondLowestBid;
    mapping(bytes32 => eaddress) public encryptedLowestBidder;
    mapping(bytes32 => bytes32) public lowestBidId;
    mapping(bytes32 => bytes32) public pendingTransferCheckCt;
    mapping(bytes32 => PendingBidTransfer) public pendingBidTransfers;
    mapping(bytes32 => uint64) public pendingBidCount;
    uint256 public transferVerificationNonce;

    event AuctionCreated(
        bytes32 indexed auctionId,
        address indexed creator,
        bytes32 rfqId,
        uint256 biddingDeadline,
        uint256 revealDeadline,
        uint64 flatStake,
        uint64 minBidCount
    );
    event BidCommitted(bytes32 indexed auctionId, bytes32 indexed bidId, address indexed vendor, uint64 stake);
    event BidRevealed(bytes32 indexed auctionId, bytes32 indexed bidId, address indexed vendor, uint64 amount);
    event AuctionFinalized(bytes32 indexed auctionId, address indexed winner, uint64 winningBid, uint64 secondPrice);
    event AuctionCancelled(bytes32 indexed auctionId, address indexed creator);
    event StakeRefunded(bytes32 indexed auctionId, bytes32 indexed bidId, address indexed vendor, uint64 amount);
    event StakeSlashed(bytes32 indexed auctionId, bytes32 indexed bidId, address indexed creator, uint64 amount);
    event EncryptedBidTrackerUpdated(bytes32 indexed auctionId, bytes32 newLowestCtHash);
    event OperatorAccessVerified(bytes32 indexed actionId, address indexed account, address indexed token);
    event TransferVerificationRequested(bytes32 indexed transferId, bytes32 indexed successCtHash);
    event TransferVerified(bytes32 indexed transferId, bool success);

    modifier auctionExists(bytes32 auctionId) {
        require(auctions[auctionId].creator != address(0), "Auction does not exist");
        _;
    }

    constructor(address _stakeToken) {
        require(_stakeToken != address(0), "Invalid stake token");
        stakeToken = IFHERC20(_stakeToken);
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

    function _transferStake(address to, uint64 amount, bytes32 transferScope) internal {
        euint64 encryptedAmount = FHE.asEuint64(amount);
        FHE.allowTransient(encryptedAmount, address(stakeToken));

        euint64 transferred = stakeToken.confidentialTransfer(to, encryptedAmount);
        _queueTransferCheck(transferScope, transferred, encryptedAmount);
        FHE.allow(transferred, to);
    }

    function _permitShortLivedOperator(
        address owner,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) internal {
        IFHERC20Permit(address(stakeToken)).permit(
            owner,
            address(this),
            uint48(block.timestamp + 10 minutes),
            deadline,
            v,
            r,
            s
        );
    }

    function _commitBid(
        bytes32 auctionId,
        bytes32 bidId,
        InEuint64 calldata encryptedBid,
        address bidder
    ) internal {
        Auction storage auction = auctions[auctionId];

        require(auction.status == AuctionStatus.Open, "Not accepting bids");
        require(block.number < auction.biddingDeadline, "Bidding deadline passed");
        require(!hasVendorBid[auctionId][bidder], "Already bid on this auction");
        require(bidId != bytes32(0), "Invalid bid ID");
        require(bids[auctionId][bidId].owner == address(0), "Bid ID already used");
        require(stakeToken.isOperator(bidder, address(this)), "Grant short-lived operator first");
        emit OperatorAccessVerified(bidId, bidder, address(stakeToken));

        euint64 bidAmount = FHE.asEuint64(encryptedBid);

        ebool validRange = FHE.lt(bidAmount, _encryptedMaxBidAmount);

        euint64 encryptedStake = FHE.asEuint64(auction.flatStake);
        FHE.allowTransient(encryptedStake, address(stakeToken));

        euint64 transferred = stakeToken.confidentialTransferFromAndCall(
            bidder,
            address(this),
            encryptedStake,
            abi.encode(auctionId, bidId)
        );
        bytes32 transferId = _queueTransferCheck(
            keccak256(abi.encodePacked("vickrey-commit", auctionId, bidId)),
            transferred,
            encryptedStake
        );
        FHE.allowSender(transferred);

        bidRangeChecks[auctionId][bidId] = validRange;
        FHE.allowThis(bidRangeChecks[auctionId][bidId]);
        bids[auctionId][bidId] = Bid({
            owner: bidder,
            encryptedAmount: bidAmount,
            stake: 0,
            revealed: false,
            revealedAmount: 0
        });
        FHE.allowThis(bids[auctionId][bidId].encryptedAmount);
        FHE.allow(bids[auctionId][bidId].encryptedAmount, bidder);
        hasVendorBid[auctionId][bidder] = true;
        pendingBidCount[auctionId]++;

        pendingBidTransfers[transferId] = PendingBidTransfer({
            auctionId: auctionId,
            bidId: bidId,
            bidder: bidder,
            stake: auction.flatStake
        });
    }

    function createAuction(
        bytes32 auctionId,
        bytes32 salt,
        bytes32 rfqId,
        uint256 biddingDeadline,
        uint256 revealDeadline,
        uint64 flatStake,
        uint64 minBidCount
    ) external {
        require(auctionId != bytes32(0), "Invalid auction ID");
        require(salt != bytes32(0), "Invalid salt");
        require(auctions[auctionId].creator == address(0), "Auction already exists");
        require(auctionId == keccak256(abi.encodePacked(msg.sender, salt)), "Invalid auction ID hash");
        require(biddingDeadline > block.number, "Bidding deadline must be future");
        require(biddingDeadline <= block.number + MAX_DEADLINE_FUTURE, "Bidding deadline too far");
        require(revealDeadline > biddingDeadline, "Reveal must be after bidding");
        require(revealDeadline <= block.number + MAX_DEADLINE_FUTURE, "Reveal deadline too far");
        require(revealDeadline - biddingDeadline >= MIN_REVEAL_GAP, "Deadline gap too small");
        require(flatStake > 0 && flatStake < MAX_BID_AMOUNT, "Invalid stake");
        require(minBidCount > 0, "Min bid count must be positive");

        auctions[auctionId] = Auction({
            creator: msg.sender,
            rfqId: rfqId,
            biddingDeadline: biddingDeadline,
            revealDeadline: revealDeadline,
            flatStake: flatStake,
            minBidCount: minBidCount,
            status: AuctionStatus.Open,
            bidCount: 0,
            revealedCount: 0,
            finalWinner: address(0),
            finalPrice: 0,
            finalized: false
        });

        encryptedLowestBid[auctionId] = _encryptedMaxBidAmount;
        encryptedSecondLowestBid[auctionId] = _encryptedMaxBidAmount;
        encryptedLowestBidder[auctionId] = FHE.asEaddress(address(0));

        FHE.allowThis(encryptedLowestBid[auctionId]);
        FHE.allowThis(encryptedSecondLowestBid[auctionId]);
        FHE.allowThis(encryptedLowestBidder[auctionId]);

        emit AuctionCreated(auctionId, msg.sender, rfqId, biddingDeadline, revealDeadline, flatStake, minBidCount);
    }

    
    function commitBid(
        bytes32 auctionId,
        bytes32 bidId,
        InEuint64 calldata encryptedBid
    ) external auctionExists(auctionId) {
        _commitBid(auctionId, bidId, encryptedBid, msg.sender);
    }

    
    function permitAndCommitBid(
        bytes32 auctionId,
        bytes32 bidId,
        InEuint64 calldata encryptedBid,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external auctionExists(auctionId) {
        _permitShortLivedOperator(msg.sender, deadline, v, r, s);
        _commitBid(auctionId, bidId, encryptedBid, msg.sender);
    }

    function closeBidding(bytes32 auctionId) external auctionExists(auctionId) {
        Auction storage auction = auctions[auctionId];

        require(auction.status == AuctionStatus.Open, "Not in bidding phase");
        require(block.number >= auction.biddingDeadline, "Bidding not ended");
        require(pendingBidCount[auctionId] == 0, "Pending bid verification");
        require(auction.bidCount >= auction.minBidCount, "Not enough bids");

        if (msg.sender != auction.creator) {
            require(
                block.number >= auction.biddingDeadline + PERMISSIONLESS_CLOSE_DELAY,
                "Only creator can close before permissionless window"
            );
        }

        auction.status = AuctionStatus.Reveal;
        FHE.allowPublic(encryptedLowestBid[auctionId]);
        FHE.allowPublic(encryptedSecondLowestBid[auctionId]);
        FHE.allowPublic(encryptedLowestBidder[auctionId]);
    }

    function revealBid(
        bytes32 auctionId,
        bytes32 bidId,
        uint64 plaintext,
        bytes calldata signature
    ) external nonReentrant auctionExists(auctionId) {
        Auction storage auction = auctions[auctionId];
        Bid storage bid = bids[auctionId][bidId];

        require(auction.status == AuctionStatus.Reveal, "Not in reveal phase");
        require(block.number < auction.revealDeadline, "Reveal deadline passed");
        require(bid.owner == msg.sender, "Not bid owner");
        require(!bid.revealed, "Already revealed");

        FHE.publishDecryptResult(bid.encryptedAmount, plaintext, signature);

        bid.revealed = true;
        bid.revealedAmount = plaintext;
        auction.revealedCount++;

        emit BidRevealed(auctionId, bidId, msg.sender, plaintext);
    }

    function finalizeAuction(
        bytes32 auctionId,
        uint64 lowestBidPlaintext,
        bytes calldata lowestBidSignature,
        uint64 secondBidPlaintext,
        bytes calldata secondBidSignature,
        address winnerPlaintext,
        bytes calldata winnerSignature
    ) external auctionExists(auctionId) {
        Auction storage auction = auctions[auctionId];

        require(msg.sender == auction.creator, "Only creator");
        require(auction.status == AuctionStatus.Reveal, "Must be in reveal phase");
        require(!auction.finalized, "Already finalized");
        require(block.number >= auction.revealDeadline, "Reveal deadline not reached");
        require(auction.bidCount > 0, "No bids received");

        FHE.publishDecryptResult(encryptedLowestBid[auctionId], lowestBidPlaintext, lowestBidSignature);
        FHE.publishDecryptResult(encryptedSecondLowestBid[auctionId], secondBidPlaintext, secondBidSignature);
        FHE.publishDecryptResult(encryptedLowestBidder[auctionId], winnerPlaintext, winnerSignature);

        if (auction.bidCount >= 2) {
            require(secondBidPlaintext >= lowestBidPlaintext, "Second price cannot be less than lowest");
        }

        require(hasVendorBid[auctionId][winnerPlaintext], "Winner not a known bidder");

        uint64 finalPrice = auction.bidCount >= 2 ? secondBidPlaintext : lowestBidPlaintext;
        require(winnerPlaintext != address(0), "Invalid winner");
        require(lowestBidPlaintext > 0, "Invalid lowest bid");

        auction.finalWinner = winnerPlaintext;
        auction.finalPrice = finalPrice;
        auction.status = AuctionStatus.Finalized;
        auction.finalized = true;

        emit AuctionFinalized(auctionId, winnerPlaintext, lowestBidPlaintext, finalPrice);
    }

    function cancelAuction(bytes32 auctionId) external auctionExists(auctionId) {
        Auction storage auction = auctions[auctionId];

        require(msg.sender == auction.creator, "Only creator");
        require(pendingBidCount[auctionId] == 0, "Pending bid verification");
        require(auction.status == AuctionStatus.Open || auction.status == AuctionStatus.Reveal, "Cannot cancel");

        auction.status = AuctionStatus.Cancelled;
        emit AuctionCancelled(auctionId, msg.sender);
    }

    function refundStake(bytes32 auctionId, bytes32 bidId) external nonReentrant auctionExists(auctionId) {
        Auction storage auction = auctions[auctionId];
        Bid storage bid = bids[auctionId][bidId];

        require(bid.owner == msg.sender, "Not bid owner");
        require(bid.stake > 0, "No stake to refund");
        require(
            auction.status == AuctionStatus.Cancelled || auction.status == AuctionStatus.Finalized,
            "Cannot refund yet"
        );

        if (auction.status == AuctionStatus.Finalized) {
            require(bid.revealed, "Must reveal to get refund");
        }

        uint64 amount = bid.stake;
        bid.stake = 0;
        _transferStake(msg.sender, amount, keccak256(abi.encodePacked("vickrey-refund", auctionId, bidId)));

        emit StakeRefunded(auctionId, bidId, msg.sender, amount);
    }

    function slashUnrevealed(bytes32 auctionId, bytes32 bidId) external nonReentrant auctionExists(auctionId) {
        Auction storage auction = auctions[auctionId];
        Bid storage bid = bids[auctionId][bidId];

        require(msg.sender == auction.creator, "Only creator");
        require(
            auction.status == AuctionStatus.Reveal || auction.status == AuctionStatus.Finalized,
            "Invalid status"
        );
        require(block.number > auction.revealDeadline, "Reveal not ended");
        require(block.number <= auction.revealDeadline + SLASH_WINDOW_BLOCKS, "Slash window passed");
        require(bid.stake > 0, "No stake to slash");
        require(!bid.revealed, "Already revealed");

        uint64 amount = bid.stake;
        bid.stake = 0;
        _transferStake(msg.sender, amount, keccak256(abi.encodePacked("vickrey-slash", auctionId, bidId)));

        emit StakeSlashed(auctionId, bidId, msg.sender, amount);
    }

    function getAuctionResult(bytes32 auctionId) external view override returns (
        address winner,
        uint64 finalPrice,
        bool finalized
    ) {
        Auction storage auction = auctions[auctionId];
        return (auction.finalWinner, auction.finalPrice, auction.finalized);
    }

    function getAuction(bytes32 auctionId) external view returns (Auction memory) {
        return auctions[auctionId];
    }

    function getBidInfo(bytes32 auctionId, bytes32 bidId) external view returns (
        address owner,
        uint64 stake,
        bool revealed,
        uint64 revealedAmount
    ) {
        Bid storage bid = bids[auctionId][bidId];
        return (bid.owner, bid.stake, bid.revealed, bid.revealedAmount);
    }

    function hasBid(bytes32 auctionId, address vendor) external view returns (bool) {
        return hasVendorBid[auctionId][vendor];
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

        PendingBidTransfer memory pending = pendingBidTransfers[transferId];
        if (pending.bidder != address(0)) {
            delete pendingBidTransfers[transferId];
            pendingBidCount[pending.auctionId]--;

            if (success) {
                Auction storage auction = auctions[pending.auctionId];
                Bid storage bid = bids[pending.auctionId][pending.bidId];

                bid.stake = pending.stake;
                auction.bidCount++;

                euint64 bidAmount = bid.encryptedAmount;
                euint64 currentLowest = encryptedLowestBid[pending.auctionId];
                euint64 currentSecond = encryptedSecondLowestBid[pending.auctionId];
                eaddress currentLowestBidder = encryptedLowestBidder[pending.auctionId];

                ebool isLowerThanLowest = FHE.lt(bidAmount, currentLowest);
                ebool isLowerThanSecond = FHE.lt(bidAmount, currentSecond);

                euint64 newLowest = FHE.select(isLowerThanLowest, bidAmount, currentLowest);
                euint64 oldLowestAsSecond = FHE.select(isLowerThanLowest, currentLowest, currentSecond);
                euint64 candidateSecond = FHE.select(isLowerThanSecond, bidAmount, currentSecond);
                euint64 newSecond = FHE.select(isLowerThanLowest, oldLowestAsSecond, candidateSecond);

                eaddress newBidderEncrypted = FHE.asEaddress(pending.bidder);
                eaddress newLowestBidder = FHE.select(isLowerThanLowest, newBidderEncrypted, currentLowestBidder);

                encryptedLowestBid[pending.auctionId] = newLowest;
                encryptedSecondLowestBid[pending.auctionId] = newSecond;
                encryptedLowestBidder[pending.auctionId] = newLowestBidder;
                FHE.allowThis(encryptedLowestBid[pending.auctionId]);
                FHE.allowThis(encryptedSecondLowestBid[pending.auctionId]);
                FHE.allowThis(encryptedLowestBidder[pending.auctionId]);

                emit EncryptedBidTrackerUpdated(pending.auctionId, euint64.unwrap(newLowest));
                emit BidCommitted(pending.auctionId, pending.bidId, pending.bidder, pending.stake);
            } else {
                delete hasVendorBid[pending.auctionId][pending.bidder];
                delete bids[pending.auctionId][pending.bidId];
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
        if (msg.sender != address(stakeToken) || operator != address(this) || data.length != 64) {
            return _rejectTransfer();
        }

        (bytes32 auctionId, bytes32 bidId) = abi.decode(data, (bytes32, bytes32));
        Auction storage auction = auctions[auctionId];

        if (auction.creator == address(0)) {
            return _rejectTransfer();
        }
        if (auction.status != AuctionStatus.Open || block.number >= auction.biddingDeadline) {
            return _rejectTransfer();
        }
        if (bidId == bytes32(0) || bids[auctionId][bidId].owner != address(0) || hasVendorBid[auctionId][from]) {
            return _rejectTransfer();
        }

        euint64 requiredStake = FHE.asEuint64(auction.flatStake);
        ebool stakeMatches = FHE.eq(amount, requiredStake);
        FHE.allow(amount, from);
        return _allowCallbackResult(stakeMatches);
    }
}
