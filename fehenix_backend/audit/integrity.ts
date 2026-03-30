/**
 * Audit log integrity helpers.
 * NOTE: This module is best-effort because the current Prisma schema does not
 * expose dedicated hash-chain columns on RFQEvent.
 */

import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

type LooseEvent = {
    id: string;
    eventType?: string;
    txId?: string;
    actor?: string;
    rfqId?: string | null;
    blockHeight?: number;
    eventIdx?: number;
    processedAt?: Date | string;
    eventData?: any;
    previousHash?: string | null;
    eventHash?: string | null;
};

function computeEventHash(event: LooseEvent, previousHash: string | null): string {
    const data = {
        eventType: event.eventType || null,
        txId: event.txId || null,
        actor: event.actor || null,
        rfqId: event.rfqId || null,
        blockHeight: event.blockHeight ?? null,
        eventIdx: event.eventIdx ?? null,
        processedAt:
            typeof event.processedAt === 'string'
                ? event.processedAt
                : event.processedAt?.toISOString() || null,
        eventData: event.eventData ?? null,
        previousHash,
    };
    return crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');
}

export async function createAuditEvent(eventData: Partial<LooseEvent>): Promise<LooseEvent> {
    const lastEvent = (await prisma.rFQEvent.findFirst({
        orderBy: [{ blockHeight: 'desc' }, { eventIdx: 'desc' }],
    })) as any;

    const previousHash = lastEvent?.eventHash || null;
    const eventHash = computeEventHash(eventData as LooseEvent, previousHash);

    const created = (await prisma.rFQEvent.create({
        data: {
            ...(eventData as any),
            previousHash,
            eventHash,
        },
    })) as any;

    return created as LooseEvent;
}

export async function validateHashChain(rfqId?: string): Promise<{
    valid: boolean;
    totalEvents: number;
    invalidEvents: string[];
}> {
    const events = (await prisma.rFQEvent.findMany({
        where: rfqId ? { rfqId } : {},
        orderBy: [{ blockHeight: 'asc' }, { eventIdx: 'asc' }],
    })) as any[];

    const invalidEvents: string[] = [];
    let previousHash: string | null = null;

    for (const event of events) {
        const expectedHash = computeEventHash(event, previousHash);

        if (event.eventHash && event.eventHash !== expectedHash) {
            invalidEvents.push(event.id);
        }
        if (event.previousHash && event.previousHash !== previousHash) {
            invalidEvents.push(event.id);
        }

        previousHash = event.eventHash || expectedHash;
    }

    return {
        valid: invalidEvents.length === 0,
        totalEvents: events.length,
        invalidEvents,
    };
}

export async function reconstructRFQState(rfqId: string): Promise<any> {
    const events = (await prisma.rFQEvent.findMany({
        where: { rfqId },
        orderBy: [{ blockHeight: 'asc' }, { eventIdx: 'asc' }],
    })) as any[];

    const state: any = {};

    for (const event of events) {
        const eventData = event.eventData || {};
        switch (event.eventType) {
            case 'RFQ_CREATED':
                state.id = rfqId;
                state.buyer = event.actor || eventData.buyer || null;
                state.status = 'OPEN';
                Object.assign(state, eventData);
                break;
            case 'BID_REVEALED':
                if (!state.status || state.status === 'OPEN') {
                    state.status = 'REVEAL';
                }
                break;
            case 'WINNER_SELECTED':
                state.status = 'WINNER_SELECTED';
                state.winningVendor = eventData.winningVendor || state.winningVendor || null;
                state.winningBidAmount = eventData.winningBidAmount || state.winningBidAmount || null;
                break;
            case 'ESCROW_FUNDED':
                state.status = 'ESCROW_FUNDED';
                break;
            case 'PAYMENT_RELEASED':
                state.paymentsReleased = (state.paymentsReleased || 0) + Number(eventData.amount || 0);
                break;
            default:
                break;
        }
    }

    return state;
}
