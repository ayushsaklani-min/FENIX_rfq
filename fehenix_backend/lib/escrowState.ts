import { PrismaClient } from '@prisma/client';
import { TxStatus } from '../db/enums';

export async function materializeEscrowFromConfirmedFunding(
    prisma: PrismaClient,
    rfqId: string,
) {
    const existing = await prisma.escrow.findUnique({ where: { rfqId } });
    if (existing) {
        return existing;
    }

    const rfq = await prisma.rFQ.findUnique({
        where: { id: rfqId },
        select: { id: true },
    });
    if (!rfq) {
        return null;
    }

    const confirmedFunding = await prisma.transaction.findFirst({
        where: {
            canonicalTxKey: `fund_escrow:${rfqId}`,
            status: TxStatus.CONFIRMED,
        },
        orderBy: [
            { confirmedAt: 'desc' },
            { preparedAt: 'desc' },
        ],
        select: {
            idempotencyKey: true,
            txHash: true,
            blockHeight: true,
        },
    });
    if (!confirmedFunding) {
        return null;
    }

    const winningBid = await prisma.bid.findFirst({
        where: { rfqId, isWinner: true },
        select: { revealedAmount: true },
    });
    if (!winningBid?.revealedAmount) {
        return null;
    }

    const fundedTxId = confirmedFunding.txHash || `pending_${confirmedFunding.idempotencyKey}`;
    await prisma.$transaction([
        prisma.escrow.upsert({
            where: { rfqId },
            update: {
                totalAmount: winningBid.revealedAmount,
                fundedBlock: confirmedFunding.blockHeight ?? 0,
                fundedTxId,
                fundedEventIdx: 0,
            },
            create: {
                rfqId,
                totalAmount: winningBid.revealedAmount,
                releasedAmount: BigInt(0),
                isFinal: false,
                fundedBlock: confirmedFunding.blockHeight ?? 0,
                fundedTxId,
                fundedEventIdx: 0,
            },
        }),
        prisma.rFQ.update({
            where: { id: rfqId },
            data: { status: 'ESCROW_FUNDED', updatedAt: new Date() },
        }),
    ]);

    return prisma.escrow.findUnique({ where: { rfqId } });
}
