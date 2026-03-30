'use client';

import { createPublicClient, fallback, http, type Hash, type TransactionReceipt } from 'viem';
import type { PublicClient } from 'viem';
import { appChain } from '@/contexts/ProvableWalletProvider';

const SEPOLIA_RPCS = Array.from(
    new Set(
        [
            process.env.NEXT_PUBLIC_FHENIX_RPC_URL,
            process.env.NEXT_PUBLIC_FHENIX_RPC_FALLBACK_URL,
            'https://ethereum-sepolia-rpc.publicnode.com',
        ].filter((value): value is string => Boolean(value && value.trim())),
    ),
);
const SEPOLIA_EXPLORER =
    process.env.NEXT_PUBLIC_FHENIX_EXPLORER_URL ||
    'https://sepolia.etherscan.io';

let publicClient: PublicClient | null = null;

function getPublicClient() {
    if (!publicClient) {
        publicClient = createPublicClient({
            chain: appChain,
            transport: fallback(
                SEPOLIA_RPCS.map((url) =>
                    http(url, {
                        retryCount: 1,
                        retryDelay: 250,
                    }),
                ),
            ),
        }) as PublicClient;
    }
    return publicClient;
}

export async function fetchCurrentBlockHeight(): Promise<number | null> {
    try {
        const client = getPublicClient();
        const blockNumber = await client.getBlockNumber();
        return Number(blockNumber);
    } catch (error) {
        console.error('Failed to fetch block height:', error);
        return null;
    }
}

export async function fetchTransaction(txHash: Hash): Promise<any | null> {
    try {
        const client = getPublicClient();
        const tx = await client.getTransaction({ hash: txHash });
        return tx;
    } catch (error) {
        console.error('Failed to fetch transaction:', error);
        return null;
    }
}

export async function fetchTransactionReceipt(txHash: Hash): Promise<TransactionReceipt | null> {
    try {
        const client = getPublicClient();
        const receipt = await client.getTransactionReceipt({ hash: txHash });
        return receipt;
    } catch (error) {
        console.error('Failed to fetch transaction receipt:', error);
        return null;
    }
}

export async function waitForTransaction(
    txHash: Hash,
    options?: {
        confirmations?: number;
        timeout?: number;
    },
): Promise<TransactionReceipt> {
    const client = getPublicClient();
    const receipt = await client.waitForTransactionReceipt({
        hash: txHash,
        confirmations: options?.confirmations ?? 1,
        timeout: options?.timeout ?? 120_000,
    });

    if (receipt.status === 'reverted') {
        throw new Error('Transaction reverted');
    }

    return receipt;
}

export function getExplorerTxUrl(txHash: string): string {
    return `${SEPOLIA_EXPLORER}/tx/${txHash}`;
}

export function getExplorerAddressUrl(address: string): string {
    return `${SEPOLIA_EXPLORER}/address/${address}`;
}

export function getExplorerBlockUrl(blockNumber: number | bigint): string {
    return `${SEPOLIA_EXPLORER}/block/${blockNumber}`;
}

export async function isTransactionSuccessful(txHash: Hash): Promise<boolean> {
    const receipt = await fetchTransactionReceipt(txHash);
    return receipt?.status === 'success';
}

export async function getGasPrice(): Promise<bigint | null> {
    try {
        const client = getPublicClient();
        return await client.getGasPrice();
    } catch {
        return null;
    }
}

export async function estimateGas(params: {
    to: `0x${string}`;
    data?: `0x${string}`;
    value?: bigint;
    account?: `0x${string}`;
}): Promise<bigint | null> {
    try {
        const client = getPublicClient();
        return await client.estimateGas(params);
    } catch {
        return null;
    }
}

export async function readContract<T>(params: {
    address: `0x${string}`;
    abi: any[];
    functionName: string;
    args?: any[];
}): Promise<T | null> {
    try {
        const client = getPublicClient();
        const result = await client.readContract({
            address: params.address,
            abi: params.abi,
            functionName: params.functionName,
            args: params.args || [],
        } as any);
        return result as T;
    } catch (error) {
        console.error('Failed to read contract:', error);
        return null;
    }
}

export { getPublicClient };
