import { NextRequest, NextResponse } from 'next/server';
import { keccak256, solidityPacked } from 'ethers';
import { z } from 'zod';
import { requireRole } from '../../../../auth/middleware';
import { getFhenixClients } from '../../../../lib/fhenixClient';
import { syncIndexedDutchAcceptance, syncIndexedDutchAuction } from '../../../../lib/fhenixIndexing';
import { prisma } from '../../../../lib/prismaClient';
import { bytes32Schema, hexBytesRegex, randomBytes32Hex, u64StringSchema } from '../../../../lib/fhenixProtocol';

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
    startPrice: u64StringSchema,
    reservePrice: u64StringSchema,
    priceDecrement: u64StringSchema,
    startBlock: z.number().int().positive(),
    endBlock: z.number().int().positive(),
    txHash: z.string().optional(),
});

const CommitAcceptanceSchema = z.object({
    acceptanceId: bytes32Schema.optional(),
    permit: permitSchema.optional(),
    txHash: z.string().optional(),
});

const AcceptanceIdSchema = z.object({
    acceptanceId: bytes32Schema,
    txHash: z.string().optional(),
});

const AcceptPriceSchema = z.object({
    permit: permitSchema.optional(),
    txHash: z.string().optional(),
});

const ConfirmTransferSchema = z.object({
    transferId: bytes32Schema,
    success: z.boolean(),
    signature: z.string().regex(hexBytesRegex, 'signature must be hex bytes'),
    acceptanceId: bytes32Schema.optional(),
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

async function getDutchAuctionSnapshot(auctionId: string) {
    const { sealDutch, provider } = getFhenixClients();
    const [auction, currentPrice, currentBlock] = await Promise.all([
        sealDutch.auctions(auctionId),
        sealDutch.getCurrentPrice(auctionId),
        provider.getBlockNumber(),
    ]);

    const creator = String(auction.creator);
    if (creator === '0x0000000000000000000000000000000000000000') {
        return null;
    }

    return {
        id: auctionId,
        creator,
        rfqId: String(auction.rfqId),
        startPrice: BigInt(auction.startPrice).toString(),
        reservePrice: BigInt(auction.reservePrice).toString(),
        priceDecrement: BigInt(auction.priceDecrement).toString(),
        startBlock: Number(auction.startBlock),
        endBlock: Number(auction.endBlock),
        statusCode: Number(auction.status),
        committor: String(auction.committor),
        commitBlock: Number(auction.commitBlock),
        commitPrice: BigInt(auction.commitPrice).toString(),
        winner: String(auction.winner),
        finalPrice: BigInt(auction.finalPrice).toString(),
        currentPrice: BigInt(currentPrice).toString(),
        currentBlock,
    };
}

export async function handleDutchCreateAuction(request: NextRequest) {
    const auth = await requireRole(request, ['BUYER', 'NEW_USER']);
    if (auth instanceof NextResponse) return auth;

    try {
        const data = CreateAuctionSchema.parse(await request.json());
        const { sealDutch, provider } = getFhenixClients();
        const currentBlock = await provider.getBlockNumber();

        if (data.startBlock < currentBlock) {
            return badRequest(`Start block must be >= current block ${currentBlock}.`);
        }
        if (data.endBlock <= data.startBlock) {
            return badRequest('End block must be greater than start block.');
        }
        if (BigInt(data.startPrice) <= BigInt(data.reservePrice)) {
            return badRequest('Start price must be greater than reserve price.');
        }

        const derivedAuctionId = deriveAuctionId(auth.walletAddress, data.salt);
        if (data.auctionId && data.auctionId.toLowerCase() !== derivedAuctionId.toLowerCase()) {
            return badRequest('Supplied auctionId does not match keccak256(wallet, salt).');
        }

        const rfqId = data.rfqId ?? '0x' + '0'.repeat(64);

        if (!data.txHash) {
            const tx = await sealDutch.createAuction.populateTransaction(
                derivedAuctionId,
                data.salt,
                rfqId,
                BigInt(data.startPrice),
                BigInt(data.reservePrice),
                BigInt(data.priceDecrement),
                data.startBlock,
                data.endBlock,
            );
            return NextResponse.json({
                status: 'success',
                data: { auctionId: derivedAuctionId, tx: await buildTxRequest(tx.to as string, tx.data as string) },
            });
        }

        await syncIndexedDutchAuction(derivedAuctionId, { txHash: data.txHash }, prisma);

        return NextResponse.json({ status: 'success', data: { auctionId: derivedAuctionId, txHash: data.txHash } });
    } catch (error: any) {
        return badRequest(error.message || 'Invalid request payload');
    }
}

export async function handleDutchGetAuction(request: NextRequest, auctionId: string) {
    const auth = await requireRole(request, ['BUYER', 'VENDOR', 'AUDITOR', 'NEW_USER']);
    if (auth instanceof NextResponse) return auth;

    if (!bytes32Schema.safeParse(auctionId).success) {
        return badRequest('Invalid auctionId format.');
    }

    try {
        const snapshot = await getDutchAuctionSnapshot(auctionId);
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

export async function handleDutchListMyAuctions(request: NextRequest) {
    const auth = await requireRole(request, ['BUYER', 'NEW_USER']);
    if (auth instanceof NextResponse) return auth;

    try {
        const auctions = await prisma.dutchAuction.findMany({
            where: { creator: auth.walletAddress },
            orderBy: { createdAt: 'desc' },
        });
        const snapshots = await Promise.all(
            auctions.map(async (auction) => getDutchAuctionSnapshot(auction.id).catch(() => null)),
        );
        return NextResponse.json({ status: 'success', data: snapshots.filter(Boolean) });
    } catch (error: any) {
        return serverError(error.message || 'Failed to fetch indexed Dutch auctions');
    }
}

export async function handleDutchListAcceptances(request: NextRequest, auctionId: string) {
    const auth = await requireRole(request, ['BUYER', 'VENDOR', 'AUDITOR', 'NEW_USER']);
    if (auth instanceof NextResponse) return auth;

    if (!bytes32Schema.safeParse(auctionId).success) {
        return badRequest('Invalid auctionId format.');
    }

    try {
        const acceptances = await prisma.dutchAcceptance.findMany({
            where: { auctionId },
            orderBy: { createdAt: 'desc' },
        });
        const snapshots = await Promise.all(
            acceptances.map(async (acceptance) => {
                const { sealDutch } = getFhenixClients();
                const onChain = await sealDutch.acceptances(auctionId, acceptance.id);
                if (String(onChain.bidder) === '0x0000000000000000000000000000000000000000') {
                    return null;
                }
                return {
                    auctionId,
                    acceptanceId: acceptance.id,
                    bidder: String(onChain.bidder),
                    stake: BigInt(onChain.stake).toString(),
                    commitBlock: Number(onChain.commitBlock),
                    committedPrice: BigInt(onChain.committedPrice).toString(),
                    confirmed: Boolean(onChain.confirmed),
                    slashed: Boolean(onChain.slashed),
                };
            }),
        );
        return NextResponse.json({ status: 'success', data: snapshots.filter(Boolean) });
    } catch (error: any) {
        return serverError(error.message || 'Failed to fetch indexed Dutch acceptances');
    }
}

export async function handleDutchGetCurrentPrice(request: NextRequest, auctionId: string) {
    const auth = await requireRole(request, ['BUYER', 'VENDOR', 'AUDITOR', 'NEW_USER']);
    if (auth instanceof NextResponse) return auth;

    if (!bytes32Schema.safeParse(auctionId).success) {
        return badRequest('Invalid auctionId format.');
    }

    try {
        const { sealDutch, provider } = getFhenixClients();
        const [currentPrice, currentBlock] = await Promise.all([
            sealDutch.getCurrentPrice(auctionId),
            provider.getBlockNumber(),
        ]);
        return NextResponse.json({
            status: 'success',
            data: { auctionId, currentPrice: BigInt(currentPrice).toString(), currentBlock },
        });
    } catch (error: any) {
        return serverError(error.message || 'Failed to fetch current price');
    }
}

export async function handleDutchCommitAcceptance(request: NextRequest, auctionId: string) {
    const auth = await requireRole(request, ['VENDOR', 'NEW_USER']);
    if (auth instanceof NextResponse) return auth;

    if (!bytes32Schema.safeParse(auctionId).success) {
        return badRequest('Invalid auctionId format.');
    }

    try {
        const data = CommitAcceptanceSchema.parse(await request.json());
        const { sealDutch } = getFhenixClients();
        const acceptanceId = data.acceptanceId ?? randomBytes32Hex();
        const defaultStake = await sealDutch.DEFAULT_STAKE();

        if (!data.txHash) {
            const tx = data.permit
                ? await sealDutch.permitAndCommitAcceptance.populateTransaction(
                      auctionId,
                      acceptanceId,
                      ...getPermitArgs(data.permit),
                  )
                : await sealDutch.commitAcceptance.populateTransaction(auctionId, acceptanceId);

            return NextResponse.json({
                status: 'success',
                data: {
                    auctionId,
                    acceptanceId,
                    stake: BigInt(defaultStake).toString(),
                    usesPermit: Boolean(data.permit),
                    tx: await buildTxRequest(tx.to as string, tx.data as string),
                },
            });
        }

        await syncIndexedDutchAuction(auctionId, undefined, prisma);

        return NextResponse.json({ status: 'success', data: { auctionId, acceptanceId, txHash: data.txHash } });
    } catch (error: any) {
        return badRequest(error.message || 'Invalid request payload');
    }
}

export async function handleDutchConfirmAcceptance(request: NextRequest, auctionId: string) {
    const auth = await requireRole(request, ['VENDOR', 'NEW_USER']);
    if (auth instanceof NextResponse) return auth;

    if (!bytes32Schema.safeParse(auctionId).success) {
        return badRequest('Invalid auctionId format.');
    }

    try {
        const data = AcceptanceIdSchema.parse(await request.json());
        const { sealDutch } = getFhenixClients();

        if (!data.txHash) {
            const tx = await sealDutch.confirmAcceptance.populateTransaction(auctionId, data.acceptanceId);
            return NextResponse.json({
                status: 'success',
                data: {
                    auctionId,
                    acceptanceId: data.acceptanceId,
                    tx: await buildTxRequest(tx.to as string, tx.data as string),
                },
            });
        }

        await syncIndexedDutchAuction(auctionId, { txHash: data.txHash }, prisma);
        await syncIndexedDutchAcceptance(auctionId, data.acceptanceId, undefined, prisma).catch(() => null);

        return NextResponse.json({
            status: 'success',
            data: { auctionId, acceptanceId: data.acceptanceId, txHash: data.txHash },
        });
    } catch (error: any) {
        return badRequest(error.message || 'Invalid request payload');
    }
}

export async function handleDutchAcceptPrice(request: NextRequest, auctionId: string) {
    const auth = await requireRole(request, ['VENDOR', 'NEW_USER']);
    if (auth instanceof NextResponse) return auth;

    if (!bytes32Schema.safeParse(auctionId).success) {
        return badRequest('Invalid auctionId format.');
    }

    try {
        const data = AcceptPriceSchema.parse(await request.json().catch(() => ({})));
        const { sealDutch } = getFhenixClients();
        const defaultStake = await sealDutch.DEFAULT_STAKE();

        if (!data.txHash) {
            const tx = data.permit
                ? await sealDutch.permitAndAcceptPrice.populateTransaction(auctionId, ...getPermitArgs(data.permit))
                : await sealDutch.acceptPrice.populateTransaction(auctionId);

            return NextResponse.json({
                status: 'success',
                data: {
                    auctionId,
                    stake: BigInt(defaultStake).toString(),
                    usesPermit: Boolean(data.permit),
                    tx: await buildTxRequest(tx.to as string, tx.data as string),
                },
            });
        }

        await syncIndexedDutchAuction(auctionId, { txHash: data.txHash }, prisma);

        return NextResponse.json({ status: 'success', data: { auctionId, txHash: data.txHash } });
    } catch (error: any) {
        return badRequest(error.message || 'Invalid request payload');
    }
}

export async function handleDutchResetExpiredCommitment(request: NextRequest, auctionId: string) {
    const auth = await requireRole(request, ['BUYER', 'VENDOR', 'NEW_USER']);
    if (auth instanceof NextResponse) return auth;

    if (!bytes32Schema.safeParse(auctionId).success) {
        return badRequest('Invalid auctionId format.');
    }

    try {
        const data = AcceptanceIdSchema.parse(await request.json());
        const { sealDutch } = getFhenixClients();

        if (!data.txHash) {
            const tx = await sealDutch.resetExpiredCommitment.populateTransaction(auctionId, data.acceptanceId);
            return NextResponse.json({
                status: 'success',
                data: {
                    auctionId,
                    acceptanceId: data.acceptanceId,
                    tx: await buildTxRequest(tx.to as string, tx.data as string),
                },
            });
        }

        await syncIndexedDutchAuction(auctionId, { txHash: data.txHash }, prisma);

        return NextResponse.json({
            status: 'success',
            data: { auctionId, acceptanceId: data.acceptanceId, txHash: data.txHash },
        });
    } catch (error: any) {
        return badRequest(error.message || 'Invalid request payload');
    }
}

export async function handleDutchCancelAuction(request: NextRequest, auctionId: string) {
    const auth = await requireRole(request, ['BUYER', 'NEW_USER']);
    if (auth instanceof NextResponse) return auth;

    if (!bytes32Schema.safeParse(auctionId).success) {
        return badRequest('Invalid auctionId format.');
    }

    try {
        const payload = await request.json().catch(() => ({}));
        const txHash = typeof payload?.txHash === 'string' ? payload.txHash : undefined;
        const { sealDutch } = getFhenixClients();

        if (!txHash) {
            const tx = await sealDutch.cancelAuction.populateTransaction(auctionId);
            return NextResponse.json({
                status: 'success',
                data: { auctionId, tx: await buildTxRequest(tx.to as string, tx.data as string) },
            });
        }

        await syncIndexedDutchAuction(auctionId, { txHash }, prisma);

        return NextResponse.json({ status: 'success', data: { auctionId, txHash } });
    } catch (error: any) {
        return badRequest(error.message || 'Invalid request payload');
    }
}

export async function handleDutchClaimStake(request: NextRequest, auctionId: string) {
    const auth = await requireRole(request, ['VENDOR', 'NEW_USER']);
    if (auth instanceof NextResponse) return auth;

    if (!bytes32Schema.safeParse(auctionId).success) {
        return badRequest('Invalid auctionId format.');
    }

    try {
        const data = AcceptanceIdSchema.parse(await request.json());
        const { sealDutch } = getFhenixClients();

        if (!data.txHash) {
            const tx = await sealDutch.refundStake.populateTransaction(auctionId, data.acceptanceId);
            return NextResponse.json({
                status: 'success',
                data: {
                    auctionId,
                    acceptanceId: data.acceptanceId,
                    tx: await buildTxRequest(tx.to as string, tx.data as string),
                },
            });
        }

        await syncIndexedDutchAuction(auctionId, { txHash: data.txHash }, prisma);

        return NextResponse.json({
            status: 'success',
            data: { auctionId, acceptanceId: data.acceptanceId, txHash: data.txHash },
        });
    } catch (error: any) {
        return badRequest(error.message || 'Invalid request payload');
    }
}

export async function handleDutchGetAcceptance(request: NextRequest, auctionId: string, acceptanceId: string) {
    const auth = await requireRole(request, ['BUYER', 'VENDOR', 'AUDITOR', 'NEW_USER']);
    if (auth instanceof NextResponse) return auth;

    if (!bytes32Schema.safeParse(auctionId).success || !bytes32Schema.safeParse(acceptanceId).success) {
        return badRequest('Invalid auction or acceptance identifier.');
    }

    try {
        const { sealDutch } = getFhenixClients();
        const acceptance = await sealDutch.acceptances(auctionId, acceptanceId);
        const bidder = String(acceptance.bidder);

        if (bidder === '0x0000000000000000000000000000000000000000') {
            return NextResponse.json(
                { status: 'error', error: { code: 'NOT_FOUND', message: 'Acceptance not found' } },
                { status: 404 },
            );
        }

        return NextResponse.json({
            status: 'success',
            data: {
                auctionId,
                acceptanceId,
                bidder,
                stake: BigInt(acceptance.stake).toString(),
                commitBlock: Number(acceptance.commitBlock),
                committedPrice: BigInt(acceptance.committedPrice).toString(),
                confirmed: Boolean(acceptance.confirmed),
                slashed: Boolean(acceptance.slashed),
            },
        });
    } catch (error: any) {
        return serverError(error.message || 'Failed to fetch acceptance');
    }
}

export async function handleDutchGetResult(request: NextRequest, auctionId: string) {
    const auth = await requireRole(request, ['BUYER', 'VENDOR', 'AUDITOR', 'NEW_USER']);
    if (auth instanceof NextResponse) return auth;

    if (!bytes32Schema.safeParse(auctionId).success) {
        return badRequest('Invalid auctionId format.');
    }

    try {
        const { sealDutch } = getFhenixClients();
        const result = await sealDutch.getAuctionResult(auctionId);
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

export async function handleDutchConfirmTransfer(request: NextRequest, auctionId: string) {
    const auth = await requireRole(request, ['BUYER', 'VENDOR', 'NEW_USER']);
    if (auth instanceof NextResponse) return auth;

    if (!bytes32Schema.safeParse(auctionId).success) {
        return badRequest('Invalid auctionId format.');
    }

    try {
        const data = ConfirmTransferSchema.parse(await request.json());
        const { sealDutch } = getFhenixClients();

        if (!data.txHash) {
            const tx = await sealDutch.confirmTransferVerification.populateTransaction(
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
                    acceptanceId: data.acceptanceId,
                    tx: await buildTxRequest(tx.to as string, tx.data as string),
                },
            });
        }

        await syncIndexedDutchAuction(auctionId, { txHash: data.txHash }, prisma);
        if (data.success && data.acceptanceId) {
            await syncIndexedDutchAcceptance(auctionId, data.acceptanceId, { txHash: data.txHash }, prisma);
        }

        return NextResponse.json({
            status: 'success',
            data: {
                auctionId,
                transferId: data.transferId,
                success: data.success,
                acceptanceId: data.acceptanceId,
                txHash: data.txHash,
            },
        });
    } catch (error: any) {
        return badRequest(error.message || 'Invalid request payload');
    }
}
