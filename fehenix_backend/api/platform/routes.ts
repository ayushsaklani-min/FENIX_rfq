import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { maybeAuth, requireRole } from '../../auth/middleware';
import { getFhenixClients } from '../../lib/fhenixClient';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

const ConfigureSchema = z.object({
    feeBps: z.number().int().min(0).max(10_000),
    paused: z.boolean(),
    txHash: z.string().optional(),
});

const WithdrawSchema = z.object({
    amount: z.string().regex(/^\d+$/),
    txHash: z.string().optional(),
});

type CachedPlatformConfig = {
    admin: string;
    feeBps: number;
    paused: boolean;
    treasuryToken1: string;
    treasuryToken2: string;
};

let platformConfigCache:
    | {
          value: CachedPlatformConfig;
          expiresAt: number;
      }
    | null = null;

async function buildTxRequest(to: string, data: string, value: bigint | number = 0n) {
    const { chainId } = getFhenixClients();
    return {
        to,
        data,
        value: BigInt(value).toString(),
        chainId,
    };
}

async function getCachedPlatformConfig(): Promise<CachedPlatformConfig> {
    const now = Date.now();
    if (platformConfigCache && platformConfigCache.expiresAt > now) {
        return platformConfigCache.value;
    }

    const { sealRfq } = getFhenixClients();
    const config = await sealRfq.platformConfig();
    const normalized = {
        admin: String(config.admin),
        feeBps: Number(config.feeBps),
        paused: Boolean(config.paused),
        treasuryToken1: BigInt(config.treasuryToken1).toString(),
        treasuryToken2: BigInt(config.treasuryToken2).toString(),
    };

    platformConfigCache = {
        value: normalized,
        expiresAt: now + 30_000,
    };

    return normalized;
}

async function requireAdmin(request: NextRequest) {
    const auth = await requireRole(request, ['BUYER', 'VENDOR', 'AUDITOR', 'NEW_USER']);
    if (auth instanceof NextResponse) return auth;

    const config = await getCachedPlatformConfig();
    const admin = config.admin;
    const isAdmin = admin !== ZERO_ADDRESS && auth.walletAddress.toLowerCase() === admin.toLowerCase();

    if (!isAdmin) {
        return NextResponse.json(
            { status: 'error', error: { code: 'FORBIDDEN', message: 'Admin access required.' } },
            { status: 403 },
        );
    }

    return { auth, config };
}

export async function handleGetPlatformConfig(request: NextRequest) {
    const auth = await maybeAuth(request);

    const config = await getCachedPlatformConfig();
    const admin = config.admin;
    const isAdmin = Boolean(
        auth &&
        admin !== ZERO_ADDRESS &&
        auth.walletAddress.toLowerCase() === admin.toLowerCase()
    );

    return NextResponse.json({
        status: 'success',
        data: {
            initialized: admin !== ZERO_ADDRESS,
            admin,
            paused: config.paused,
            feeBps: config.feeBps,
            treasuryToken1: config.treasuryToken1,
            treasuryToken2: config.treasuryToken2,
            isAdmin,
        },
    });
}

export async function handleConfigurePlatform(request: NextRequest) {
    const adminResult = await requireAdmin(request);
    if (adminResult instanceof NextResponse) return adminResult;

    try {
        const data = ConfigureSchema.parse(await request.json());
        const { sealRfq } = getFhenixClients();

        if (!data.txHash) {
            const tx = await sealRfq.configurePlatform.populateTransaction(data.feeBps, data.paused);
            return NextResponse.json({
                status: 'success',
                data: {
                    feeBps: data.feeBps,
                    paused: data.paused,
                    tx: await buildTxRequest(tx.to as string, tx.data as string),
                },
            });
        }

        platformConfigCache = null;
        return NextResponse.json({
            status: 'success',
            data: {
                txHash: data.txHash,
                feeBps: data.feeBps,
                paused: data.paused,
            },
        });
    } catch (error: any) {
        return NextResponse.json(
            { status: 'error', error: { code: 'VALIDATION_ERROR', message: error.message } },
            { status: 400 },
        );
    }
}

async function handleWithdrawToken(request: NextRequest, tokenType: 0 | 1) {
    const adminResult = await requireAdmin(request);
    if (adminResult instanceof NextResponse) return adminResult;

    try {
        const data = WithdrawSchema.parse(await request.json());
        const { sealRfq } = getFhenixClients();

        if (!data.txHash) {
            const tx = await sealRfq.withdrawTokenFees.populateTransaction(tokenType, BigInt(data.amount));
            return NextResponse.json({
                status: 'success',
                data: {
                    tokenType,
                    amount: data.amount,
                    tx: await buildTxRequest(tx.to as string, tx.data as string),
                },
            });
        }

        platformConfigCache = null;
        return NextResponse.json({
            status: 'success',
            data: {
                tokenType,
                amount: data.amount,
                txHash: data.txHash,
            },
        });
    } catch (error: any) {
        return NextResponse.json(
            { status: 'error', error: { code: 'VALIDATION_ERROR', message: error.message } },
            { status: 400 },
        );
    }
}

export async function handleWithdrawToken1(request: NextRequest) {
    return handleWithdrawToken(request, 0);
}

export async function handleWithdrawToken2(request: NextRequest) {
    return handleWithdrawToken(request, 1);
}

export async function handleWithdrawFeesCredits(request: NextRequest) {
    return handleWithdrawToken1(request);
}

export async function handleWithdrawFeesUsdcx(request: NextRequest) {
    return handleWithdrawToken2(request);
}
