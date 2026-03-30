'use client';

import { decodeEventLog, parseAbiItem, type TransactionReceipt } from 'viem';
import { decryptForTransaction } from './cofheClient';
import { walletFirstTx, type WalletTxResult } from './walletTx';

const transferVerificationEvent = parseAbiItem(
    'event TransferVerificationRequested(bytes32 indexed transferId, bytes32 indexed successCtHash)',
);
const invoicePaymentPendingEvent = parseAbiItem(
    'event InvoicePaymentPending(bytes32 indexed invoiceId, bytes32 indexed amountCtHash)',
);

export type TransferVerificationRequest = {
    transferId: `0x${string}`;
    successCtHash: `0x${string}`;
};

export type InvoicePaymentPendingRequest = {
    invoiceId: `0x${string}`;
    amountCtHash: `0x${string}`;
};

export type WinnerProofShare = {
    bidId: `0x${string}`;
    plaintext: string;
    signature: `0x${string}`;
};

function addressesEqual(left?: string, right?: string) {
    return Boolean(left && right && left.toLowerCase() === right.toLowerCase());
}

export function getTransferVerificationRequest(
    receipt: TransactionReceipt,
    contractAddress: string,
): TransferVerificationRequest | null {
    for (const log of receipt.logs) {
        if (!addressesEqual(log.address, contractAddress)) {
            continue;
        }
        const topics = (log as { topics?: readonly `0x${string}`[] }).topics;
        if (!topics) {
            continue;
        }

        try {
            const decoded = decodeEventLog({
                abi: [transferVerificationEvent],
                data: log.data,
                topics: [...topics] as any,
            }) as {
                eventName: string;
                args: {
                    transferId: `0x${string}`;
                    successCtHash: `0x${string}`;
                };
            };

            if (decoded.eventName === 'TransferVerificationRequested') {
                return {
                    transferId: decoded.args.transferId,
                    successCtHash: decoded.args.successCtHash,
                };
            }
        } catch {
            continue;
        }
    }

    return null;
}

export function getInvoicePaymentPendingRequest(
    receipt: TransactionReceipt,
    contractAddress: string,
): InvoicePaymentPendingRequest | null {
    for (const log of receipt.logs) {
        if (!addressesEqual(log.address, contractAddress)) {
            continue;
        }
        const topics = (log as { topics?: readonly `0x${string}`[] }).topics;
        if (!topics) {
            continue;
        }

        try {
            const decoded = decodeEventLog({
                abi: [invoicePaymentPendingEvent],
                data: log.data,
                topics: [...topics] as any,
            }) as {
                eventName: string;
                args: {
                    invoiceId: `0x${string}`;
                    amountCtHash: `0x${string}`;
                };
            };

            if (decoded.eventName === 'InvoicePaymentPending') {
                return {
                    invoiceId: decoded.args.invoiceId,
                    amountCtHash: decoded.args.amountCtHash,
                };
            }
        } catch {
            continue;
        }
    }

    return null;
}

export async function confirmTransferVerificationFromReceipt(
    endpoint: string,
    receipt: TransactionReceipt,
    contractAddress: string,
    extra?: Record<string, any>,
): Promise<WalletTxResult<any>> {
    const request = getTransferVerificationRequest(receipt, contractAddress);
    if (!request) {
        throw new Error('No transfer verification request was emitted by the contract.');
    }

    const proof = await decryptForTransaction(request.successCtHash, { requirePermit: false });
    const success = proof.decryptedValue === 1n;

    return walletFirstTx(
        endpoint,
        {
            transferId: request.transferId,
            success,
            signature: proof.signature,
            ...(extra ?? {}),
        },
        (_prepareData, txHash) => ({
            transferId: request.transferId,
            success,
            signature: proof.signature,
            ...(extra ?? {}),
            txHash,
        }),
    );
}

export async function confirmInvoicePaymentFromReceipt(
    endpoint: string,
    receipt: TransactionReceipt,
    contractAddress: string,
): Promise<WalletTxResult<any>> {
    const request = getInvoicePaymentPendingRequest(receipt, contractAddress);
    if (!request) {
        throw new Error('No pending invoice payment event was emitted by the contract.');
    }

    const proof = await decryptForTransaction(request.amountCtHash, { requirePermit: true });

    return walletFirstTx(
        endpoint,
        {
            plaintext: proof.decryptedValue.toString(),
            signature: proof.signature,
        },
        (_prepareData, txHash) => ({
            plaintext: proof.decryptedValue.toString(),
            signature: proof.signature,
            txHash,
        }),
    );
}

export async function buildWinnerProofShare(ctHash: string | bigint, bidId: `0x${string}`): Promise<WinnerProofShare> {
    const proof = await decryptForTransaction(ctHash, { requirePermit: true });
    return {
        bidId,
        plaintext: proof.decryptedValue.toString(),
        signature: proof.signature,
    };
}

export function encodeWinnerProofShare(proof: WinnerProofShare): string {
    return JSON.stringify(proof, null, 2);
}

export function decodeWinnerProofShare(raw: string): WinnerProofShare {
    const parsed = JSON.parse(raw);
    if (!parsed?.bidId || !parsed?.plaintext || !parsed?.signature) {
        throw new Error('Winner proof package is missing bidId, plaintext, or signature.');
    }
    return parsed as WinnerProofShare;
}
