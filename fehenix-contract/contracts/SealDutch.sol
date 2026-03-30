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

contract SealDutch is ReentrancyGuard, ISealAuction, IFHERC20Receiver {
    uint64 public constant DEFAULT_STAKE = 10000;
    uint256 public constant CONFIRM_WINDOW_BLOCKS = 10;
    uint256 public constant MAX_DEADLINE_FUTURE = 100000;

    enum AuctionStatus {
        None,
        Active,
        Committed,
        Confirmed,
        Expired,
        Cancelled
    }

    enum PendingAcceptanceAction {
        None,
        CommitAcceptance,
        AcceptPrice
    }

    struct Auction {
        address creator;
        bytes32 rfqId;
        uint64 startPrice;
        uint64 reservePrice;
        uint64 priceDecrement;
        uint256 startBlock;
        uint256 endBlock;
        AuctionStatus status;
        address committor;
        uint256 commitBlock;
        uint64 commitPrice;
        address winner;
        uint64 finalPrice;
    }

    struct Acceptance {
        address bidder;
        uint64 stake;
        uint256 commitBlock;
        uint64 committedPrice;
        bool confirmed;
        bool slashed;
    }

    struct PendingAcceptanceTransfer {
        PendingAcceptanceAction action;
        bytes32 auctionId;
        bytes32 acceptanceId;
        address bidder;
        uint256 commitBlock;
        uint64 committedPrice;
    }

    IFHERC20 public immutable stakeToken;
    euint64 private immutable _encryptedDefaultStake;

    mapping(bytes32 => Auction) public auctions;
    mapping(bytes32 => mapping(bytes32 => Acceptance)) public acceptances;
    mapping(bytes32 => mapping(address => bool)) public hasAccepted;
    mapping(bytes32 => bytes32) public pendingTransferCheckCt;
    mapping(bytes32 => PendingAcceptanceTransfer) public pendingAcceptanceTransfers;
    mapping(bytes32 => bytes32) public pendingAuctionTransferId;
    uint256 public transferVerificationNonce;

    event AuctionCreated(
        bytes32 indexed auctionId,
        address indexed creator,
        bytes32 rfqId,
        uint64 startPrice,
        uint64 reservePrice,
        uint64 priceDecrement,
        uint256 startBlock,
        uint256 endBlock
    );
    event AcceptanceCommitted(
        bytes32 indexed auctionId,
        bytes32 indexed acceptanceId,
        address indexed bidder,
        uint64 currentPrice
    );
    event AcceptanceConfirmed(
        bytes32 indexed auctionId,
        bytes32 indexed acceptanceId,
        address indexed winner,
        uint64 finalPrice
    );
    event AcceptanceFailed(
        bytes32 indexed auctionId,
        bytes32 indexed acceptanceId,
        address indexed bidder,
        string reason
    );
    event AuctionEnded(
        bytes32 indexed auctionId,
        address indexed winner,
        uint64 finalPrice
    );
    event AuctionCancelled(bytes32 indexed auctionId, address indexed creator);
    event AuctionExpired(bytes32 indexed auctionId);
    event StakeRefunded(bytes32 indexed auctionId, bytes32 indexed acceptanceId, address indexed bidder, uint64 amount);
    event StakeSlashed(bytes32 indexed auctionId, bytes32 indexed acceptanceId, address indexed creator, uint64 amount);
    event DirectAcceptance(bytes32 indexed auctionId, address indexed winner, uint64 finalPrice);
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
        _encryptedDefaultStake = FHE.asEuint64(DEFAULT_STAKE);
        FHE.allowThis(_encryptedDefaultStake);
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

    function _initiateAcceptance(
        bytes32 auctionId,
        bytes32 acceptanceId,
        address bidder,
        PendingAcceptanceAction action
    ) internal {
        Auction storage auction = auctions[auctionId];

        require(auction.status == AuctionStatus.Active, "Auction not active");
        require(block.number >= auction.startBlock, "Auction not started");
        require(block.number < auction.endBlock, "Auction ended");
        require(!hasAccepted[auctionId][bidder], "Already accepted");
        require(acceptanceId != bytes32(0), "Invalid acceptance ID");
        require(acceptances[auctionId][acceptanceId].bidder == address(0), "Acceptance ID used");
        require(pendingAuctionTransferId[auctionId] == bytes32(0), "Pending transfer verification");
        require(stakeToken.isOperator(bidder, address(this)), "Grant short-lived operator first");
        emit OperatorAccessVerified(acceptanceId, bidder, address(stakeToken));

        uint64 currentPrice = getCurrentPrice(auctionId);
        euint64 encryptedStake = _encryptedDefaultStake;
        FHE.allowTransient(encryptedStake, address(stakeToken));

        euint64 transferred = stakeToken.confidentialTransferFromAndCall(
            bidder,
            address(this),
            encryptedStake,
            abi.encode(auctionId, acceptanceId)
        );
        bytes32 transferId = _queueTransferCheck(
            keccak256(abi.encodePacked("dutch-accept", uint8(action), auctionId, acceptanceId)),
            transferred,
            encryptedStake
        );
        FHE.allowSender(transferred);

        pendingAcceptanceTransfers[transferId] = PendingAcceptanceTransfer({
            action: action,
            auctionId: auctionId,
            acceptanceId: acceptanceId,
            bidder: bidder,
            commitBlock: block.number,
            committedPrice: currentPrice
        });
        pendingAuctionTransferId[auctionId] = transferId;
    }

    function createAuction(
        bytes32 auctionId,
        bytes32 salt,
        bytes32 rfqId,
        uint64 startPrice,
        uint64 reservePrice,
        uint64 priceDecrement,
        uint256 startBlock,
        uint256 endBlock
    ) external {
        require(auctionId != bytes32(0), "Invalid auction ID");
        require(salt != bytes32(0), "Invalid salt");
        require(auctions[auctionId].creator == address(0), "Auction already exists");
        require(auctionId == keccak256(abi.encodePacked(msg.sender, salt)), "Invalid auction ID hash");
        require(startPrice > reservePrice, "Start must exceed reserve");
        require(reservePrice > 0, "Reserve must be positive");
        require(priceDecrement > 0, "Decrement must be positive");
        require(startBlock >= block.number, "Start must be current or future");
        require(endBlock > startBlock, "End must be after start");
        require(endBlock <= block.number + MAX_DEADLINE_FUTURE, "End too far in future");

        uint256 blocksToReserve = (startPrice - reservePrice) / priceDecrement;
        require(startBlock + blocksToReserve <= endBlock, "Duration too short for price range");

        auctions[auctionId] = Auction({
            creator: msg.sender,
            rfqId: rfqId,
            startPrice: startPrice,
            reservePrice: reservePrice,
            priceDecrement: priceDecrement,
            startBlock: startBlock,
            endBlock: endBlock,
            status: AuctionStatus.Active,
            committor: address(0),
            commitBlock: 0,
            commitPrice: 0,
            winner: address(0),
            finalPrice: 0
        });

        emit AuctionCreated(
            auctionId,
            msg.sender,
            rfqId,
            startPrice,
            reservePrice,
            priceDecrement,
            startBlock,
            endBlock
        );
    }

    function getCurrentPrice(bytes32 auctionId) public view auctionExists(auctionId) returns (uint64) {
        Auction storage auction = auctions[auctionId];

        if (block.number < auction.startBlock) {
            return auction.startPrice;
        }
        if (block.number >= auction.endBlock) {
            return auction.reservePrice;
        }

        uint256 blocksElapsed = block.number - auction.startBlock;
        uint256 totalDecrement = blocksElapsed * uint256(auction.priceDecrement);
        uint256 maxDecrement = uint256(auction.startPrice) - uint256(auction.reservePrice);
        if (totalDecrement > maxDecrement) {
            return auction.reservePrice;
        }

        return auction.startPrice - uint64(totalDecrement);
    }

    
    function commitAcceptance(
        bytes32 auctionId,
        bytes32 acceptanceId
    ) external auctionExists(auctionId) {
        _initiateAcceptance(auctionId, acceptanceId, msg.sender, PendingAcceptanceAction.CommitAcceptance);
    }

    
    function permitAndCommitAcceptance(
        bytes32 auctionId,
        bytes32 acceptanceId,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external auctionExists(auctionId) {
        _permitShortLivedOperator(msg.sender, deadline, v, r, s);
        _initiateAcceptance(auctionId, acceptanceId, msg.sender, PendingAcceptanceAction.CommitAcceptance);
    }

    function confirmAcceptance(
        bytes32 auctionId,
        bytes32 acceptanceId
    ) external nonReentrant auctionExists(auctionId) {
        Auction storage auction = auctions[auctionId];
        Acceptance storage acceptance = acceptances[auctionId][acceptanceId];

        require(pendingAuctionTransferId[auctionId] == bytes32(0), "Pending transfer verification");
        require(auction.status == AuctionStatus.Committed, "No pending commitment");
        require(acceptance.bidder == msg.sender, "Not your acceptance");
        require(acceptance.stake > 0, "Stake not verified");
        require(!acceptance.confirmed, "Already confirmed");
        require(block.number <= acceptance.commitBlock + CONFIRM_WINDOW_BLOCKS, "Confirm window passed");

        acceptance.confirmed = true;
        auction.status = AuctionStatus.Confirmed;
        auction.winner = msg.sender;
        auction.finalPrice = acceptance.committedPrice;

        emit AcceptanceConfirmed(auctionId, acceptanceId, msg.sender, acceptance.committedPrice);
        emit AuctionEnded(auctionId, msg.sender, acceptance.committedPrice);
    }

    
    function acceptPrice(bytes32 auctionId) external auctionExists(auctionId) {
        bytes32 acceptanceId = keccak256(abi.encodePacked("direct", auctionId, msg.sender, block.number));
        _initiateAcceptance(auctionId, acceptanceId, msg.sender, PendingAcceptanceAction.AcceptPrice);
    }

    
    function permitAndAcceptPrice(
        bytes32 auctionId,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external auctionExists(auctionId) {
        _permitShortLivedOperator(msg.sender, deadline, v, r, s);
        bytes32 acceptanceId = keccak256(abi.encodePacked("direct", auctionId, msg.sender, block.number));
        _initiateAcceptance(auctionId, acceptanceId, msg.sender, PendingAcceptanceAction.AcceptPrice);
    }

    function resetExpiredCommitment(
        bytes32 auctionId,
        bytes32 acceptanceId
    ) external auctionExists(auctionId) {
        Auction storage auction = auctions[auctionId];
        Acceptance storage acceptance = acceptances[auctionId][acceptanceId];

        require(
            msg.sender == auction.creator || msg.sender == acceptance.bidder,
            "Not authorised to reset"
        );
        require(auction.status == AuctionStatus.Committed, "No pending commitment");
        require(acceptance.commitBlock + CONFIRM_WINDOW_BLOCKS < block.number, "Window not expired");
        require(!acceptance.confirmed, "Already confirmed");

        hasAccepted[auctionId][acceptance.bidder] = false;

        if (block.number < auction.endBlock) {
            auction.status = AuctionStatus.Active;
            auction.committor = address(0);
            auction.commitBlock = 0;
            auction.commitPrice = 0;
        } else {
            auction.status = AuctionStatus.Expired;
            emit AuctionExpired(auctionId);
        }

        emit AcceptanceFailed(auctionId, acceptanceId, acceptance.bidder, "Confirmation window expired");
    }

    function cancelAuction(bytes32 auctionId) external auctionExists(auctionId) {
        Auction storage auction = auctions[auctionId];

        require(pendingAuctionTransferId[auctionId] == bytes32(0), "Pending transfer verification");
        require(msg.sender == auction.creator, "Only creator");
        require(
            auction.status == AuctionStatus.Active ||
            (auction.status == AuctionStatus.Committed &&
             block.number > auction.commitBlock + CONFIRM_WINDOW_BLOCKS),
            "Cannot cancel"
        );

        if (auction.status == AuctionStatus.Committed && auction.committor != address(0)) {
            hasAccepted[auctionId][auction.committor] = false;
        }

        auction.status = AuctionStatus.Cancelled;
        emit AuctionCancelled(auctionId, msg.sender);
    }

    function refundStake(
        bytes32 auctionId,
        bytes32 acceptanceId
    ) external nonReentrant auctionExists(auctionId) {
        Auction storage auction = auctions[auctionId];
        Acceptance storage acceptance = acceptances[auctionId][acceptanceId];

        require(acceptance.bidder == msg.sender, "Not your acceptance");
        require(acceptance.stake > 0, "No stake to refund");
        require(!acceptance.slashed, "Already slashed");

        bool canRefund = (
            auction.status == AuctionStatus.Cancelled ||
            auction.status == AuctionStatus.Expired ||
            auction.status == AuctionStatus.Confirmed ||
            (block.number > auction.endBlock && auction.status == AuctionStatus.Active)
        );
        require(canRefund, "Cannot refund yet");

        uint64 amount = acceptance.stake;
        acceptance.stake = 0;
        _transferStake(
            msg.sender,
            amount,
            keccak256(abi.encodePacked("dutch-refund", auctionId, acceptanceId))
        );

        emit StakeRefunded(auctionId, acceptanceId, msg.sender, amount);
    }

    function slashNonConfirmed(
        bytes32 auctionId,
        bytes32 acceptanceId
    ) external nonReentrant auctionExists(auctionId) {
        Auction storage auction = auctions[auctionId];
        Acceptance storage acceptance = acceptances[auctionId][acceptanceId];

        require(msg.sender == auction.creator, "Only creator");
        require(acceptance.stake > 0, "No stake to slash");
        require(!acceptance.confirmed, "Already confirmed");
        require(!acceptance.slashed, "Already slashed");
        require(block.number > acceptance.commitBlock + CONFIRM_WINDOW_BLOCKS, "Window not expired");

        acceptance.slashed = true;
        uint64 amount = acceptance.stake;
        acceptance.stake = 0;
        _transferStake(
            msg.sender,
            amount,
            keccak256(abi.encodePacked("dutch-slash", auctionId, acceptanceId))
        );

        emit StakeSlashed(auctionId, acceptanceId, msg.sender, amount);
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

        PendingAcceptanceTransfer memory pending = pendingAcceptanceTransfers[transferId];
        if (pending.action != PendingAcceptanceAction.None) {
            delete pendingAcceptanceTransfers[transferId];
            delete pendingAuctionTransferId[pending.auctionId];

            if (success) {
                acceptances[pending.auctionId][pending.acceptanceId] = Acceptance({
                    bidder: pending.bidder,
                    stake: DEFAULT_STAKE,
                    commitBlock: pending.commitBlock,
                    committedPrice: pending.committedPrice,
                    confirmed: pending.action == PendingAcceptanceAction.AcceptPrice,
                    slashed: false
                });
                hasAccepted[pending.auctionId][pending.bidder] = true;

                Auction storage auction = auctions[pending.auctionId];
                if (pending.action == PendingAcceptanceAction.CommitAcceptance) {
                    auction.status = AuctionStatus.Committed;
                    auction.committor = pending.bidder;
                    auction.commitBlock = pending.commitBlock;
                    auction.commitPrice = pending.committedPrice;
                    emit AcceptanceCommitted(
                        pending.auctionId,
                        pending.acceptanceId,
                        pending.bidder,
                        pending.committedPrice
                    );
                } else {
                    auction.status = AuctionStatus.Confirmed;
                    auction.winner = pending.bidder;
                    auction.finalPrice = pending.committedPrice;
                    emit DirectAcceptance(pending.auctionId, pending.bidder, pending.committedPrice);
                    emit AuctionEnded(pending.auctionId, pending.bidder, pending.committedPrice);
                }
            }
        }

        delete pendingTransferCheckCt[transferId];
        emit TransferVerified(transferId, success);
    }

    function getAuctionResult(bytes32 auctionId) external view override returns (
        address winner,
        uint64 finalPrice,
        bool finalized
    ) {
        Auction storage auction = auctions[auctionId];
        return (auction.winner, auction.finalPrice, auction.status == AuctionStatus.Confirmed);
    }

    function getAuction(bytes32 auctionId) external view returns (Auction memory) {
        return auctions[auctionId];
    }

    function getAcceptance(bytes32 auctionId, bytes32 acceptanceId) external view returns (Acceptance memory) {
        return acceptances[auctionId][acceptanceId];
    }

    function getTimeRemaining(bytes32 auctionId) external view auctionExists(auctionId) returns (uint256) {
        Auction storage auction = auctions[auctionId];
        if (block.number >= auction.endBlock) {
            return 0;
        }
        return auction.endBlock - block.number;
    }

    function hasAlreadyAccepted(bytes32 auctionId, address bidder) external view returns (bool) {
        return hasAccepted[auctionId][bidder];
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
        if (msg.sender != address(stakeToken) || operator != address(this) || data.length != 64) {
            return _rejectTransfer();
        }

        (bytes32 auctionId, bytes32 acceptanceId) = abi.decode(data, (bytes32, bytes32));
        Auction storage auction = auctions[auctionId];

        if (auction.creator == address(0)) {
            return _rejectTransfer();
        }
        if (auction.status != AuctionStatus.Active) {
            return _rejectTransfer();
        }
        if (block.number < auction.startBlock || block.number >= auction.endBlock) {
            return _rejectTransfer();
        }
        if (acceptanceId == bytes32(0) || acceptances[auctionId][acceptanceId].bidder != address(0)) {
            return _rejectTransfer();
        }
        if (hasAccepted[auctionId][from]) {
            return _rejectTransfer();
        }

        euint64 requiredStake = _encryptedDefaultStake;

        ebool stakeMatches = FHE.eq(amount, requiredStake);
        FHE.allow(amount, from);
        return _allowCallbackResult(stakeMatches);
    }
}
