/**
 * Transaction Tracker with Strict State Machine
 * 
 * STEP 4 Requirements:
 * 1. Strict state machine: prepared -> submitted -> confirmed | rejected | expired
 * 2. One-way transitions only (no backward moves)
 * 3. Dual idempotency keys
 * 4. Raw response persistence
 * 5. Reconciliation support
 */

import { PrismaClient } from '@prisma/client';
import { TxStatus, ErrorClass } from '../db/enums';
import type { PreparedTransaction } from '../lib/types';

// ============================================================================
// State Machine
// ============================================================================

/**
 * Valid state transitions (REQUIREMENT 2: one-way only)
 */
const VALID_TRANSITIONS: Record<TxStatus, TxStatus[]> = {
    PREPARED: [TxStatus.SUBMITTED, TxStatus.EXPIRED],
    SUBMITTED: [TxStatus.CONFIRMED, TxStatus.REJECTED, TxStatus.EXPIRED],
    CONFIRMED: [], // Terminal state
    REJECTED: [],  // Terminal state
    EXPIRED: [],   // Terminal state
};

/**
 * Check if state transition is valid
 */
function isValidTransition(from: TxStatus, to: TxStatus): boolean {
    return VALID_TRANSITIONS[from].includes(to);
}

// ============================================================================
// Transaction Tracker
// ============================================================================

export class TransactionTracker {
    constructor(private prisma: PrismaClient) { }

    /**
     * Create transaction in PREPARED state
     * 
     * REQUIREMENT 3: Dual idempotency
     * - idempotencyKey: per submission attempt (stays same on retry)
     * - canonicalTxKey: per logical action (e.g., "create_rfq:12345field")
     */
    async prepare(
        transaction: PreparedTransaction,
        canonicalTxKey: string,
        idempotencyKey: string,
        expiresInMs: number = 300000 // 5 minutes default
    ): Promise<string> {
        // Atomic create: if a concurrent request already inserted the same
        // idempotencyKey, the unique constraint raises P2002 and we fall back
        // to a read.  This eliminates the check-then-create race condition.
        try {
            const tx = await this.prisma.transaction.create({
                data: {
                    idempotencyKey,
                    canonicalTxKey,
                    transition: transaction.function,
                    programId: transaction.program,
                    status: TxStatus.PREPARED,
                    statusHistory: JSON.stringify([
                        { status: TxStatus.PREPARED, timestamp: new Date().toISOString() },
                    ]),
                    expiresAt: new Date(Date.now() + expiresInMs),
                },
            });
            return tx.id;
        } catch (error: any) {
            // P2002 = Prisma unique constraint violation
            if (error?.code === 'P2002') {
                const existing = await this.prisma.transaction.findUnique({
                    where: { idempotencyKey },
                });
                if (existing) return existing.id;
            }
            throw error;
        }
    }

    /**
     * Mark transaction as SUBMITTED
     */
    async markSubmitted(
        idempotencyKey: string,
        txHash: string,
        rawResponse?: any
    ): Promise<void> {
        const tx = await this.prisma.transaction.findUnique({
            where: { idempotencyKey },
        });

        if (!tx) {
            throw new Error(`Transaction not found: ${idempotencyKey}`);
        }

        // Validate transition
        if (!isValidTransition(tx.status as TxStatus, TxStatus.SUBMITTED)) {
            throw new Error(`Invalid transition: ${tx.status} -> SUBMITTED`);
        }

        // Update status
        await this.updateStatus(tx.id, TxStatus.SUBMITTED, {
            txHash,
            submittedAt: new Date(),
            rawResponse: rawResponse ? JSON.stringify(rawResponse) : null,
        });
    }

    /**
     * Mark transaction as CONFIRMED
     */
    async markConfirmed(
        txHash: string,
        blockHeight: number,
        blockHash: string,
        rawResponse?: any
    ): Promise<void> {
        const tx = await this.prisma.transaction.findUnique({
            where: { txHash },
        });

        if (!tx) {
            throw new Error(`Transaction not found: ${txHash}`);
        }

        // Validate transition
        if (!isValidTransition(tx.status as TxStatus, TxStatus.CONFIRMED)) {
            throw new Error(`Invalid transition: ${tx.status} -> CONFIRMED`);
        }

        // Update status
        await this.updateStatus(tx.id, TxStatus.CONFIRMED, {
            confirmedAt: new Date(),
            blockHeight,
            blockHash,
            rawResponse: rawResponse ? JSON.stringify(rawResponse) : null,
        });
    }

    /**
     * Mark transaction as REJECTED
     */
    async markRejected(
        idempotencyKey: string,
        error: string,
        errorCode: number,
        errorClass: ErrorClass,
        rawResponse?: any
    ): Promise<void> {
        const tx = await this.prisma.transaction.findUnique({
            where: { idempotencyKey },
        });

        if (!tx) {
            throw new Error(`Transaction not found: ${idempotencyKey}`);
        }

        // Validate transition
        if (!isValidTransition(tx.status as TxStatus, TxStatus.REJECTED)) {
            throw new Error(`Invalid transition: ${tx.status} -> REJECTED`);
        }

        // Update status
        await this.updateStatus(tx.id, TxStatus.REJECTED, {
            rejectedAt: new Date(),
            error,
            errorCode,
            errorClass,
            rawResponse: rawResponse ? JSON.stringify(rawResponse) : null,
        });
    }

    /**
     * Mark transaction as EXPIRED
     */
    async markExpired(idempotencyKey: string): Promise<void> {
        const tx = await this.prisma.transaction.findUnique({
            where: { idempotencyKey },
        });

        if (!tx) {
            throw new Error(`Transaction not found: ${idempotencyKey}`);
        }

        // Validate transition
        if (!isValidTransition(tx.status as TxStatus, TxStatus.EXPIRED)) {
            throw new Error(`Invalid transition: ${tx.status} -> EXPIRED`);
        }

        // Update status
        await this.updateStatus(tx.id, TxStatus.EXPIRED, {
            expiredAt: new Date(),
        });
    }

    /**
     * Update status with one-way enforcement
     */
    private async updateStatus(
        txId: string,
        newStatus: TxStatus,
        updates: any
    ): Promise<void> {
        const tx = await this.prisma.transaction.findUnique({ where: { id: txId } });
        if (!tx) throw new Error(`Transaction not found: ${txId}`);

        // Append to status history
        const history = (() => {
            try {
                return typeof tx.statusHistory === 'string'
                    ? JSON.parse(tx.statusHistory)
                    : Array.isArray(tx.statusHistory)
                      ? tx.statusHistory
                      : [];
            } catch {
                return [];
            }
        })();
        const newHistory = [
            ...history,
            { status: newStatus, timestamp: new Date().toISOString() },
        ];

        // Update
        await this.prisma.transaction.update({
            where: { id: txId },
            data: {
                status: newStatus,
                statusHistory: JSON.stringify(newHistory),
                ...updates,
            },
        });
    }

    /**
     * Get transaction by idempotency key
     */
    async getByIdempotencyKey(idempotencyKey: string) {
        return await this.prisma.transaction.findUnique({
            where: { idempotencyKey },
        });
    }

    /**
     * Get transaction by canonical key (may return multiple if retried)
     */
    async getByCanonicalKey(canonicalTxKey: string) {
        return await this.prisma.transaction.findMany({
            where: { canonicalTxKey },
            orderBy: { preparedAt: 'desc' },
        });
    }

    /**
     * Get transaction by tx hash
     */
    async getByTxHash(txHash: string) {
        return await this.prisma.transaction.findUnique({
            where: { txHash },
        });
    }

    /**
     * Increment retry count
     */
    async incrementRetry(idempotencyKey: string): Promise<void> {
        const tx = await this.prisma.transaction.findUnique({
            where: { idempotencyKey },
        });

        if (!tx) throw new Error(`Transaction not found: ${idempotencyKey}`);

        await this.prisma.transaction.update({
            where: { idempotencyKey },
            data: {
                retryCount: { increment: 1 },
                lastRetryAt: new Date(),
            },
        });
    }

    /**
     * Check if transaction can be retried
     */
    async canRetry(idempotencyKey: string): Promise<boolean> {
        const tx = await this.prisma.transaction.findUnique({
            where: { idempotencyKey },
        });

        if (!tx) return false;

        // Can only retry REJECTED transactions with TRANSIENT errors
        if (tx.status !== TxStatus.REJECTED) return false;
        if (tx.errorClass !== ErrorClass.TRANSIENT && tx.errorClass !== ErrorClass.NETWORK) return false;
        if (tx.retryCount >= tx.maxRetries) return false;

        return true;
    }

    /**
     * Classify error for retry decision
     */
    classifyError(error: string): ErrorClass {
        const errorLower = error.toLowerCase();

        // Transient errors
        if (errorLower.includes('timeout') || errorLower.includes('rate limit')) {
            return ErrorClass.TRANSIENT;
        }

        // Network errors
        if (errorLower.includes('network') || errorLower.includes('connection')) {
            return ErrorClass.NETWORK;
        }

        // Logical errors (contract validation)
        if (errorLower.includes('assertion') || errorLower.includes('invalid')) {
            return ErrorClass.LOGICAL;
        }

        return ErrorClass.UNKNOWN;
    }

    /**
     * Expire old transactions
     */
    async expireOldTransactions(): Promise<number> {
        const now = new Date();

        // Find expired transactions
        const expired = await this.prisma.transaction.findMany({
            where: {
                status: { in: [TxStatus.PREPARED, TxStatus.SUBMITTED] },
                expiresAt: { lte: now },
            },
        });

        // Mark as expired
        for (const tx of expired) {
            try {
                await this.markExpired(tx.idempotencyKey);
            } catch (error) {
                console.error(`Failed to expire tx ${tx.id}:`, error);
            }
        }

        return expired.length;
    }
}
