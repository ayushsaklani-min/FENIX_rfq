/**
 * Batch Transaction Status API
 */

import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { txIds } = body as { txIds?: string[] };

        if (!Array.isArray(txIds) || txIds.length === 0) {
            return NextResponse.json(
                { status: 'error', error: { code: 'INVALID_INPUT', message: 'txIds must be a non-empty array' } },
                { status: 400 }
            );
        }

        if (txIds.length > 50) {
            return NextResponse.json(
                { status: 'error', error: { code: 'BATCH_TOO_LARGE', message: 'Maximum 50 transactions per batch' } },
                { status: 400 }
            );
        }

        const transactions = await prisma.transaction.findMany({
            where: {
                idempotencyKey: { in: txIds },
            },
            select: {
                id: true,
                idempotencyKey: true,
                status: true,
                preparedAt: true,
                submittedAt: true,
                confirmedAt: true,
                rejectedAt: true,
                expiredAt: true,
                blockHeight: true,
                error: true,
                errorCode: true,
            },
        });

        const statusMap: Record<string, any> = {};

        for (const tx of transactions) {
            statusMap[tx.idempotencyKey] = {
                id: tx.id,
                status: tx.status,
                preparedAt: tx.preparedAt,
                submittedAt: tx.submittedAt,
                confirmedAt: tx.confirmedAt,
                rejectedAt: tx.rejectedAt,
                expiredAt: tx.expiredAt,
                blockHeight: tx.blockHeight,
                error: tx.error,
                errorCode: tx.errorCode,
            };
        }

        for (const txId of txIds) {
            if (!statusMap[txId]) {
                statusMap[txId] = { status: 'NOT_FOUND' };
            }
        }

        return NextResponse.json({
            status: 'success',
            data: statusMap,
        });
    } catch (error) {
        console.error('Batch status fetch error:', error);
        return NextResponse.json(
            { status: 'error', error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch batch status' } },
            { status: 500 }
        );
    }
}
