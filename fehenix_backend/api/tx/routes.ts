/**
 * Transaction API Routes
 * 
 * GET /api/tx/:idempotencyKey - Get transaction status
 * GET /api/tx/canonical/:canonicalKey - Get all attempts for canonical action
 * GET /api/tx/history - Get transaction history
 * POST /api/tx/:idempotencyKey/retry - Retry failed transaction
 */

import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { TransactionTracker } from '../../tx/tracker';
import { requireAuth } from '../../auth/middleware';
import { ErrorClass } from '../../db/enums';
import { z } from 'zod';

const prisma = new PrismaClient();
const tracker = new TransactionTracker(prisma);

// ============================================================================
// GET /api/tx/:idempotencyKey
// ============================================================================

export async function handleGetTxStatus(
    request: NextRequest,
    idempotencyKey: string
): Promise<NextResponse> {
    // Require auth
    const authResult = await requireAuth(request);
    if (authResult instanceof NextResponse) {
        return authResult;
    }

    try {
        const tx = await tracker.getByIdempotencyKey(idempotencyKey);

        if (!tx) {
            return NextResponse.json(
                {
                    status: 'error',
                    error: { code: 'NOT_FOUND', message: 'Transaction not found' },
                },
                { status: 404 }
            );
        }

        // Check if user owns this transaction (via canonical key)
        // NOTE: Implement ownership check based on your business logic

        // Check if can retry
        const canRetry = await tracker.canRetry(idempotencyKey);
        const parsedHistory = (() => {
            try {
                return typeof tx.statusHistory === 'string'
                    ? JSON.parse(tx.statusHistory)
                    : tx.statusHistory;
            } catch {
                return [];
            }
        })();

        return NextResponse.json({
            status: 'success',
            data: {
                ...tx,
                statusHistory: parsedHistory,
                canRetry,
            },
        });
    } catch (error: any) {
        return NextResponse.json(
            {
                status: 'error',
                error: { code: 'INTERNAL_ERROR', message: error.message },
            },
            { status: 500 }
        );
    }
}

// ============================================================================
// GET /api/tx/canonical/:canonicalKey
// ============================================================================

export async function handleGetCanonicalTx(
    request: NextRequest,
    canonicalKey: string
): Promise<NextResponse> {
    const authResult = await requireAuth(request);
    if (authResult instanceof NextResponse) {
        return authResult;
    }

    try {
        const txs = await tracker.getByCanonicalKey(canonicalKey);

        return NextResponse.json({
            status: 'success',
            data: txs,
        });
    } catch (error: any) {
        return NextResponse.json(
            {
                status: 'error',
                error: { code: 'INTERNAL_ERROR', message: error.message },
            },
            { status: 500 }
        );
    }
}

// ============================================================================
// GET /api/tx/history
// ============================================================================

const HistoryQuerySchema = z.object({
    status: z.enum(['PREPARED', 'SUBMITTED', 'CONFIRMED', 'REJECTED', 'EXPIRED']).optional(),
    transition: z.string().optional(),
    limit: z.coerce.number().min(1).max(100).default(20),
    offset: z.coerce.number().min(0).default(0),
});

export async function handleGetTxHistory(request: NextRequest): Promise<NextResponse> {
    const authResult = await requireAuth(request);
    if (authResult instanceof NextResponse) {
        return authResult;
    }

    try {
        const url = new URL(request.url);
        const params = {
            status: url.searchParams.get('status') || undefined,
            transition: url.searchParams.get('transition') || undefined,
            limit: url.searchParams.get('limit') || '20',
            offset: url.searchParams.get('offset') || '0',
        };

        const query = HistoryQuerySchema.parse(params);

        // Build where clause
        const where: any = {};
        if (query.status) where.status = query.status;
        if (query.transition) where.transition = query.transition;

        // Fetch transactions
        const transactions = await prisma.transaction.findMany({
            where,
            orderBy: { preparedAt: 'desc' },
            take: query.limit,
            skip: query.offset,
        });

        return NextResponse.json({
            status: 'success',
            data: transactions,
        });
    } catch (error: any) {
        return NextResponse.json(
            {
                status: 'error',
                error: { code: 'VALIDATION_ERROR', message: error.message },
            },
            { status: 400 }
        );
    }
}

// ============================================================================
// POST /api/tx/:idempotencyKey/retry
// ============================================================================

export async function handleRetryTx(
    request: NextRequest,
    idempotencyKey: string
): Promise<NextResponse> {
    const authResult = await requireAuth(request);
    if (authResult instanceof NextResponse) {
        return authResult;
    }

    try {
        // Check if can retry
        const canRetry = await tracker.canRetry(idempotencyKey);
        if (!canRetry) {
            return NextResponse.json(
                {
                    status: 'error',
                    error: {
                        code: 'CANNOT_RETRY',
                        message: 'Transaction cannot be retried (max retries exceeded or not a retryable error)'
                    },
                },
                { status: 400 }
            );
        }

        // Get original transaction
        const originalTx = await tracker.getByIdempotencyKey(idempotencyKey);
        if (!originalTx) {
            return NextResponse.json(
                {
                    status: 'error',
                    error: { code: 'NOT_FOUND', message: 'Transaction not found' },
                },
                { status: 404 }
            );
        }

        // Create new attempt with new idempotency key
        const newIdempotencyKey = `${idempotencyKey}_retry_${originalTx.retryCount + 1}`;

        // Increment retry count
        await tracker.incrementRetry(idempotencyKey);

        // Return new idempotency key for client to track
        return NextResponse.json({
            status: 'success',
            data: {
                newIdempotencyKey,
                canonicalTxKey: originalTx.canonicalTxKey,
                message: 'Retry initiated. Please resubmit the transaction with the new idempotency key.',
            },
        });
    } catch (error: any) {
        return NextResponse.json(
            {
                status: 'error',
                error: { code: 'INTERNAL_ERROR', message: error.message },
            },
            { status: 500 }
        );
    }
}

const SubmitTxSchema = z.object({
    txHash: z.string().min(1),
    status: z.enum(['submitted', 'confirmed', 'rejected']).default('confirmed'),
    blockHeight: z.number().int().nonnegative().optional(),
    blockHash: z.string().optional(),
    error: z.string().optional(),
    rawResponse: z.any().optional(),
});

export async function handleSubmitTx(
    request: NextRequest,
    idempotencyKey: string
): Promise<NextResponse> {
    const authResult = await requireAuth(request);
    if (authResult instanceof NextResponse) {
        return authResult;
    }

    try {
        const body = await request.json();
        const data = SubmitTxSchema.parse(body);
        const existing = await tracker.getByIdempotencyKey(idempotencyKey);

        if (!existing) {
            return NextResponse.json(
                { status: 'error', error: { code: 'NOT_FOUND', message: 'Transaction not found' } },
                { status: 404 }
            );
        }

        if (existing.status === 'PREPARED') {
            await tracker.markSubmitted(idempotencyKey, data.txHash, data.rawResponse);
        }

        if (data.status === 'confirmed') {
            await tracker.markConfirmed(
                data.txHash,
                data.blockHeight ?? 0,
                data.blockHash ?? 'wallet_pending_block',
                data.rawResponse
            );
        } else if (data.status === 'rejected') {
            await tracker.markRejected(
                idempotencyKey,
                data.error || 'Wallet rejected transaction',
                400,
                ErrorClass.LOGICAL,
                data.rawResponse
            );
        }

        const updated = await tracker.getByIdempotencyKey(idempotencyKey);
        return NextResponse.json({ status: 'success', data: updated });
    } catch (error: any) {
        return NextResponse.json(
            { status: 'error', error: { code: 'VALIDATION_ERROR', message: error.message } },
            { status: 400 }
        );
    }
}
