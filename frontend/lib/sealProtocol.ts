import { z } from 'zod';
import { keccak256, toHex, encodePacked } from 'viem';

// Contract addresses from environment
export const CONTRACT_ADDRESSES = {
    stakeToken: process.env.NEXT_PUBLIC_FHENIX_STAKE_TOKEN_ADDRESS || process.env.NEXT_PUBLIC_FHENIX_TOKEN1_ADDRESS || '0x0000000000000000000000000000000000000005',
    rfq: process.env.NEXT_PUBLIC_FHENIX_RFQ_ADDRESS || '0x0000000000000000000000000000000000000001',
    vickrey: process.env.NEXT_PUBLIC_FHENIX_VICKREY_ADDRESS || '0x0000000000000000000000000000000000000002',
    dutch: process.env.NEXT_PUBLIC_FHENIX_DUTCH_ADDRESS || '0x0000000000000000000000000000000000000003',
    invoice: process.env.NEXT_PUBLIC_FHENIX_INVOICE_ADDRESS || '0x0000000000000000000000000000000000000004',
} as const;

// FHE Types enum matching @cofhe/sdk
export const FHE_TYPES = {
    BOOL: 0,
    UINT8: 1,
    UINT16: 2,
    UINT32: 3,
    UINT64: 4,
    UINT128: 5,
    UINT160: 6, // address
} as const;

export const TOKEN_TYPE = {
    TOKEN1: 0,
    TOKEN2: 1,
    ETH: 2,
    ERC20_1: 0,
    ERC20_2: 1,
    CREDITS: 0,
    USDCX: 0,
    USAD: 1,
} as const;

const TOKEN_METADATA = {
    [TOKEN_TYPE.TOKEN1]: {
        symbol: process.env.NEXT_PUBLIC_FHENIX_TOKEN1_SYMBOL || 'eSEAL',
        decimals: Number(process.env.NEXT_PUBLIC_FHENIX_TOKEN1_DECIMALS || '4'),
    },
    [TOKEN_TYPE.TOKEN2]: {
        symbol: process.env.NEXT_PUBLIC_FHENIX_TOKEN2_SYMBOL || process.env.NEXT_PUBLIC_FHENIX_TOKEN1_SYMBOL || 'eSEAL',
        decimals: Number(process.env.NEXT_PUBLIC_FHENIX_TOKEN2_DECIMALS || process.env.NEXT_PUBLIC_FHENIX_TOKEN1_DECIMALS || '4'),
    },
    [TOKEN_TYPE.ETH]: {
        symbol: 'ETH',
        decimals: 18,
    },
} as const;

export const PRICING_MODE = {
    RFQ: 0,
    VICKREY: 1,
    DUTCH: 2,
} as const;

export const STATUS_LABELS: Record<string, string> = {
    NONE: 'Not Created',
    BIDDING: 'Accepting Bids',
    REVEAL: 'Reveal Phase',
    WINNER_SELECTED: 'Awaiting Winner Response',
    ESCROW_FUNDED: 'In Delivery',
    COMPLETED: 'Completed',
    CANCELLED: 'Cancelled',
    REJECTED: 'Winner Declined',
};

export const RFQ_STATUS = {
    NONE: 0,
    BIDDING: 1,
    REVEAL: 2,
    WINNER_SELECTED: 3,
    ESCROW_FUNDED: 4,
    COMPLETED: 5,
    CANCELLED: 6,
    REJECTED: 7,
} as const;

export const TIMING = {
    MIN_REVEAL_WINDOW: 720,         // ~1 hour at 5s blocks
    ESCROW_TIMEOUT_BLOCKS: 2160,    // ~3 hours
    SLASH_WINDOW: 1440,             // ~2 hours
    ESCROW_RECOVERY_BLOCKS: 2880,   // ~4 hours
    SNIPE_WINDOW_BLOCKS: 40,
    SNIPE_EXTENSION_BLOCKS: 40,
    MAX_RFQ_DURATION: 100_000,
    BLOCK_MS: Number(process.env.NEXT_PUBLIC_FHENIX_BLOCK_TIME_MS || '5000'),
    FEE_DENOMINATOR: 10_000,
} as const;

export type PlatformConfig = {
    adminHash: string;
    feeBps: number;
    paused: boolean;
    treasuryBalance: string;
    initialized: boolean;
};

// Validation schemas using bytes32 hex format
export const bytes32Regex = /^0x[a-fA-F0-9]{64}$/;
export const evmAddressRegex = /^0x[a-fA-F0-9]{40}$/;
export const hexBytesRegex = /^0x[a-fA-F0-9]*$/;

export const bytes32Schema = z.string().regex(bytes32Regex, 'Must be 0x-prefixed 32-byte hex');
export const addressSchema = z.string().regex(evmAddressRegex, 'Must be 0x-prefixed EVM address');
export const weiStringSchema = z.string().regex(/^\d+$/, 'Must be numeric string (wei)');

export const createRfqSchema = z
    .object({
        biddingDeadline: z.number().int().positive(),
        revealDeadline: z.number().int().positive(),
        minBid: weiStringSchema,
        minBidCount: z.number().int().positive().default(1),
        metadataHash: bytes32Schema,
        tokenType: z.number().int().min(0).max(1),
        pricingMode: z.number().int().min(0).max(2),
        salt: bytes32Schema,
    })
    .refine((value) => value.revealDeadline > value.biddingDeadline, {
        message: 'Reveal deadline must be after bidding deadline',
        path: ['revealDeadline'],
    })
    .refine((value) => value.revealDeadline - value.biddingDeadline >= TIMING.MIN_REVEAL_WINDOW, {
        message: `Reveal window must be at least ${TIMING.MIN_REVEAL_WINDOW} blocks`,
        path: ['revealDeadline'],
    });

export const bidCommitSchema = z.object({
    rfqId: bytes32Schema,
    bidAmount: weiStringSchema,
    stake: weiStringSchema,
});

export const partialReleaseSchema = z.object({
    amount: weiStringSchema,
    percentage: z.number().int().min(1).max(100),
    feeBps: z.number().int().min(0).max(TIMING.FEE_DENOMINATOR),
});

export const invoiceSchema = z.object({
    amount: weiStringSchema,
    rfqId: bytes32Schema,
});

export const vickreyAuctionSchema = z.object({
    auctionId: bytes32Schema,
    salt: bytes32Schema,
    rfqId: bytes32Schema,
    tokenType: z.number().int().min(0).max(1),
    biddingDeadline: z.number().int().positive(),
    revealDeadline: z.number().int().positive(),
    minBid: weiStringSchema,
});

export const dutchAuctionSchema = z.object({
    auctionId: bytes32Schema,
    salt: bytes32Schema,
    rfqId: bytes32Schema,
    tokenType: z.number().int().min(0).max(1),
    startPrice: weiStringSchema,
    reservePrice: weiStringSchema,
    decrementPerBlock: weiStringSchema,
    startBlock: z.number().int().positive(),
    endBlock: z.number().int().positive(),
});

// Encrypted bid input type (from CoFHE SDK)
export type EncryptedBidInput = {
    ctHash: string;        // bigint as decimal string
    securityZone: number;  // typically 0
    utype: number;         // FHE_TYPES.UINT64 = 4
    signature: string;     // hex string "0x..."
};

export function tokenLabel(tokenType: number | null | undefined) {
    if (tokenType === TOKEN_TYPE.TOKEN1) return TOKEN_METADATA[TOKEN_TYPE.TOKEN1].symbol;
    if (tokenType === TOKEN_TYPE.TOKEN2) return TOKEN_METADATA[TOKEN_TYPE.TOKEN2].symbol;
    if (tokenType === TOKEN_TYPE.ETH) return TOKEN_METADATA[TOKEN_TYPE.ETH].symbol;
    return 'Settlement token';
}

export function tokenDecimals(tokenType: number | null | undefined) {
    if (tokenType === TOKEN_TYPE.TOKEN1) return TOKEN_METADATA[TOKEN_TYPE.TOKEN1].decimals;
    if (tokenType === TOKEN_TYPE.TOKEN2) return TOKEN_METADATA[TOKEN_TYPE.TOKEN2].decimals;
    return TOKEN_METADATA[TOKEN_TYPE.ETH].decimals;
}

export function pricingLabel(mode: number | null | undefined) {
    if (mode === PRICING_MODE.VICKREY) return 'Vickrey';
    if (mode === PRICING_MODE.DUTCH) return 'Dutch';
    return 'RFQ';
}

export function formatAmount(
    amount: string | number | bigint | null | undefined,
    tokenType: number = TOKEN_TYPE.ETH,
    decimals?: number,
) {
    if (amount === null || amount === undefined) return '--';
    try {
        const raw = typeof amount === 'bigint' ? amount : BigInt(amount);
        const resolvedDecimals = decimals ?? tokenDecimals(tokenType);
        const divisor = 10n ** BigInt(resolvedDecimals);
        const whole = raw / divisor;
        const fraction = raw % divisor;
        const fractionStr = fraction === 0n 
            ? '' 
            : `.${fraction.toString().padStart(resolvedDecimals, '0').replace(/0+$/, '')}`;
        return `${whole}${fractionStr} ${tokenLabel(tokenType)}`;
    } catch {
        return `${amount} ${tokenLabel(tokenType)}`;
    }
}

export function formatBlockTime(blockDelta: number) {
    const totalSeconds = Math.max(0, Math.round((blockDelta * TIMING.BLOCK_MS) / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
}

// Generate random bytes32 hex
export function randomBytes32Hex(): `0x${string}` {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return `0x${Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')}` as `0x${string}`;
}

// Hash data to bytes32 using keccak256
export async function hashToBytes32(parts: Array<string | number | bigint | boolean>): Promise<`0x${string}`> {
    const payload = parts.map((part) => String(part)).join('|');
    return keccak256(toHex(payload));
}

// Derive RFQ ID from creator address and salt
export async function deriveRfqId(creator: string, salt: string): Promise<`0x${string}`> {
    return keccak256(encodePacked(['address', 'bytes32'], [creator as `0x${string}`, salt as `0x${string}`]));
}

// Derive auction ID
export async function deriveAuctionId(creator: string, salt: string, kind: 'vickrey' | 'dutch'): Promise<`0x${string}`> {
    const prefix = kind === 'vickrey' ? 'VICKREY' : 'DUTCH';
    return keccak256(encodePacked(['string', 'address', 'bytes32'], [prefix, creator as `0x${string}`, salt as `0x${string}`]));
}

// Derive bid ID
export async function deriveBidId(rfqId: string, bidder: string, salt: string): Promise<`0x${string}`> {
    return keccak256(encodePacked(['bytes32', 'address', 'bytes32'], [rfqId as `0x${string}`, bidder as `0x${string}`, salt as `0x${string}`]));
}

export function calculateFee(amount: string | bigint, feeBps: number) {
    const base = typeof amount === 'bigint' ? amount : BigInt(amount);
    return (base * BigInt(feeBps)) / BigInt(TIMING.FEE_DENOMINATOR);
}

export function netAfterFee(amount: string | bigint, feeBps: number) {
    const base = typeof amount === 'bigint' ? amount : BigInt(amount);
    return base - calculateFee(base, feeBps);
}

export function statusLabel(statusCode: number): string {
    const labels: Record<number, string> = {
        0: 'NONE',
        1: 'BIDDING',
        2: 'REVEAL',
        3: 'WINNER_SELECTED',
        4: 'ESCROW_FUNDED',
        5: 'COMPLETED',
        6: 'CANCELLED',
        7: 'REJECTED',
    };
    return STATUS_LABELS[labels[statusCode] || 'NONE'] || 'Unknown';
}

// Backward compatibility aliases
export const randomField = randomBytes32Hex;
export const hashToField = hashToBytes32;
