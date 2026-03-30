import type { PrismaClient } from '@prisma/client';
import { getFhenixClients } from './fhenixClient';
import { FHENIX_STATUS_LABELS } from './fhenixProtocol';
import { prisma as defaultPrisma } from './prismaClient';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const ZERO_BYTES32 = `0x${'0'.repeat(64)}`;

function normalizeBytes32(value: unknown): string | null {
    const normalized = String(value);
    return normalized === ZERO_BYTES32 ? null : normalized;
}

function normalizeAddress(value: unknown): string | null {
    const normalized = String(value);
    return normalized === ZERO_ADDRESS ? null : normalized;
}

function safeLifecycleBlock(value: unknown): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

export async function syncIndexedRfq(
    rfqId: string,
    options?: {
        txHash?: string;
        itemName?: string | null;
        description?: string | null;
        quantity?: string | null;
        unit?: string | null;
    },
    prisma: PrismaClient = defaultPrisma,
) {
    const { sealRfq } = getFhenixClients();
    const [rfq, statusCode, auctionSource, invoiceReceipt] = await Promise.all([
        sealRfq.getRFQ(rfqId),
        sealRfq.getRfqStatus(rfqId),
        sealRfq.auctionSource(rfqId),
        sealRfq.invoiceReceipts(rfqId),
    ]);

    const buyer = String(rfq.creator);
    if (buyer === ZERO_ADDRESS) {
        return null;
    }

    const existing = await prisma.rFQ.findUnique({ where: { id: rfqId } });
    const createdTxId = existing?.createdTxId ?? options?.txHash ?? `chain:${rfqId}`;
    const createdBlock = existing?.createdBlock ?? safeLifecycleBlock(rfq.lifecycleBlock);

    return prisma.rFQ.upsert({
        where: { id: rfqId },
        create: {
            id: rfqId,
            buyer,
            biddingDeadline: Number(rfq.biddingDeadline),
            revealDeadline: Number(rfq.revealDeadline),
            minBid: BigInt(rfq.minBid),
            status: FHENIX_STATUS_LABELS[Number(statusCode)] ?? 'UNKNOWN',
            tokenType: Number(rfq.escrowToken),
            pricingMode: Number(rfq.mode),
            auctionSource: normalizeBytes32(auctionSource),
            winnerAccepted: Boolean(rfq.winnerAccepted),
            paid: Boolean(rfq.paid),
            receiptHash: normalizeBytes32(invoiceReceipt),
            itemName: options?.itemName ?? null,
            description: options?.description ?? null,
            quantity: options?.quantity ?? null,
            unit: options?.unit ?? null,
            metadataHash: normalizeBytes32(rfq.metadataHash),
            createdBlock,
            createdTxId,
            createdEventIdx: existing?.createdEventIdx ?? 0,
        },
        update: {
            buyer,
            biddingDeadline: Number(rfq.biddingDeadline),
            revealDeadline: Number(rfq.revealDeadline),
            minBid: BigInt(rfq.minBid),
            status: FHENIX_STATUS_LABELS[Number(statusCode)] ?? 'UNKNOWN',
            tokenType: Number(rfq.escrowToken),
            pricingMode: Number(rfq.mode),
            auctionSource: normalizeBytes32(auctionSource),
            winnerAccepted: Boolean(rfq.winnerAccepted),
            paid: Boolean(rfq.paid),
            receiptHash: normalizeBytes32(invoiceReceipt),
            itemName: options?.itemName ?? existing?.itemName ?? null,
            description: options?.description ?? existing?.description ?? null,
            quantity: options?.quantity ?? existing?.quantity ?? null,
            unit: options?.unit ?? existing?.unit ?? null,
            metadataHash: normalizeBytes32(rfq.metadataHash) ?? existing?.metadataHash ?? null,
        },
    });
}

export async function syncIndexedRfqBid(
    rfqId: string,
    bidId: string,
    options?: { txHash?: string },
    prisma: PrismaClient = defaultPrisma,
) {
    await syncIndexedRfq(rfqId, undefined, prisma);

    const { sealRfq } = getFhenixClients();
    const bid = await sealRfq.bids(rfqId, bidId);
    const owner = String(bid.owner);
    if (owner === ZERO_ADDRESS) {
        return null;
    }

    const existing = await prisma.bid.findUnique({ where: { id: bidId } });

    if (existing) {
        return prisma.bid.update({
            where: { id: bidId },
            data: {
                rfqId,
                vendor: owner,
                commitmentHash: String(bid.encryptedAmount),
                stake: BigInt(bid.stake),
                revealedAmount: BigInt(bid.revealedAmount),
                isRevealed: Boolean(bid.revealed),
            },
        });
    }

    return prisma.bid.create({
        data: {
            id: bidId,
            rfqId,
            vendor: owner,
            commitmentHash: String(bid.encryptedAmount),
            stake: BigInt(bid.stake),
            revealedAmount: BigInt(bid.revealedAmount),
            isWinner: false,
            isRevealed: Boolean(bid.revealed),
            isSlashed: false,
            isRefunded: false,
            createdBlock: 0,
            revealedBlock: Boolean(bid.revealed) ? 0 : null,
            createdTxId: options?.txHash ?? `chain:${rfqId}:${bidId}`,
            createdEventIdx: 0,
        },
    });
}

export async function syncIndexedRfqBidsFromChain(rfqId: string, prisma: PrismaClient = defaultPrisma) {
    const { sealRfq } = getFhenixClients();
    const bidIds = await sealRfq.getBidIds(rfqId);
    await Promise.all(bidIds.map((bidId: string) => syncIndexedRfqBid(rfqId, String(bidId), undefined, prisma)));
    await syncIndexedRfqWinnerFlags(rfqId, prisma);
}

export async function syncIndexedRfqWinnerFlags(rfqId: string, prisma: PrismaClient = defaultPrisma) {
    const { sealRfq } = getFhenixClients();
    const winnerBidId = String(await sealRfq.winnerBids(rfqId));
    await prisma.bid.updateMany({
        where: { rfqId },
        data: { isWinner: false },
    });

    if (winnerBidId !== ZERO_BYTES32) {
        await prisma.bid.updateMany({
            where: { rfqId, id: winnerBidId },
            data: { isWinner: true },
        });
    }

    return winnerBidId;
}

export async function syncIndexedRfqEscrow(
    rfqId: string,
    options?: { txHash?: string },
    prisma: PrismaClient = defaultPrisma,
) {
    await syncIndexedRfq(rfqId, undefined, prisma);

    const { sealRfq } = getFhenixClients();
    const [rfq, escrow] = await Promise.all([sealRfq.getRFQ(rfqId), sealRfq.getEscrow(rfqId)]);
    const existing = await prisma.escrow.findUnique({ where: { rfqId } });

    const originalAmount = BigInt(escrow.originalAmount);
    const currentAmount = BigInt(escrow.currentAmount);
    const totalReleased = BigInt(escrow.totalReleased);

    if (!existing && originalAmount === 0n && currentAmount === 0n && totalReleased === 0n) {
        return null;
    }

    if (existing) {
        return prisma.escrow.update({
            where: { rfqId },
            data: {
                totalAmount: originalAmount,
                releasedAmount: totalReleased,
                isFinal: Boolean(rfq.finalPaymentReleased) || currentAmount === 0n,
            },
        });
    }

    return prisma.escrow.create({
        data: {
            rfqId,
            totalAmount: originalAmount,
            releasedAmount: totalReleased,
            isFinal: Boolean(rfq.finalPaymentReleased) || currentAmount === 0n,
            fundedBlock: safeLifecycleBlock(rfq.lifecycleBlock),
            fundedTxId: options?.txHash ?? `chain:escrow:${rfqId}`,
            fundedEventIdx: 0,
        },
    });
}

export async function syncIndexedVickreyAuction(
    auctionId: string,
    options?: { txHash?: string },
    prisma: PrismaClient = defaultPrisma,
) {
    const { sealVickrey } = getFhenixClients();
    const auction = await sealVickrey.auctions(auctionId);
    const creator = String(auction.creator);
    if (creator === ZERO_ADDRESS) {
        return null;
    }

    const existing = await prisma.vickreyAuction.findUnique({ where: { id: auctionId } });
    return prisma.vickreyAuction.upsert({
        where: { id: auctionId },
        create: {
            id: auctionId,
            creator,
            rfqId: normalizeBytes32(auction.rfqId),
            createdTxHash: existing?.createdTxHash ?? options?.txHash ?? `chain:${auctionId}`,
        },
        update: {
            creator,
            rfqId: normalizeBytes32(auction.rfqId),
        },
    });
}

export async function syncIndexedVickreyBid(
    auctionId: string,
    bidId: string,
    options?: { txHash?: string },
    prisma: PrismaClient = defaultPrisma,
) {
    await syncIndexedVickreyAuction(auctionId, undefined, prisma);

    const { sealVickrey } = getFhenixClients();
    const bid = await sealVickrey.bids(auctionId, bidId);
    const vendor = String(bid.owner);
    if (vendor === ZERO_ADDRESS) {
        return null;
    }

    const existing = await prisma.vickreyBid.findUnique({ where: { id: bidId } });
    if (existing) {
        return prisma.vickreyBid.update({
            where: { id: bidId },
            data: {
                auctionId,
                vendor,
            },
        });
    }

    return prisma.vickreyBid.create({
        data: {
            id: bidId,
            auctionId,
            vendor,
            createdTxHash: options?.txHash ?? `chain:${auctionId}:${bidId}`,
        },
    });
}

export async function syncIndexedDutchAuction(
    auctionId: string,
    options?: { txHash?: string },
    prisma: PrismaClient = defaultPrisma,
) {
    const { sealDutch } = getFhenixClients();
    const auction = await sealDutch.auctions(auctionId);
    const creator = String(auction.creator);
    if (creator === ZERO_ADDRESS) {
        return null;
    }

    const existing = await prisma.dutchAuction.findUnique({ where: { id: auctionId } });
    return prisma.dutchAuction.upsert({
        where: { id: auctionId },
        create: {
            id: auctionId,
            creator,
            rfqId: normalizeBytes32(auction.rfqId),
            createdTxHash: existing?.createdTxHash ?? options?.txHash ?? `chain:${auctionId}`,
        },
        update: {
            creator,
            rfqId: normalizeBytes32(auction.rfqId),
        },
    });
}

export async function syncIndexedDutchAcceptance(
    auctionId: string,
    acceptanceId: string,
    options?: { txHash?: string },
    prisma: PrismaClient = defaultPrisma,
) {
    await syncIndexedDutchAuction(auctionId, undefined, prisma);

    const { sealDutch } = getFhenixClients();
    const acceptance = await sealDutch.acceptances(auctionId, acceptanceId);
    const bidder = String(acceptance.bidder);
    if (bidder === ZERO_ADDRESS) {
        return null;
    }

    const existing = await prisma.dutchAcceptance.findUnique({ where: { id: acceptanceId } });
    if (existing) {
        return prisma.dutchAcceptance.update({
            where: { id: acceptanceId },
            data: {
                auctionId,
                bidder,
            },
        });
    }

    return prisma.dutchAcceptance.create({
        data: {
            id: acceptanceId,
            auctionId,
            bidder,
            createdTxHash: options?.txHash ?? `chain:${auctionId}:${acceptanceId}`,
        },
    });
}
