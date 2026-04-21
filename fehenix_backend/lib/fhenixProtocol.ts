import { randomBytes } from 'crypto';
import { z } from 'zod';

// FheTypes enum aligned with @cofhe/sdk@0.4.0.
// IMPORTANT: These values must match the SDK version used by the frontend/backend.
export const FHE_TYPES = {
    BOOL: 0,
    UINT4: 1,
    UINT8: 2,
    UINT16: 3,
    UINT32: 4,
    UINT64: 5,
    UINT128: 6,
    UINT160: 7, // address
} as const;

export const FHENIX_ENUMS = {
    TOKEN_TYPE: {
        NATIVE: 0,
        ERC20_TOKEN1: 1,
        ERC20_TOKEN2: 2,
    },
    RFQ_MODE: {
        STANDARD: 0,
        VICKREY: 1,
        DUTCH: 2,
    },
    RFQ_STATUS: {
        NONE: 0,
        BIDDING: 1,
        REVEAL: 2,
        WINNER_SELECTED: 3,
        ESCROW_FUNDED: 4,
        COMPLETED: 5,
        CANCELLED: 6,
        REJECTED: 7,
    },
} as const;

export const FHENIX_STATUS_LABELS: Record<number, string> = {
    0: 'NONE',
    1: 'BIDDING',
    2: 'REVEAL',
    3: 'WINNER_SELECTED',
    4: 'ESCROW_FUNDED',
    5: 'COMPLETED',
    6: 'CANCELLED',
    7: 'REJECTED',
};

export type EncryptedUint64Input = {
    ctHash: string;
    securityZone: number;
    utype: number;
    signature: string;
};

export const bytes32Regex = /^0x[a-fA-F0-9]{64}$/;
export const evmAddressRegex = /^0x[a-fA-F0-9]{40}$/;
export const hexBytesRegex = /^0x[a-fA-F0-9]*$/;

export const bytes32Schema = z.string().regex(bytes32Regex, 'Value must be 0x-prefixed 32-byte hex');
export const addressSchema = z.string().regex(evmAddressRegex, 'Value must be 0x-prefixed EVM address');
export const u64StringSchema = z
    .string()
    .regex(/^\d+$/)
    .refine((v) => BigInt(v) <= 18446744073709551615n, 'Value exceeds uint64 max');

export function randomBytes32Hex(): string {
    return `0x${randomBytes(32).toString('hex')}`;
}

export function deriveDeterministicId(senderAddress: string, saltBytes32: string): string {
    const sender = senderAddress.toLowerCase().replace(/^0x/, '');
    const salt = saltBytes32.toLowerCase().replace(/^0x/, '');
    return `0x${sender}${salt}`.slice(0, 66);
}

export function normalizeHexBytes(input: string): string {
    if (!input.startsWith('0x')) return `0x${input}`;
    return input;
}

export function toEncryptedUint64Tuple(input: EncryptedUint64Input): {
    ctHash: bigint;
    securityZone: number;
    utype: number;
    signature: string;
} {
    return {
        ctHash: BigInt(input.ctHash),
        securityZone: input.securityZone,
        utype: input.utype,
        signature: normalizeHexBytes(input.signature),
    };
}
