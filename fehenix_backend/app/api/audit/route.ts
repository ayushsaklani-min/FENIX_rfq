import { requireRole } from '@/auth/middleware';
import { prisma } from '@/lib/prismaClient';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
    const auth = await requireRole(request, ['BUYER', 'AUDITOR', 'NEW_USER']);
    if (auth instanceof NextResponse) {
        return auth;
    }

    const url = new URL(request.url);
    const rfqId = url.searchParams.get('rfqId') || undefined;
    const txs = await prisma.transaction.findMany({
        where: rfqId ? { canonicalTxKey: { contains: rfqId } } : undefined,
        orderBy: { preparedAt: 'desc' },
        take: 100,
    });

    return Response.json({
        status: 'success',
        data: txs.map((tx) => ({
            id: tx.id,
            transition: tx.transition,
            txId: tx.txHash ?? tx.idempotencyKey,
            txHash: tx.txHash,
            status: tx.status,
            blockHeight: tx.blockHeight ?? 0,
            eventType: tx.status,
            eventVersion: 1,
            processedAt: (tx.confirmedAt ?? tx.submittedAt ?? tx.preparedAt).toISOString(),
            preparedAt: tx.preparedAt,
            submittedAt: tx.submittedAt,
            confirmedAt: tx.confirmedAt,
            canonicalTxKey: tx.canonicalTxKey,
            rfqId,
        })),
    });
}
