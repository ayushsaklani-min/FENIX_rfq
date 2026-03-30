import { NextRequest, NextResponse } from 'next/server';
import { keccak256, solidityPacked } from 'ethers';
import { z } from 'zod';
import { requireRole } from '../../../auth/middleware';
import { getFhenixClients } from '../../../lib/fhenixClient';
import {
    syncIndexedRfq,
    syncIndexedRfqBid,
    syncIndexedRfqBidsFromChain,
    syncIndexedRfqEscrow,
    syncIndexedRfqWinnerFlags,
} from '../../../lib/fhenixIndexing';
import { prisma } from '../../../lib/prismaClient';
import {
    addressSchema,
    bytes32Schema,
    FHENIX_STATUS_LABELS,
    hexBytesRegex,
    randomBytes32Hex,
    toEncryptedUint64Tuple,
    type EncryptedUint64Input,
    u64StringSchema,
} from '../../../lib/fhenixProtocol';

const uint256LikeSchema = z.union([z.number().int().nonnegative(), z.string().regex(/^\d+$/)]);
const permitSchema = z.object({
    deadline: uint256LikeSchema,
    v: z.number().int().min(0).max(255),
    r: z.string().regex(hexBytesRegex, 'r must be hex bytes'),
    s: z.string().regex(hexBytesRegex, 's must be hex bytes'),
});

const CreateRfqSchema = z.object({
    rfqId: bytes32Schema.optional(),
    salt: bytes32Schema,
    biddingDeadline: z.number().int().positive(),
    revealDeadline: z.number().int().positive(),
    minBid: u64StringSchema,
    minBidCount: u64StringSchema,
    metadataHash: bytes32Schema,
    tokenType: z.number().int().min(0).max(1),
    mode: z.number().int().min(0).max(2),
    itemName: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(2000).optional(),
    quantity: z.string().trim().max(100).optional(),
    unit: z.string().trim().max(100).optional(),
    txHash: z.string().optional(),
});

const SubmitBidSchema = z.object({
    bidId: bytes32Schema.optional(),
    encryptedBid: z.object({
        ctHash: z.string().regex(/^\d+$/),
        securityZone: z.number().int().min(0).max(255),
        utype: z.number().int().min(0).max(255),
        signature: z.string().regex(hexBytesRegex, 'signature must be hex bytes'),
    }),
    permit: permitSchema.optional(),
    txHash: z.string().optional(),
});

const PublishLowestBidSchema = z.object({
    plaintext: u64StringSchema,
    signature: z.string().regex(hexBytesRegex, 'signature must be hex bytes'),
    txHash: z.string().optional(),
});

const SelectWinnerSchema = z.object({
    bidId: bytes32Schema,
    plaintext: u64StringSchema,
    signature: z.string().regex(hexBytesRegex, 'signature must be hex bytes'),
    txHash: z.string().optional(),
});

const WinnerRespondSchema = z.object({
    accept: z.boolean(),
    txHash: z.string().optional(),
});

const FundEscrowSchema = z.object({
    tokenType: z.number().int().min(0).max(1),
    amount: u64StringSchema,
    permit: permitSchema.optional(),
    txHash: z.string().optional(),
});

const ReleasePaymentSchema = z.object({
    percentage: z.number().int().min(1).max(100),
    txHash: z.string().optional(),
});

const ImportAuctionSchema = z.object({
    auctionId: bytes32Schema,
    auctionType: z.number().int().min(1).max(2),
    auctionContract: addressSchema.optional(),
    txHash: z.string().optional(),
});

const ConfirmTransferSchema = z.object({
    transferId: bytes32Schema,
    success: z.boolean(),
    signature: z.string().regex(hexBytesRegex, 'signature must be hex bytes'),
    bidId: bytes32Schema.optional(),
    txHash: z.string().optional(),
});

const INVOICE_STATUS_LABELS: Record<number, string> = {
    0: 'NONE',
    1: 'PENDING',
    2: 'PAID',
    3: 'COMPLETED',
    4: 'CANCELLED',
    5: 'REFUNDED',
};

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const STATUS_CODE_BY_LABEL = Object.fromEntries(
    Object.entries(FHENIX_STATUS_LABELS).map(([code, label]) => [label, Number(code)]),
) as Record<string, number>;

function badRequest(message: string) {
    return NextResponse.json({ status: 'error', error: { code: 'VALIDATION_ERROR', message } }, { status: 400 });
}

function serverError(message: string) {
    return NextResponse.json({ status: 'error', error: { code: 'SERVER_ERROR', message } }, { status: 500 });
}

function deriveRfqId(walletAddress: string, salt: string): string {
    return keccak256(solidityPacked(['address', 'bytes32'], [walletAddress, salt]));
}

function normalizeEncryptedBid(input: EncryptedUint64Input) {
    return toEncryptedUint64Tuple(input);
}

function toUint256(value: number | string): bigint {
    return typeof value === 'number' ? BigInt(value) : BigInt(value);
}

function getPermitArgs(permit: z.infer<typeof permitSchema>) {
    return [toUint256(permit.deadline), permit.v, permit.r, permit.s] as const;
}

async function buildTxRequest(
    to: string,
    data: string,
    value: bigint | number = 0n,
): Promise<{ to: string; data: string; value: string; chainId: number }> {
    const { chainId } = getFhenixClients();
    return {
        to,
        data,
        value: BigInt(value).toString(),
        chainId,
    };
}

async function getRfqSnapshot(rfqId: string) {
    const { sealRfq } = getFhenixClients();
    const [
        rfq,
        statusCode,
        winnerBidId,
        escrow,
        auctionSource,
        invoiceReceipt,
        importedPrice,
        lowestEncryptedBidCtHash,
        lowestBidReveal,
        bidIds,
        platformConfig,
        token1Address,
        token2Address,
    ] = await Promise.all([
        sealRfq.getRFQ(rfqId),
        sealRfq.getRfqStatus(rfqId),
        sealRfq.winnerBids(rfqId),
        sealRfq.getEscrow(rfqId),
        sealRfq.auctionSource(rfqId),
        sealRfq.invoiceReceipts(rfqId),
        sealRfq.importedWinnerPrice(rfqId),
        sealRfq.lowestEncryptedBid(rfqId),
        sealRfq.getLowestBidReveal(rfqId),
        sealRfq.getBidIds(rfqId),
        sealRfq.platformConfig(),
        sealRfq.token1(),
        sealRfq.token2(),
    ]);

    const normalizedWinnerBidId = String(winnerBidId);
    const winnerBid =
        normalizedWinnerBidId !== '0x' + '0'.repeat(64)
            ? await sealRfq.bids(rfqId, normalizedWinnerBidId)
            : null;

    const creator = String(rfq.creator);
    if (creator === '0x0000000000000000000000000000000000000000') {
        return null;
    }

    return {
        id: rfqId,
        creator,
        biddingDeadline: Number(rfq.biddingDeadline),
        revealDeadline: Number(rfq.revealDeadline),
        minBid: BigInt(rfq.minBid).toString(),
        minBidCount: BigInt(rfq.minBidCount).toString(),
        flatStake: BigInt(rfq.flatStake).toString(),
        metadataHash: String(rfq.metadataHash),
        tokenType: Number(rfq.escrowToken),
        mode: Number(rfq.mode),
        statusCode: Number(statusCode),
        status: FHENIX_STATUS_LABELS[Number(statusCode)] ?? 'UNKNOWN',
        bidCount: BigInt(rfq.bidCount).toString(),
        winnerAddress: String(rfq.winnerAddress),
        lifecycleBlock: Number(rfq.lifecycleBlock),
        winnerAccepted: Boolean(rfq.winnerAccepted),
        paid: Boolean(rfq.paid),
        finalPaymentReleased: Boolean(rfq.finalPaymentReleased),
        winnerBidId: normalizedWinnerBidId,
        winningVendor: String(rfq.winnerAddress),
        winningBidAmount: winnerBid ? BigInt(winnerBid.revealedAmount).toString() : '0',
        auctionSource: String(auctionSource),
        invoiceReceipt: String(invoiceReceipt),
        importedWinnerPrice: BigInt(importedPrice).toString(),
        lowestEncryptedBidCtHash: String(lowestEncryptedBidCtHash),
        lowestPublishedBid: BigInt(lowestBidReveal.amount).toString(),
        lowestBidPublished: Boolean(lowestBidReveal.published),
        bidIds: bidIds.map((bidId: string) => String(bidId)),
        tokenAddress: String(rfq.escrowToken) === '0' ? String(token1Address) : String(token2Address),
        feeBps: Number(platformConfig.feeBps),
        escrow: {
            originalAmount: BigInt(escrow.originalAmount).toString(),
            currentAmount: BigInt(escrow.currentAmount).toString(),
            totalReleased: BigInt(escrow.totalReleased).toString(),
        },
    };
}

function getStatusCode(status: string): number {
    return STATUS_CODE_BY_LABEL[status] ?? 0;
}

function serializeIndexedRfqListItem(
    rfq: {
        id: string;
        itemName: string | null;
        description: string | null;
        quantity: string | null;
        unit: string | null;
        status: string;
        tokenType: number;
        pricingMode: number;
        minBid: bigint;
        biddingDeadline: number;
        revealDeadline: number;
        paid: boolean;
        auctionSource: string | null;
        _count: { bids: number };
    },
) {
    return {
        id: rfq.id,
        itemName: rfq.itemName,
        description: rfq.description,
        quantity: rfq.quantity,
        unit: rfq.unit,
        status: rfq.status,
        statusCode: getStatusCode(rfq.status),
        tokenType: rfq.tokenType,
        pricingMode: rfq.pricingMode,
        minBid: rfq.minBid.toString(),
        biddingDeadline: rfq.biddingDeadline,
        revealDeadline: rfq.revealDeadline,
        bidCount: String(rfq._count.bids),
        minBidCount: null,
        paid: rfq.paid,
        auctionSource: rfq.auctionSource,
    };
}

async function filterLiveIndexedRfqs<T extends {
    id: string;
    itemName: string | null;
    description: string | null;
    quantity: string | null;
    unit: string | null;
    status: string;
    tokenType: number;
    pricingMode: number;
    minBid: bigint;
    biddingDeadline: number;
    revealDeadline: number;
    paid: boolean;
    auctionSource: string | null;
    _count: { bids: number };
}>(
    rfqs: T[],
    options?: { creator?: string; onlyBidding?: boolean },
) {
    const snapshots = await Promise.all(
        rfqs.map(async (rfq) => ({ rfq, snapshot: await getRfqSnapshot(rfq.id) })),
    );

    return snapshots
        .filter(({ snapshot }) => snapshot !== null)
        .filter(({ snapshot }) => !options?.creator || snapshot!.creator.toLowerCase() === options.creator.toLowerCase())
        .filter(({ snapshot }) => !options?.onlyBidding || snapshot!.status === 'BIDDING')
        .map(({ rfq, snapshot }) => ({
            ...serializeIndexedRfqListItem(rfq),
            status: snapshot!.status,
            statusCode: snapshot!.statusCode,
            tokenType: snapshot!.tokenType,
            pricingMode: snapshot!.mode,
            minBid: snapshot!.minBid,
            biddingDeadline: snapshot!.biddingDeadline,
            revealDeadline: snapshot!.revealDeadline,
            bidCount: snapshot!.bidCount,
            minBidCount: snapshot!.minBidCount,
            paid: snapshot!.paid,
            auctionSource:
                snapshot!.auctionSource && snapshot!.auctionSource !== ZERO_ADDRESS
                    ? snapshot!.auctionSource
                    : rfq.auctionSource,
        }));
}

export async function handleFhenixCreateRFQ(request: NextRequest) {
    const auth = await requireRole(request, ['BUYER', 'NEW_USER']);
    if (auth instanceof NextResponse) return auth;

    try {
        const data = CreateRfqSchema.parse(await request.json());
        const { sealRfq, provider } = getFhenixClients();

        const currentBlock = await provider.getBlockNumber();
        if (data.biddingDeadline <= currentBlock) {
            return badRequest(`Bidding deadline must be greater than current block ${currentBlock}.`);
        }
        if (data.revealDeadline <= data.biddingDeadline) {
            return badRequest('Reveal deadline must be greater than bidding deadline.');
        }

        const derivedRfqId = deriveRfqId(auth.walletAddress, data.salt);
        if (data.rfqId && data.rfqId.toLowerCase() !== derivedRfqId.toLowerCase()) {
            return badRequest('Supplied rfqId does not match keccak256(wallet, salt).');
        }

        if (!data.txHash) {
            const tx = await sealRfq.createRFQ.populateTransaction(
                derivedRfqId,
                data.salt,
                data.biddingDeadline,
                data.revealDeadline,
                BigInt(data.minBid),
                BigInt(data.minBidCount),
                data.metadataHash,
                data.tokenType,
                data.mode,
            );

            return NextResponse.json({
                status: 'success',
                data: {
                    rfqId: derivedRfqId,
                    tx: await buildTxRequest(tx.to as string, tx.data as string),
                },
            });
        }

        await syncIndexedRfq(
            derivedRfqId,
            {
                txHash: data.txHash,
                itemName: data.itemName ?? null,
                description: data.description ?? null,
                quantity: data.quantity ?? null,
                unit: data.unit ?? null,
            },
            prisma,
        );

        return NextResponse.json({ status: 'success', data: { rfqId: derivedRfqId, txHash: data.txHash } });
    } catch (error: any) {
        return badRequest(error.message || 'Invalid request payload');
    }
}

export async function handleFhenixGetRFQ(request: NextRequest, rfqId: string) {
    const auth = await requireRole(request, ['BUYER', 'VENDOR', 'AUDITOR', 'NEW_USER']);
    if (auth instanceof NextResponse) return auth;

    if (!bytes32Schema.safeParse(rfqId).success) {
        return badRequest('Invalid rfqId format.');
    }

    try {
        const snapshot = await getRfqSnapshot(rfqId);
        if (!snapshot) {
            return NextResponse.json(
                { status: 'error', error: { code: 'NOT_FOUND', message: 'RFQ not found' } },
                { status: 404 },
            );
        }

        return NextResponse.json({ status: 'success', data: snapshot });
    } catch (error: any) {
        return serverError(error.message || 'Failed to fetch RFQ state');
    }
}

export async function handleFhenixGetMyRFQs(request: NextRequest) {
    const auth = await requireRole(request, ['BUYER', 'NEW_USER']);
    if (auth instanceof NextResponse) return auth;

    try {
        const rfqs = await prisma.rFQ.findMany({
            where: { buyer: auth.walletAddress },
            orderBy: { createdAt: 'desc' },
            select: {
                id: true,
                itemName: true,
                description: true,
                quantity: true,
                unit: true,
                status: true,
                tokenType: true,
                pricingMode: true,
                minBid: true,
                biddingDeadline: true,
                revealDeadline: true,
                paid: true,
                auctionSource: true,
                _count: {
                    select: {
                        bids: true,
                    },
                },
            },
        });

        const liveRfqs = await filterLiveIndexedRfqs(rfqs, { creator: auth.walletAddress });

        return NextResponse.json({
            status: 'success',
            data: liveRfqs,
        });
    } catch (error: any) {
        return serverError(error.message || 'Failed to fetch indexed RFQs');
    }
}

export async function handleFhenixListOpenRFQs(request: NextRequest) {
    const auth = await requireRole(request, ['BUYER', 'VENDOR', 'AUDITOR', 'NEW_USER']);
    if (auth instanceof NextResponse) return auth;

    try {
        const { provider } = getFhenixClients();
        const currentBlock = await provider.getBlockNumber();
        const rfqs = await prisma.rFQ.findMany({
            where: {
                status: 'BIDDING',
                biddingDeadline: { gt: Number(currentBlock) },
            },
            orderBy: { createdAt: 'desc' },
            select: {
                id: true,
                itemName: true,
                description: true,
                quantity: true,
                unit: true,
                status: true,
                tokenType: true,
                pricingMode: true,
                minBid: true,
                biddingDeadline: true,
                revealDeadline: true,
                paid: true,
                auctionSource: true,
                _count: {
                    select: {
                        bids: true,
                    },
                },
            },
        });

        const liveRfqs = await filterLiveIndexedRfqs(rfqs, { onlyBidding: true });

        return NextResponse.json({
            status: 'success',
            data: liveRfqs,
        });
    } catch (error: any) {
        return serverError(error.message || 'Failed to fetch open RFQs');
    }
}

export async function handleFhenixGetMyBids(request: NextRequest) {
    const auth = await requireRole(request, ['VENDOR', 'NEW_USER']);
    if (auth instanceof NextResponse) return auth;

    try {
        const bids = await prisma.bid.findMany({
            where: { vendor: auth.walletAddress },
            orderBy: { createdAt: 'desc' },
            select: {
                id: true,
                rfqId: true,
                vendor: true,
                commitmentHash: true,
                stake: true,
                isRevealed: true,
                revealedAmount: true,
                isWinner: true,
                rfq: {
                    select: {
                        itemName: true,
                        description: true,
                        status: true,
                        tokenType: true,
                        pricingMode: true,
                        biddingDeadline: true,
                        revealDeadline: true,
                        winnerAccepted: true,
                    },
                },
            },
        });

        return NextResponse.json({
            status: 'success',
            data: bids.map((bid) => ({
                rfqId: bid.rfqId,
                bidId: bid.id,
                owner: bid.vendor,
                encryptedAmountCtHash: bid.commitmentHash,
                stake: bid.stake.toString(),
                revealed: bid.isRevealed,
                revealedAmount: bid.revealedAmount?.toString() ?? '0',
                rfq: {
                    status: bid.rfq.status,
                    statusCode: getStatusCode(bid.rfq.status),
                    tokenType: bid.rfq.tokenType,
                    mode: bid.rfq.pricingMode,
                    biddingDeadline: bid.rfq.biddingDeadline,
                    revealDeadline: bid.rfq.revealDeadline,
                    winnerAddress: bid.isWinner ? bid.vendor : ZERO_ADDRESS,
                    winnerAccepted: bid.rfq.winnerAccepted,
                },
                itemName: bid.rfq.itemName,
                description: bid.rfq.description,
            })),
        });
    } catch (error: any) {
        return serverError(error.message || 'Failed to fetch vendor bids');
    }
}

export async function handleFhenixListRfqInvoices(request: NextRequest, rfqId: string) {
    const auth = await requireRole(request, ['BUYER', 'VENDOR', 'AUDITOR', 'NEW_USER']);
    if (auth instanceof NextResponse) return auth;

    if (!bytes32Schema.safeParse(rfqId).success) {
        return badRequest('Invalid rfqId format.');
    }

    try {
        const { sealInvoice } = getFhenixClients();
        const invoiceIds = await sealInvoice.getRfqInvoices(rfqId);
        const zeroBytes32 = '0x' + '0'.repeat(64);

        const invoices = await Promise.all(
            invoiceIds.map(async (invoiceId: string) => {
                const [invoice, receiptId] = await Promise.all([
                    sealInvoice.getInvoice(invoiceId),
                    sealInvoice.invoiceToReceipt(invoiceId),
                ]);

                const normalizedReceiptId = String(receiptId);
                const receipt =
                    normalizedReceiptId !== zeroBytes32
                        ? await sealInvoice.getReceipt(normalizedReceiptId)
                        : null;

                return {
                    invoiceId: String(invoice.invoiceId),
                    payer: String(invoice.payer),
                    payee: String(invoice.payee),
                    token: String(invoice.token),
                    amount: BigInt(invoice.amount).toString(),
                    rfqId: String(invoice.rfqId),
                    orderId: String(invoice.orderId),
                    statusCode: Number(invoice.status),
                    status: INVOICE_STATUS_LABELS[Number(invoice.status)] ?? 'UNKNOWN',
                    createdAt: Number(invoice.createdAt),
                    paidAt: Number(invoice.paidAt),
                    descriptionHash: String(invoice.descriptionHash),
                    receiptId: normalizedReceiptId,
                    receipt: receipt
                        ? {
                              receiptId: String(receipt.receiptId),
                              invoiceId: String(receipt.invoiceId),
                              payer: String(receipt.payer),
                              payee: String(receipt.payee),
                              token: String(receipt.token),
                              amount: BigInt(receipt.amount).toString(),
                              timestamp: Number(receipt.timestamp),
                              txHash: String(receipt.txHash),
                          }
                        : null,
                };
            }),
        );

        return NextResponse.json({ status: 'success', data: invoices });
    } catch (error: any) {
        return serverError(error.message || 'Failed to fetch linked RFQ invoices');
    }
}

export async function handleFhenixListBids(request: NextRequest, rfqId: string) {
    const auth = await requireRole(request, ['BUYER', 'VENDOR', 'AUDITOR', 'NEW_USER']);
    if (auth instanceof NextResponse) return auth;

    if (!bytes32Schema.safeParse(rfqId).success) {
        return badRequest('Invalid rfqId format.');
    }

    try {
        const { sealRfq } = getFhenixClients();
        const bidIds = await sealRfq.getBidIds(rfqId);
        const bids = await Promise.all(
            bidIds.map(async (bidId: string) => {
                const bid = await sealRfq.bids(rfqId, bidId);
                return {
                    bidId: String(bidId),
                    owner: String(bid.owner),
                    encryptedAmountCtHash: String(bid.encryptedAmount),
                    stake: BigInt(bid.stake).toString(),
                    revealed: Boolean(bid.revealed),
                    revealedAmount: BigInt(bid.revealedAmount).toString(),
                };
            }),
        );

        return NextResponse.json({ status: 'success', data: bids });
    } catch (error: any) {
        return serverError(error.message || 'Failed to fetch RFQ bids');
    }
}

export async function handleFhenixGetBid(request: NextRequest, rfqId: string, bidId: string) {
    const auth = await requireRole(request, ['BUYER', 'VENDOR', 'AUDITOR', 'NEW_USER']);
    if (auth instanceof NextResponse) return auth;

    if (!bytes32Schema.safeParse(rfqId).success || !bytes32Schema.safeParse(bidId).success) {
        return badRequest('Invalid RFQ or bid identifier.');
    }

    try {
        const { sealRfq } = getFhenixClients();
        const bid = await sealRfq.bids(rfqId, bidId);

        const owner = String(bid.owner);
        if (owner === '0x0000000000000000000000000000000000000000') {
            return NextResponse.json(
                { status: 'error', error: { code: 'NOT_FOUND', message: 'Bid not found' } },
                { status: 404 },
            );
        }

        return NextResponse.json({
            status: 'success',
            data: {
                rfqId,
                bidId,
                owner,
                encryptedAmountCtHash: String(bid.encryptedAmount),
                stake: BigInt(bid.stake).toString(),
                revealed: Boolean(bid.revealed),
                revealedAmount: BigInt(bid.revealedAmount).toString(),
            },
        });
    } catch (error: any) {
        return serverError(error.message || 'Failed to fetch bid');
    }
}

export async function handleFhenixSubmitBid(request: NextRequest, rfqId: string) {
    const auth = await requireRole(request, ['VENDOR', 'NEW_USER']);
    if (auth instanceof NextResponse) return auth;

    if (!bytes32Schema.safeParse(rfqId).success) {
        return badRequest('Invalid rfqId format.');
    }

    try {
        const data = SubmitBidSchema.parse(await request.json());
        const { sealRfq } = getFhenixClients();
        const bidId = data.bidId ?? randomBytes32Hex();
        const encryptedBid = normalizeEncryptedBid(data.encryptedBid);

        if (!data.txHash) {
            const tx = data.permit
                ? await sealRfq.permitAndSubmitBid.populateTransaction(
                      rfqId,
                      bidId,
                      encryptedBid,
                      ...getPermitArgs(data.permit),
                  )
                : await sealRfq.submitBid.populateTransaction(rfqId, bidId, encryptedBid);

            return NextResponse.json({
                status: 'success',
                data: {
                    bidId,
                    usesPermit: Boolean(data.permit),
                    tx: await buildTxRequest(tx.to as string, tx.data as string),
                },
            });
        }

        await syncIndexedRfq(rfqId, undefined, prisma);

        return NextResponse.json({ status: 'success', data: { rfqId, bidId, txHash: data.txHash } });
    } catch (error: any) {
        return badRequest(error.message || 'Invalid request payload');
    }
}

export async function handleFhenixCloseBidding(request: NextRequest, rfqId: string) {
    const auth = await requireRole(request, ['BUYER', 'VENDOR', 'NEW_USER']);
    if (auth instanceof NextResponse) return auth;

    if (!bytes32Schema.safeParse(rfqId).success) {
        return badRequest('Invalid rfqId format.');
    }

    try {
        const payload = await request.json().catch(() => ({}));
        const txHash = typeof payload?.txHash === 'string' ? payload.txHash : undefined;
        const { sealRfq } = getFhenixClients();

        if (!txHash) {
            const tx = await sealRfq.closeBidding.populateTransaction(rfqId);
            return NextResponse.json({
                status: 'success',
                data: { rfqId, tx: await buildTxRequest(tx.to as string, tx.data as string) },
            });
        }

        await syncIndexedRfq(rfqId, { txHash }, prisma);

        return NextResponse.json({ status: 'success', data: { rfqId, txHash } });
    } catch (error: any) {
        return badRequest(error.message || 'Invalid request payload');
    }
}

export async function handleFhenixPublishLowestBid(request: NextRequest, rfqId: string) {
    const auth = await requireRole(request, ['BUYER', 'NEW_USER']);
    if (auth instanceof NextResponse) return auth;

    if (!bytes32Schema.safeParse(rfqId).success) {
        return badRequest('Invalid rfqId format.');
    }

    try {
        const data = PublishLowestBidSchema.parse(await request.json());
        const { sealRfq } = getFhenixClients();

        if (!data.txHash) {
            const tx = await sealRfq.publishLowestBid.populateTransaction(
                rfqId,
                BigInt(data.plaintext),
                data.signature,
            );
            return NextResponse.json({
                status: 'success',
                data: { rfqId, tx: await buildTxRequest(tx.to as string, tx.data as string) },
            });
        }

        await syncIndexedRfq(rfqId, { txHash: data.txHash }, prisma);

        return NextResponse.json({ status: 'success', data: { rfqId, txHash: data.txHash } });
    } catch (error: any) {
        return badRequest(error.message || 'Invalid request payload');
    }
}

export async function handleFhenixSelectWinner(request: NextRequest, rfqId: string) {
    const auth = await requireRole(request, ['BUYER', 'NEW_USER']);
    if (auth instanceof NextResponse) return auth;

    if (!bytes32Schema.safeParse(rfqId).success) {
        return badRequest('Invalid rfqId format.');
    }

    try {
        const data = SelectWinnerSchema.parse(await request.json());
        const { sealRfq } = getFhenixClients();

        if (!data.txHash) {
            const tx = await sealRfq.selectWinner.populateTransaction(
                rfqId,
                data.bidId,
                BigInt(data.plaintext),
                data.signature,
            );
            return NextResponse.json({
                status: 'success',
                data: { rfqId, bidId: data.bidId, tx: await buildTxRequest(tx.to as string, tx.data as string) },
            });
        }

        await syncIndexedRfq(rfqId, { txHash: data.txHash }, prisma);
        await syncIndexedRfqWinnerFlags(rfqId, prisma);

        return NextResponse.json({ status: 'success', data: { rfqId, bidId: data.bidId, txHash: data.txHash } });
    } catch (error: any) {
        return badRequest(error.message || 'Invalid request payload');
    }
}

export async function handleFhenixWinnerRespond(request: NextRequest, rfqId: string) {
    const auth = await requireRole(request, ['VENDOR', 'NEW_USER']);
    if (auth instanceof NextResponse) return auth;

    if (!bytes32Schema.safeParse(rfqId).success) {
        return badRequest('Invalid rfqId format.');
    }

    try {
        const data = WinnerRespondSchema.parse(await request.json());
        const { sealRfq } = getFhenixClients();

        if (!data.txHash) {
            const tx = await sealRfq.winnerRespond.populateTransaction(rfqId, data.accept);
            return NextResponse.json({
                status: 'success',
                data: { rfqId, accepted: data.accept, tx: await buildTxRequest(tx.to as string, tx.data as string) },
            });
        }

        await syncIndexedRfq(rfqId, { txHash: data.txHash }, prisma);

        return NextResponse.json({ status: 'success', data: { rfqId, accepted: data.accept, txHash: data.txHash } });
    } catch (error: any) {
        return badRequest(error.message || 'Invalid request payload');
    }
}

export async function handleFhenixFundEscrow(request: NextRequest, rfqId: string) {
    const auth = await requireRole(request, ['BUYER', 'NEW_USER']);
    if (auth instanceof NextResponse) return auth;

    if (!bytes32Schema.safeParse(rfqId).success) {
        return badRequest('Invalid rfqId format.');
    }

    try {
        const data = FundEscrowSchema.parse(await request.json());
        const { sealRfq } = getFhenixClients();

        if (!data.txHash) {
            const tx = data.permit
                ? await sealRfq.permitAndFundEscrow.populateTransaction(
                      rfqId,
                      data.tokenType,
                      BigInt(data.amount),
                      ...getPermitArgs(data.permit),
                  )
                : await sealRfq.fundEscrowToken.populateTransaction(rfqId, data.tokenType, BigInt(data.amount));

            return NextResponse.json({
                status: 'success',
                data: {
                    rfqId,
                    tokenType: data.tokenType,
                    amount: data.amount,
                    usesPermit: Boolean(data.permit),
                    tx: await buildTxRequest(tx.to as string, tx.data as string),
                },
            });
        }

        return NextResponse.json({
            status: 'success',
            data: { rfqId, tokenType: data.tokenType, amount: data.amount, txHash: data.txHash },
        });
    } catch (error: any) {
        return badRequest(error.message || 'Invalid request payload');
    }
}

export async function handleFhenixReleasePayment(request: NextRequest, rfqId: string) {
    const auth = await requireRole(request, ['BUYER', 'NEW_USER']);
    if (auth instanceof NextResponse) return auth;

    if (!bytes32Schema.safeParse(rfqId).success) {
        return badRequest('Invalid rfqId format.');
    }

    try {
        const data = ReleasePaymentSchema.parse(await request.json());
        const { sealRfq } = getFhenixClients();

        if (!data.txHash) {
            const tx = await sealRfq.releasePartialPayment.populateTransaction(rfqId, data.percentage);
            return NextResponse.json({
                status: 'success',
                data: {
                    rfqId,
                    percentage: data.percentage,
                    tx: await buildTxRequest(tx.to as string, tx.data as string),
                },
            });
        }

        return NextResponse.json({
            status: 'success',
            data: { rfqId, percentage: data.percentage, txHash: data.txHash },
        });
    } catch (error: any) {
        return badRequest(error.message || 'Invalid request payload');
    }
}

export async function handleFhenixCreatorReclaimEscrow(request: NextRequest, rfqId: string) {
    const auth = await requireRole(request, ['BUYER', 'NEW_USER']);
    if (auth instanceof NextResponse) return auth;

    if (!bytes32Schema.safeParse(rfqId).success) {
        return badRequest('Invalid rfqId format.');
    }

    try {
        const payload = await request.json().catch(() => ({}));
        const txHash = typeof payload?.txHash === 'string' ? payload.txHash : undefined;
        const { sealRfq } = getFhenixClients();

        if (!txHash) {
            const tx = await sealRfq.creatorReclaimEscrow.populateTransaction(rfqId);
            return NextResponse.json({
                status: 'success',
                data: { rfqId, tx: await buildTxRequest(tx.to as string, tx.data as string) },
            });
        }

        await syncIndexedRfq(rfqId, { txHash }, prisma);

        return NextResponse.json({ status: 'success', data: { rfqId, txHash } });
    } catch (error: any) {
        return badRequest(error.message || 'Invalid request payload');
    }
}

export async function handleFhenixWinnerClaimEscrow(request: NextRequest, rfqId: string) {
    const auth = await requireRole(request, ['VENDOR', 'NEW_USER']);
    if (auth instanceof NextResponse) return auth;

    if (!bytes32Schema.safeParse(rfqId).success) {
        return badRequest('Invalid rfqId format.');
    }

    try {
        const payload = await request.json().catch(() => ({}));
        const txHash = typeof payload?.txHash === 'string' ? payload.txHash : undefined;
        const { sealRfq } = getFhenixClients();

        if (!txHash) {
            const tx = await sealRfq.winnerClaimEscrow.populateTransaction(rfqId);
            return NextResponse.json({
                status: 'success',
                data: { rfqId, tx: await buildTxRequest(tx.to as string, tx.data as string) },
            });
        }

        await syncIndexedRfq(rfqId, { txHash }, prisma);

        return NextResponse.json({ status: 'success', data: { rfqId, txHash } });
    } catch (error: any) {
        return badRequest(error.message || 'Invalid request payload');
    }
}

export async function handleFhenixImportAuctionResult(request: NextRequest, rfqId: string) {
    const auth = await requireRole(request, ['BUYER', 'NEW_USER']);
    if (auth instanceof NextResponse) return auth;

    if (!bytes32Schema.safeParse(rfqId).success) {
        return badRequest('Invalid rfqId format.');
    }

    try {
        const data = ImportAuctionSchema.parse(await request.json());
        const { sealRfq } = getFhenixClients();

        const selectedAuctionContract =
            data.auctionContract ??
            (data.auctionType === 1
                ? process.env.FHENIX_SEAL_VICKREY_ADDRESS
                : process.env.FHENIX_SEAL_DUTCH_ADDRESS);

        if (!selectedAuctionContract || !addressSchema.safeParse(selectedAuctionContract).success) {
            return badRequest('auctionContract is missing or invalid.');
        }

        if (!data.txHash) {
            const tx = await sealRfq.importAuctionResult.populateTransaction(
                rfqId,
                data.auctionId,
                selectedAuctionContract,
                data.auctionType,
            );
            return NextResponse.json({
                status: 'success',
                data: {
                    rfqId,
                    auctionId: data.auctionId,
                    auctionType: data.auctionType,
                    tx: await buildTxRequest(tx.to as string, tx.data as string),
                },
            });
        }

        await syncIndexedRfq(rfqId, { txHash: data.txHash }, prisma);

        return NextResponse.json({
            status: 'success',
            data: { rfqId, auctionId: data.auctionId, auctionType: data.auctionType, txHash: data.txHash },
        });
    } catch (error: any) {
        return badRequest(error.message || 'Invalid request payload');
    }
}

export async function handleFhenixConfirmTransfer(request: NextRequest, rfqId: string) {
    const auth = await requireRole(request, ['BUYER', 'VENDOR', 'NEW_USER']);
    if (auth instanceof NextResponse) return auth;

    if (!bytes32Schema.safeParse(rfqId).success) {
        return badRequest('Invalid rfqId format.');
    }

    try {
        const data = ConfirmTransferSchema.parse(await request.json());
        const { sealRfq } = getFhenixClients();

        if (!data.txHash) {
            const tx = await sealRfq.confirmTransferVerification.populateTransaction(
                data.transferId,
                data.success,
                data.signature,
            );
            return NextResponse.json({
                status: 'success',
                data: {
                    rfqId,
                    transferId: data.transferId,
                    success: data.success,
                    bidId: data.bidId,
                    tx: await buildTxRequest(tx.to as string, tx.data as string),
                },
            });
        }

        await syncIndexedRfq(rfqId, { txHash: data.txHash }, prisma);
        if (data.success) {
            if (data.bidId) {
                await syncIndexedRfqBid(rfqId, data.bidId, { txHash: data.txHash }, prisma);
            } else {
                await syncIndexedRfqBidsFromChain(rfqId, prisma).catch(() => null);
                await syncIndexedRfqEscrow(rfqId, { txHash: data.txHash }, prisma).catch(() => null);
            }
        }

        return NextResponse.json({
            status: 'success',
            data: { rfqId, transferId: data.transferId, success: data.success, bidId: data.bidId, txHash: data.txHash },
        });
    } catch (error: any) {
        return badRequest(error.message || 'Invalid request payload');
    }
}

export async function handleFhenixConfirmEscrowFunding(_request: NextRequest, _rfqId: string) {
    return NextResponse.json(
        {
            status: 'error',
            error: {
                code: 'UNSUPPORTED',
                message: 'Escrow funding is finalized through confirmTransferVerification in the current Sepolia contract.',
            },
        },
        { status: 410 },
    );
}
