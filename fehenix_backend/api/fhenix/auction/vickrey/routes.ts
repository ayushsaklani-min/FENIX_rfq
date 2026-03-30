import { NextRequest, NextResponse } from 'next/server';
import { keccak256, solidityPacked } from 'ethers';
import { z } from 'zod';
import { requireRole } from '../../../../auth/middleware';
import { getFhenixClients } from '../../../../lib/fhenixClient';
import { syncIndexedVickreyAuction, syncIndexedVickreyBid } from '../../../../lib/fhenixIndexing';
import { prisma } from '../../../../lib/prismaClient';
import {
    addressSchema,
    bytes32Schema,
    hexBytesRegex,
    randomBytes32Hex,
    toEncryptedUint64Tuple,
    type EncryptedUint64Input,
    u64StringSchema,
} from '../../../../lib/fhenixProtocol';

const uint256LikeSchema = z.union([z.number().int().nonnegative(), z.string().regex(/^\d+$/)]);
const permitSchema = z.object({
    deadline: uint256LikeSchema,
    v: z.number().int().min(0).max(255),
    r: z.string().regex(hexBytesRegex, 'r must be hex bytes'),
    s: z.string().regex(hexBytesRegex, 's must be hex bytes'),
});

const CreateAuctionSchema = z.object({
    auctionId: bytes32Schema.optional(),
    salt: bytes32Schema,
    rfqId: bytes32Schema.optional(),
    biddingDeadline: z.number().int().positive(),
    revealDeadline: z.number().int().positive(),
    flatStake: u64StringSchema,
    minBidCount: u64StringSchema,
    txHash: z.string().optional(),
});

const CommitBidSchema = z.object({
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

const RevealBidSchema = z.object({
    bidId: bytes32Schema,
    plaintext: u64StringSchema,
    signature: z.string().regex(hexBytesRegex, 'signature must be hex bytes'),
    txHash: z.string().optional(),
});

const FinalizeAuctionSchema = z.object({
    lowestBidPlaintext: u64StringSchema,
    lowestBidSignature: z.string().regex(hexBytesRegex),
    secondBidPlaintext: u64StringSchema,
    secondBidSignature: z.string().regex(hexBytesRegex),
    winnerPlaintext: addressSchema,
    winnerSignature: z.string().regex(hexBytesRegex),
    txHash: z.string().optional(),
});

const BidIdSchema = z.object({
    bidId: bytes32Schema,
    txHash: z.string().optional(),
});

const ConfirmTransferSchema = z.object({
    transferId: bytes32Schema,
    success: z.boolean(),
    signature: z.string().regex(hexBytesRegex, 'signature must be hex bytes'),
    bidId: bytes32Schema.optional(),
    txHash: z.string().optional(),
});

function badRequest(message: string) {
    return NextResponse.json({ status: 'error', error: { code: 'VALIDATION_ERROR', message } }, { status: 400 });
}

function serverError(message: string) {
    return NextResponse.json({ status: 'error', error: { code: 'SERVER_ERROR', message } }, { status: 500 });
}

function deriveAuctionId(walletAddress: string, salt: string): string {
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

async function buildTxRequest(to: string, data: string, value: bigint | number = 0n) {
    const { chainId } = getFhenixClients();
    return {
        to,
        data,
        value: BigInt(value).toString(),
        chainId,
    };
}

async function getVickreyAuctionSnapshot(auctionId: string) {
    const { sealVickrey } = getFhenixClients();
    const [auction, lowestCt, secondCt, winnerCt] = await Promise.all([
        sealVickrey.auctions(auctionId),
        sealVickrey.encryptedLowestBid(auctionId),
        sealVickrey.encryptedSecondLowestBid(auctionId),
        sealVickrey.encryptedLowestBidder(auctionId),
    ]);

    const creator = String(auction.creator);
    if (creator === '0x0000000000000000000000000000000000000000') {
        return null;
    }

    return {
        id: auctionId,
        creator,
        rfqId: String(auction.rfqId),
        biddingDeadline: Number(auction.biddingDeadline),
        revealDeadline: Number(auction.revealDeadline),
        flatStake: BigInt(auction.flatStake).toString(),
        minBidCount: BigInt(auction.minBidCount).toString(),
        statusCode: Number(auction.status),
        bidCount: BigInt(auction.bidCount).toString(),
        revealedCount: BigInt(auction.revealedCount).toString(),
        finalWinner: String(auction.finalWinner),
        finalPrice: BigInt(auction.finalPrice).toString(),
        finalized: Boolean(auction.finalized),
        encryptedLowestBidCtHash: String(lowestCt),
        encryptedSecondLowestBidCtHash: String(secondCt),
        encryptedLowestBidderCtHash: String(winnerCt),
    };
}

export async function handleVickreyCreateAuction(request: NextRequest) {
    const auth = await requireRole(request, ['BUYER', 'NEW_USER']);
    if (auth instanceof NextResponse) return auth;

    try {
        const data = CreateAuctionSchema.parse(await request.json());
        const { sealVickrey, provider } = getFhenixClients();
        const currentBlock = await provider.getBlockNumber();

        if (data.biddingDeadline <= currentBlock) {
            return badRequest(`Bidding deadline must be greater than current block ${currentBlock}.`);
        }
        if (data.revealDeadline <= data.biddingDeadline) {
            return badRequest('Reveal deadline must be greater than bidding deadline.');
        }

        const derivedAuctionId = deriveAuctionId(auth.walletAddress, data.salt);
        if (data.auctionId && data.auctionId.toLowerCase() !== derivedAuctionId.toLowerCase()) {
            return badRequest('Supplied auctionId does not match keccak256(wallet, salt).');
        }

        const rfqId = data.rfqId ?? '0x' + '0'.repeat(64);

        if (!data.txHash) {
            const tx = await sealVickrey.createAuction.populateTransaction(
                derivedAuctionId,
                data.salt,
                rfqId,
                data.biddingDeadline,
                data.revealDeadline,
                BigInt(data.flatStake),
                BigInt(data.minBidCount),
            );
            return NextResponse.json({
                status: 'success',
                data: {
                    auctionId: derivedAuctionId,
                    tx: await buildTxRequest(tx.to as string, tx.data as string),
                },
            });
        }

        await syncIndexedVickreyAuction(derivedAuctionId, { txHash: data.txHash }, prisma);

        return NextResponse.json({ status: 'success', data: { auctionId: derivedAuctionId, txHash: data.txHash } });
    } catch (error: any) {
        return badRequest(error.message || 'Invalid request payload');
    }
}

export async function handleVickreyGetAuction(request: NextRequest, auctionId: string) {
    const auth = await requireRole(request, ['BUYER', 'VENDOR', 'AUDITOR', 'NEW_USER']);
    if (auth instanceof NextResponse) return auth;

    if (!bytes32Schema.safeParse(auctionId).success) {
        return badRequest('Invalid auctionId format.');
    }

    try {
        const snapshot = await getVickreyAuctionSnapshot(auctionId);
        if (!snapshot) {
            return NextResponse.json(
                { status: 'error', error: { code: 'NOT_FOUND', message: 'Auction not found' } },
                { status: 404 },
            );
        }

        return NextResponse.json({ status: 'success', data: snapshot });
    } catch (error: any) {
        return serverError(error.message || 'Failed to fetch auction state');
    }
}

export async function handleVickreyListMyAuctions(request: NextRequest) {
    const auth = await requireRole(request, ['BUYER', 'NEW_USER']);
    if (auth instanceof NextResponse) return auth;

    try {
        const auctions = await prisma.vickreyAuction.findMany({
            where: { creator: auth.walletAddress },
            orderBy: { createdAt: 'desc' },
        });
        const snapshots = await Promise.all(
            auctions.map(async (auction) => getVickreyAuctionSnapshot(auction.id).catch(() => null)),
        );
        return NextResponse.json({ status: 'success', data: snapshots.filter(Boolean) });
    } catch (error: any) {
        return serverError(error.message || 'Failed to fetch indexed Vickrey auctions');
    }
}

export async function handleVickreyListBids(request: NextRequest, auctionId: string) {
    const auth = await requireRole(request, ['BUYER', 'VENDOR', 'AUDITOR', 'NEW_USER']);
    if (auth instanceof NextResponse) return auth;

    if (!bytes32Schema.safeParse(auctionId).success) {
        return badRequest('Invalid auctionId format.');
    }

    try {
        const bids = await prisma.vickreyBid.findMany({
            where: { auctionId },
            orderBy: { createdAt: 'desc' },
        });
        const snapshots = await Promise.all(
            bids.map(async (bid) => {
                const { sealVickrey } = getFhenixClients();
                const onChain = await sealVickrey.bids(auctionId, bid.id);
                if (String(onChain.owner) === '0x0000000000000000000000000000000000000000') {
                    return null;
                }
                return {
                    auctionId,
                    bidId: bid.id,
                    owner: String(onChain.owner),
                    encryptedAmountCtHash: String(onChain.encryptedAmount),
                    stake: BigInt(onChain.stake).toString(),
                    revealed: Boolean(onChain.revealed),
                    revealedAmount: BigInt(onChain.revealedAmount).toString(),
                };
            }),
        );
        return NextResponse.json({ status: 'success', data: snapshots.filter(Boolean) });
    } catch (error: any) {
        return serverError(error.message || 'Failed to fetch indexed Vickrey bids');
    }
}

export async function handleVickreyCommitBid(request: NextRequest, auctionId: string) {
    const auth = await requireRole(request, ['VENDOR', 'NEW_USER']);
    if (auth instanceof NextResponse) return auth;

    if (!bytes32Schema.safeParse(auctionId).success) {
        return badRequest('Invalid auctionId format.');
    }

    try {
        const data = CommitBidSchema.parse(await request.json());
        const { sealVickrey } = getFhenixClients();
        const bidId = data.bidId ?? randomBytes32Hex();
        const encryptedBid = normalizeEncryptedBid(data.encryptedBid);
        const auction = await sealVickrey.auctions(auctionId);

        if (!data.txHash) {
            const tx = data.permit
                ? await sealVickrey.permitAndCommitBid.populateTransaction(
                      auctionId,
                      bidId,
                      encryptedBid,
                      ...getPermitArgs(data.permit),
                  )
                : await sealVickrey.commitBid.populateTransaction(auctionId, bidId, encryptedBid);

            return NextResponse.json({
                status: 'success',
                data: {
                    auctionId,
                    bidId,
                    flatStake: BigInt(auction.flatStake).toString(),
                    usesPermit: Boolean(data.permit),
                    tx: await buildTxRequest(tx.to as string, tx.data as string),
                },
            });
        }

        await syncIndexedVickreyAuction(auctionId, undefined, prisma);

        return NextResponse.json({ status: 'success', data: { auctionId, bidId, txHash: data.txHash } });
    } catch (error: any) {
        return badRequest(error.message || 'Invalid request payload');
    }
}

export async function handleVickreyCloseBidding(request: NextRequest, auctionId: string) {
    const auth = await requireRole(request, ['BUYER', 'VENDOR', 'NEW_USER']);
    if (auth instanceof NextResponse) return auth;

    if (!bytes32Schema.safeParse(auctionId).success) {
        return badRequest('Invalid auctionId format.');
    }

    try {
        const payload = await request.json().catch(() => ({}));
        const txHash = typeof payload?.txHash === 'string' ? payload.txHash : undefined;
        const { sealVickrey } = getFhenixClients();

        if (!txHash) {
            const tx = await sealVickrey.closeBidding.populateTransaction(auctionId);
            return NextResponse.json({
                status: 'success',
                data: { auctionId, tx: await buildTxRequest(tx.to as string, tx.data as string) },
            });
        }

        await syncIndexedVickreyAuction(auctionId, { txHash }, prisma);

        return NextResponse.json({ status: 'success', data: { auctionId, txHash } });
    } catch (error: any) {
        return badRequest(error.message || 'Invalid request payload');
    }
}

export async function handleVickreyRevealBid(request: NextRequest, auctionId: string) {
    const auth = await requireRole(request, ['VENDOR', 'NEW_USER']);
    if (auth instanceof NextResponse) return auth;

    if (!bytes32Schema.safeParse(auctionId).success) {
        return badRequest('Invalid auctionId format.');
    }

    try {
        const data = RevealBidSchema.parse(await request.json());
        const { sealVickrey } = getFhenixClients();

        if (!data.txHash) {
            const tx = await sealVickrey.revealBid.populateTransaction(
                auctionId,
                data.bidId,
                BigInt(data.plaintext),
                data.signature,
            );
            return NextResponse.json({
                status: 'success',
                data: { auctionId, bidId: data.bidId, tx: await buildTxRequest(tx.to as string, tx.data as string) },
            });
        }

        await syncIndexedVickreyBid(auctionId, data.bidId, undefined, prisma).catch(() => null);
        await syncIndexedVickreyAuction(auctionId, { txHash: data.txHash }, prisma);

        return NextResponse.json({ status: 'success', data: { auctionId, bidId: data.bidId, txHash: data.txHash } });
    } catch (error: any) {
        return badRequest(error.message || 'Invalid request payload');
    }
}

export async function handleVickreyFinalizeAuction(request: NextRequest, auctionId: string) {
    const auth = await requireRole(request, ['BUYER', 'NEW_USER']);
    if (auth instanceof NextResponse) return auth;

    if (!bytes32Schema.safeParse(auctionId).success) {
        return badRequest('Invalid auctionId format.');
    }

    try {
        const data = FinalizeAuctionSchema.parse(await request.json());
        const { sealVickrey } = getFhenixClients();

        if (!data.txHash) {
            const tx = await sealVickrey.finalizeAuction.populateTransaction(
                auctionId,
                BigInt(data.lowestBidPlaintext),
                data.lowestBidSignature,
                BigInt(data.secondBidPlaintext),
                data.secondBidSignature,
                data.winnerPlaintext,
                data.winnerSignature,
            );
            return NextResponse.json({
                status: 'success',
                data: { auctionId, tx: await buildTxRequest(tx.to as string, tx.data as string) },
            });
        }

        await syncIndexedVickreyAuction(auctionId, { txHash: data.txHash }, prisma);

        return NextResponse.json({ status: 'success', data: { auctionId, txHash: data.txHash } });
    } catch (error: any) {
        return badRequest(error.message || 'Invalid request payload');
    }
}

export async function handleVickreyCancelAuction(request: NextRequest, auctionId: string) {
    const auth = await requireRole(request, ['BUYER', 'NEW_USER']);
    if (auth instanceof NextResponse) return auth;

    if (!bytes32Schema.safeParse(auctionId).success) {
        return badRequest('Invalid auctionId format.');
    }

    try {
        const payload = await request.json().catch(() => ({}));
        const txHash = typeof payload?.txHash === 'string' ? payload.txHash : undefined;
        const { sealVickrey } = getFhenixClients();

        if (!txHash) {
            const tx = await sealVickrey.cancelAuction.populateTransaction(auctionId);
            return NextResponse.json({
                status: 'success',
                data: { auctionId, tx: await buildTxRequest(tx.to as string, tx.data as string) },
            });
        }

        await syncIndexedVickreyAuction(auctionId, { txHash }, prisma);

        return NextResponse.json({ status: 'success', data: { auctionId, txHash } });
    } catch (error: any) {
        return badRequest(error.message || 'Invalid request payload');
    }
}

export async function handleVickreyClaimStake(request: NextRequest, auctionId: string) {
    const auth = await requireRole(request, ['VENDOR', 'NEW_USER']);
    if (auth instanceof NextResponse) return auth;

    if (!bytes32Schema.safeParse(auctionId).success) {
        return badRequest('Invalid auctionId format.');
    }

    try {
        const data = BidIdSchema.parse(await request.json());
        const { sealVickrey } = getFhenixClients();

        if (!data.txHash) {
            const tx = await sealVickrey.refundStake.populateTransaction(auctionId, data.bidId);
            return NextResponse.json({
                status: 'success',
                data: { auctionId, bidId: data.bidId, tx: await buildTxRequest(tx.to as string, tx.data as string) },
            });
        }

        await syncIndexedVickreyAuction(auctionId, { txHash: data.txHash }, prisma);

        return NextResponse.json({ status: 'success', data: { auctionId, bidId: data.bidId, txHash: data.txHash } });
    } catch (error: any) {
        return badRequest(error.message || 'Invalid request payload');
    }
}

export async function handleVickreyGetBid(request: NextRequest, auctionId: string, bidId: string) {
    const auth = await requireRole(request, ['BUYER', 'VENDOR', 'AUDITOR', 'NEW_USER']);
    if (auth instanceof NextResponse) return auth;

    if (!bytes32Schema.safeParse(auctionId).success || !bytes32Schema.safeParse(bidId).success) {
        return badRequest('Invalid auction or bid identifier.');
    }

    try {
        const { sealVickrey } = getFhenixClients();
        const bid = await sealVickrey.bids(auctionId, bidId);

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
                auctionId,
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

export async function handleVickreyGetResult(request: NextRequest, auctionId: string) {
    const auth = await requireRole(request, ['BUYER', 'VENDOR', 'AUDITOR', 'NEW_USER']);
    if (auth instanceof NextResponse) return auth;

    if (!bytes32Schema.safeParse(auctionId).success) {
        return badRequest('Invalid auctionId format.');
    }

    try {
        const { sealVickrey } = getFhenixClients();
        const result = await sealVickrey.getAuctionResult(auctionId);
        return NextResponse.json({
            status: 'success',
            data: {
                auctionId,
                winner: String(result.winner),
                finalPrice: BigInt(result.finalPrice).toString(),
                finalized: Boolean(result.finalized),
            },
        });
    } catch (error: any) {
        return serverError(error.message || 'Failed to fetch auction result');
    }
}

export async function handleVickreyConfirmTransfer(request: NextRequest, auctionId: string) {
    const auth = await requireRole(request, ['BUYER', 'VENDOR', 'NEW_USER']);
    if (auth instanceof NextResponse) return auth;

    if (!bytes32Schema.safeParse(auctionId).success) {
        return badRequest('Invalid auctionId format.');
    }

    try {
        const data = ConfirmTransferSchema.parse(await request.json());
        const { sealVickrey } = getFhenixClients();

        if (!data.txHash) {
            const tx = await sealVickrey.confirmTransferVerification.populateTransaction(
                data.transferId,
                data.success,
                data.signature,
            );
            return NextResponse.json({
                status: 'success',
                data: {
                    auctionId,
                    transferId: data.transferId,
                    success: data.success,
                    bidId: data.bidId,
                    tx: await buildTxRequest(tx.to as string, tx.data as string),
                },
            });
        }

        await syncIndexedVickreyAuction(auctionId, { txHash: data.txHash }, prisma);
        if (data.success && data.bidId) {
            await syncIndexedVickreyBid(auctionId, data.bidId, { txHash: data.txHash }, prisma);
        }

        return NextResponse.json({
            status: 'success',
            data: { auctionId, transferId: data.transferId, success: data.success, bidId: data.bidId, txHash: data.txHash },
        });
    } catch (error: any) {
        return badRequest(error.message || 'Invalid request payload');
    }
}
