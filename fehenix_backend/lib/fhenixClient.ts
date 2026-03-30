import { Contract, FallbackProvider, JsonRpcProvider } from 'ethers';
import { addressSchema } from './fhenixProtocol';

const ENCRYPTED_UINT64_TUPLE = 'tuple(uint256 ctHash,uint8 securityZone,uint8 utype,bytes signature)';

const SEAL_RFQ_ABI = [
    'function configurePlatform(uint256 feeBps, bool paused)',
    'function withdrawTokenFees(uint8 tokenType, uint256 amount)',
    `function createRFQ(bytes32 rfqId, bytes32 salt, uint256 biddingDeadline, uint256 revealDeadline, uint64 minBid, uint64 minBidCount, bytes32 metadataHash, uint8 escrowToken, uint8 mode)`,
    `function submitBid(bytes32 rfqId, bytes32 bidId, ${ENCRYPTED_UINT64_TUPLE} encryptedBid)`,
    `function permitAndSubmitBid(bytes32 rfqId, bytes32 bidId, ${ENCRYPTED_UINT64_TUPLE} encryptedBid, uint256 deadline, uint8 v, bytes32 r, bytes32 s)`,
    'function closeBidding(bytes32 rfqId)',
    'function publishLowestBid(bytes32 rfqId, uint64 plaintext, bytes signature)',
    'function selectWinner(bytes32 rfqId, bytes32 bidId, uint64 plaintext, bytes signature)',
    'function winnerRespond(bytes32 rfqId, bool accept)',
    'function winnerRespondImported(bytes32 rfqId, bool accept)',
    'function fundEscrowToken(bytes32 rfqId, uint8 tokenType, uint64 amount)',
    'function permitAndFundEscrow(bytes32 rfqId, uint8 tokenType, uint64 amount, uint256 deadline, uint8 v, bytes32 r, bytes32 s)',
    'function releasePartialPayment(bytes32 rfqId, uint8 percentage)',
    'function importAuctionResult(bytes32 rfqId, bytes32 auctionId, address auctionContract, uint8 auctionType)',
    'function cancelRFQ(bytes32 rfqId, uint8 cancelType)',
    'function refundStake(bytes32 rfqId, bytes32 bidId)',
    'function slashNonRevealer(bytes32 rfqId, bytes32 bidId)',
    'function creatorReclaimEscrow(bytes32 rfqId)',
    'function winnerClaimEscrow(bytes32 rfqId)',
    'function confirmTransferVerification(bytes32 transferId, bool success, bytes signature)',
    'function getRFQ(bytes32 rfqId) view returns ((address creator,uint256 biddingDeadline,uint256 revealDeadline,uint64 minBid,uint64 minBidCount,uint64 flatStake,bytes32 metadataHash,uint8 escrowToken,uint8 mode,uint8 status,uint64 bidCount,address winnerAddress,uint256 lifecycleBlock,bool winnerAccepted,bool paid,bool finalPaymentReleased))',
    'function getRfqStatus(bytes32 rfqId) view returns (uint8)',
    'function getEscrow(bytes32 rfqId) view returns ((uint64 originalAmount,uint64 currentAmount,uint64 totalReleased))',
    'function getBidInfo(bytes32 rfqId, bytes32 bidId) view returns (address owner, uint64 stake, bool revealed, uint64 revealedAmount)',
    'function getBidIds(bytes32 rfqId) view returns (bytes32[])',
    'function getLowestBidReveal(bytes32 rfqId) view returns (uint64 amount, bool published)',
    'function getPendingTransferCheck(bytes32 transferId) view returns (bytes32)',
    'function bids(bytes32 rfqId, bytes32 bidId) view returns (address owner, bytes32 encryptedAmount, uint64 stake, bool revealed, uint64 revealedAmount)',
    'function lowestEncryptedBid(bytes32 rfqId) view returns (bytes32)',
    'function lowestBidId(bytes32 rfqId) view returns (bytes32)',
    'function winnerBids(bytes32 rfqId) view returns (bytes32)',
    'function auctionSource(bytes32 rfqId) view returns (bytes32)',
    'function invoiceReceipts(bytes32 rfqId) view returns (bytes32)',
    'function importedWinnerPrice(bytes32 rfqId) view returns (uint64)',
    'function hasVendorBid(bytes32 rfqId, address vendor) view returns (bool)',
    'function platformConfig() view returns (address admin,uint256 feeBps,bool paused,uint256 treasuryToken1,uint256 treasuryToken2)',
    'function token1() view returns (address)',
    'function token2() view returns (address)',
] as const;

const SEAL_VICKREY_ABI = [
    `function createAuction(bytes32 auctionId, bytes32 salt, bytes32 rfqId, uint256 biddingDeadline, uint256 revealDeadline, uint64 flatStake, uint64 minBidCount)`,
    `function commitBid(bytes32 auctionId, bytes32 bidId, ${ENCRYPTED_UINT64_TUPLE} encryptedBid)`,
    `function permitAndCommitBid(bytes32 auctionId, bytes32 bidId, ${ENCRYPTED_UINT64_TUPLE} encryptedBid, uint256 deadline, uint8 v, bytes32 r, bytes32 s)`,
    'function closeBidding(bytes32 auctionId)',
    'function revealBid(bytes32 auctionId, bytes32 bidId, uint64 plaintext, bytes signature)',
    'function finalizeAuction(bytes32 auctionId, uint64 lowestBidPlaintext, bytes lowestBidSignature, uint64 secondBidPlaintext, bytes secondBidSignature, address winnerPlaintext, bytes winnerSignature)',
    'function cancelAuction(bytes32 auctionId)',
    'function refundStake(bytes32 auctionId, bytes32 bidId)',
    'function slashUnrevealed(bytes32 auctionId, bytes32 bidId)',
    'function confirmTransferVerification(bytes32 transferId, bool success, bytes signature)',
    'function getAuctionResult(bytes32 auctionId) view returns (address winner, uint64 finalPrice, bool finalized)',
    'function getAuction(bytes32 auctionId) view returns ((address creator,bytes32 rfqId,uint256 biddingDeadline,uint256 revealDeadline,uint64 flatStake,uint64 minBidCount,uint8 status,uint64 bidCount,uint64 revealedCount,address finalWinner,uint64 finalPrice,bool finalized))',
    'function auctions(bytes32 auctionId) view returns (address creator, bytes32 rfqId, uint256 biddingDeadline, uint256 revealDeadline, uint64 flatStake, uint64 minBidCount, uint8 status, uint64 bidCount, uint64 revealedCount, address finalWinner, uint64 finalPrice, bool finalized)',
    'function bids(bytes32 auctionId, bytes32 bidId) view returns (address owner, bytes32 encryptedAmount, uint64 stake, bool revealed, uint64 revealedAmount)',
    'function getBidInfo(bytes32 auctionId, bytes32 bidId) view returns (address owner, uint64 stake, bool revealed, uint64 revealedAmount)',
    'function hasBid(bytes32 auctionId, address vendor) view returns (bool)',
    'function getPendingTransferCheck(bytes32 transferId) view returns (bytes32)',
    'function encryptedLowestBid(bytes32 auctionId) view returns (bytes32)',
    'function encryptedSecondLowestBid(bytes32 auctionId) view returns (bytes32)',
    'function encryptedLowestBidder(bytes32 auctionId) view returns (bytes32)',
] as const;

const SEAL_DUTCH_ABI = [
    'function createAuction(bytes32 auctionId, bytes32 salt, bytes32 rfqId, uint64 startPrice, uint64 reservePrice, uint64 priceDecrement, uint256 startBlock, uint256 endBlock)',
    'function commitAcceptance(bytes32 auctionId, bytes32 acceptanceId)',
    'function permitAndCommitAcceptance(bytes32 auctionId, bytes32 acceptanceId, uint256 deadline, uint8 v, bytes32 r, bytes32 s)',
    'function confirmAcceptance(bytes32 auctionId, bytes32 acceptanceId)',
    'function acceptPrice(bytes32 auctionId)',
    'function permitAndAcceptPrice(bytes32 auctionId, uint256 deadline, uint8 v, bytes32 r, bytes32 s)',
    'function resetExpiredCommitment(bytes32 auctionId, bytes32 acceptanceId)',
    'function cancelAuction(bytes32 auctionId)',
    'function refundStake(bytes32 auctionId, bytes32 acceptanceId)',
    'function slashNonConfirmed(bytes32 auctionId, bytes32 acceptanceId)',
    'function confirmTransferVerification(bytes32 transferId, bool success, bytes signature)',
    'function getAuctionResult(bytes32 auctionId) view returns (address winner, uint64 finalPrice, bool finalized)',
    'function getCurrentPrice(bytes32 auctionId) view returns (uint64)',
    'function auctions(bytes32 auctionId) view returns (address creator, bytes32 rfqId, uint64 startPrice, uint64 reservePrice, uint64 priceDecrement, uint256 startBlock, uint256 endBlock, uint8 status, address committor, uint256 commitBlock, uint64 commitPrice, address winner, uint64 finalPrice)',
    'function acceptances(bytes32 auctionId, bytes32 acceptanceId) view returns (address bidder, uint64 stake, uint256 commitBlock, uint64 committedPrice, bool confirmed, bool slashed)',
    'function hasAccepted(bytes32 auctionId, address bidder) view returns (bool)',
    'function DEFAULT_STAKE() view returns (uint64)',
    'function getPendingTransferCheck(bytes32 transferId) view returns (bytes32)',
] as const;

const SEAL_INVOICE_ABI = [
    'function createInvoice(bytes32 invoiceId, bytes32 salt, address payee, address token, uint256 amount, bytes32 rfqId, bytes32 orderId, string description)',
    'function payInvoice(bytes32 invoiceId)',
    'function permitAndPayInvoice(bytes32 invoiceId, uint256 deadline, uint8 v, bytes32 r, bytes32 s)',
    'function confirmInvoicePayment(bytes32 invoiceId, uint64 plaintext, bytes signature)',
    'function payInvoiceNative(bytes32 invoiceId) payable',
    'function cancelInvoice(bytes32 invoiceId, string reason)',
    'function withdrawPayment(bytes32 invoiceId)',
    'function withdrawPaymentNative(bytes32 invoiceId)',
    'function refundInvoice(bytes32 invoiceId)',
    'function refundInvoiceNative(bytes32 invoiceId)',
    'function directPayment(bytes32 paymentId, address to, address token, uint256 amount)',
    'function directPaymentNative(bytes32 paymentId, address to) payable',
    'function confirmTransferVerification(bytes32 transferId, bool success, bytes signature)',
    'function getInvoice(bytes32 invoiceId) view returns ((bytes32 invoiceId,address payer,address payee,address token,uint256 amount,bytes32 rfqId,bytes32 orderId,uint8 status,uint256 createdAt,uint256 paidAt,bytes32 descriptionHash))',
    'function getReceipt(bytes32 receiptId) view returns ((bytes32 receiptId,bytes32 invoiceId,address payer,address payee,address token,uint256 amount,uint256 timestamp,bytes32 txHash))',
    'function getReceiptForInvoice(bytes32 invoiceId) view returns ((bytes32 receiptId,bytes32 invoiceId,address payer,address payee,address token,uint256 amount,uint256 timestamp,bytes32 txHash))',
    'function getPayerInvoices(address payer) view returns (bytes32[])',
    'function getPayeeInvoices(address payee) view returns (bytes32[])',
    'function getRfqInvoices(bytes32 rfqId) view returns (bytes32[])',
    'function getCounts() view returns (uint256 invoiceCount, uint256 receiptCount)',
    'function invoiceToReceipt(bytes32 invoiceId) view returns (bytes32)',
    'function getPendingPayment(bytes32 invoiceId) view returns (bytes32)',
    'function getPendingTransferCheck(bytes32 transferId) view returns (bytes32)',
] as const;

export type FhenixClients = {
    provider: JsonRpcProvider;
    sealRfq: Contract;
    sealVickrey: Contract;
    sealDutch: Contract;
    sealInvoice: Contract;
    chainId: number;
};

let cached: FhenixClients | null = null;

function required(name: string): string {
    const value = process.env[name];
    if (!value || value.trim() === '') {
        throw new Error(`Missing required env var: ${name}`);
    }
    return value;
}

function validateAddress(name: string, value: string) {
    if (!addressSchema.safeParse(value).success) {
        throw new Error(`${name} must be a valid 0x address`);
    }
}

export function getFhenixClients(): FhenixClients {
    if (cached) return cached;

    const chainId = Number(required('FHENIX_CHAIN_ID'));
    if (!Number.isInteger(chainId) || chainId <= 0) {
        throw new Error('FHENIX_CHAIN_ID must be a positive integer');
    }
    const publicSepoliaRpc = 'https://ethereum-sepolia-rpc.publicnode.com';
    const rpcUrls = Array.from(
        new Set(
            [
                publicSepoliaRpc,
                required('FHENIX_RPC_URL'),
                process.env.FHENIX_RPC_FALLBACK_URL,
            ].filter((value): value is string => Boolean(value && value.trim())),
        ),
    );

    const sealRfqAddress = required('FHENIX_SEAL_RFQ_ADDRESS');
    const sealVickreyAddress = required('FHENIX_SEAL_VICKREY_ADDRESS');
    const sealDutchAddress = required('FHENIX_SEAL_DUTCH_ADDRESS');
    const sealInvoiceAddress = required('FHENIX_SEAL_INVOICE_ADDRESS');
    const privateKey = required('FHENIX_PRIVATE_KEY');

    validateAddress('FHENIX_SEAL_RFQ_ADDRESS', sealRfqAddress);
    validateAddress('FHENIX_SEAL_VICKREY_ADDRESS', sealVickreyAddress);
    validateAddress('FHENIX_SEAL_DUTCH_ADDRESS', sealDutchAddress);
    validateAddress('FHENIX_SEAL_INVOICE_ADDRESS', sealInvoiceAddress);

    if (!/^0x[a-fA-F0-9]{64}$/.test(privateKey)) {
        throw new Error('FHENIX_PRIVATE_KEY must be a 32-byte 0x hex private key');
    }

    const provider =
        rpcUrls.length === 1
            ? new JsonRpcProvider(rpcUrls[0], chainId, {
                  staticNetwork: true,
                  batchMaxCount: 1,
              })
            : new FallbackProvider(
                  rpcUrls.map((url, index) => ({
                      provider: new JsonRpcProvider(url, chainId, {
                          staticNetwork: true,
                          batchMaxCount: 1,
                      }),
                      priority: index + 1,
                      stallTimeout: 1_500,
                      weight: 1,
                  })),
              );

    cached = {
        provider,
        sealRfq: new Contract(sealRfqAddress, SEAL_RFQ_ABI, provider),
        sealVickrey: new Contract(sealVickreyAddress, SEAL_VICKREY_ABI, provider),
        sealDutch: new Contract(sealDutchAddress, SEAL_DUTCH_ABI, provider),
        sealInvoice: new Contract(sealInvoiceAddress, SEAL_INVOICE_ABI, provider),
        chainId,
    };

    return cached;
}
