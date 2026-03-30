'use client';

import type { PublicClient, WalletClient } from 'viem';
import {
    CofheErrorCode,
    Encryptable,
    FheTypes,
    isCofheError,
    type CofheClient,
} from '@cofhe/sdk';
import { chains } from '@cofhe/sdk/chains';
import type { Permit } from '@cofhe/sdk/permits';
import { createCofheClient, createCofheConfig } from '@cofhe/sdk/web';
import { appChain } from '@/contexts/ProvableWalletProvider';
import type { EncryptedBidInput } from './sealProtocol';

type ConnectedClients = {
    publicClient: PublicClient;
    walletClient: WalletClient;
};

type DecryptForTxOptions = {
    requirePermit?: boolean;
    permit?: Permit | string;
};

let cofheClient: CofheClient | null = null;
let connectedClients: ConnectedClients | null = null;

function getLiveBrowserClients(): ConnectedClients | null {
    if (typeof window === 'undefined') {
        return null;
    }

    const w = window as any;
    if (!w.__wagmiPublicClient || !w.__wagmiWalletClient) {
        return null;
    }

    return {
        publicClient: w.__wagmiPublicClient as PublicClient,
        walletClient: w.__wagmiWalletClient as WalletClient,
    };
}

function getSupportedChain() {
    if (appChain.id !== chains.sepolia.id) {
        throw new Error(`Unsupported CoFHE chain ${appChain.id}. This app is configured for Ethereum Sepolia only.`);
    }

    return chains.sepolia;
}

function getOrCreateClient(): CofheClient {
    if (!cofheClient) {
        cofheClient = createCofheClient(
            createCofheConfig({
                supportedChains: [getSupportedChain()],
            }),
        );
    }

    return cofheClient;
}

function normalizeCtHash(ctHash: bigint | string): bigint {
    return typeof ctHash === 'bigint' ? ctHash : BigInt(ctHash);
}

function getConnectedAccountOrThrow(): string {
    const account = connectedClients?.walletClient.account?.address;
    if (!account) {
        throw new Error('Connect your wallet and initialise CoFHE before using encrypted actions.');
    }
    return account;
}

export function isCofheAvailable(): boolean {
    return typeof window !== 'undefined';
}

export function isCofheConnected(): boolean {
    return Boolean(cofheClient?.connected && connectedClients);
}

export function mapCofheError(error: unknown): string {
    if (!isCofheError(error)) {
        return error instanceof Error ? error.message : 'Unknown CoFHE error';
    }

    switch (error.code) {
        case CofheErrorCode.NotConnected:
        case CofheErrorCode.MissingWalletClient:
        case CofheErrorCode.MissingPublicClient:
            return 'Connect your wallet on Ethereum Sepolia before using encrypted actions.';
        case CofheErrorCode.UnsupportedChain:
        case CofheErrorCode.ChainIdUninitialized:
            return 'Switch your wallet to Ethereum Sepolia and try again.';
        case CofheErrorCode.PermitNotFound:
            return 'A decryption permit is missing. Approve a permit in your wallet and retry.';
        case CofheErrorCode.InvalidPermitData:
        case CofheErrorCode.InvalidPermitDomain:
            return 'The stored permit is invalid for this wallet or chain. Recreate the permit and retry.';
        case CofheErrorCode.DecryptFailed:
        case CofheErrorCode.DecryptReturnedNull:
            return 'CoFHE decryption failed. Wait a moment and retry the request.';
        case CofheErrorCode.ZkPackFailed:
        case CofheErrorCode.ZkProveFailed:
        case CofheErrorCode.ZkVerifyFailed:
            return 'Encryption proof generation failed. Retry with a smaller encrypted payload.';
        default:
            return error.message;
    }
}

export async function initCofheClient(
    publicClient: PublicClient,
    walletClient: WalletClient,
): Promise<boolean> {
    try {
        const client = getOrCreateClient();
        const snapshot = client.getSnapshot();
        const walletAccount = walletClient.account?.address?.toLowerCase();
        const needsReconnect =
            !snapshot.connected ||
            snapshot.chainId !== appChain.id ||
            snapshot.account?.toLowerCase() !== walletAccount;

        if (needsReconnect) {
            await client.connect(publicClient as any, walletClient as any);
        }

        await client.permits.getOrCreateSelfPermit();
        connectedClients = { publicClient, walletClient };
        return true;
    } catch (error) {
        console.error('[cofhe] init failed', error);
        throw new Error(mapCofheError(error));
    }
}

async function requireConnectedClient(): Promise<CofheClient> {
    const client = getOrCreateClient();
    const liveClients = getLiveBrowserClients();

    if (liveClients) {
        const snapshot = client.getSnapshot();
        const liveWallet = liveClients.walletClient.account?.address?.toLowerCase?.();
        const connectedWallet = connectedClients?.walletClient.account?.address?.toLowerCase?.();
        const needsReconnect =
            !snapshot.connected ||
            !connectedClients ||
            snapshot.chainId !== appChain.id ||
            snapshot.account?.toLowerCase() !== liveWallet ||
            connectedWallet !== liveWallet;

        if (needsReconnect) {
            await initCofheClient(liveClients.publicClient, liveClients.walletClient);
        }
    }

    if (!client.connected || !connectedClients) {
        throw new Error('Connect your wallet and initialise CoFHE before using encrypted actions.');
    }

    const snapshot = client.getSnapshot();
    if (snapshot.chainId !== appChain.id) {
        throw new Error('Wallet is connected to the wrong network. Switch to Ethereum Sepolia.');
    }

    return client;
}

export async function ensureSelfPermit(): Promise<Permit> {
    try {
        const client = await requireConnectedClient();
        return await client.permits.getOrCreateSelfPermit();
    } catch (error) {
        throw new Error(mapCofheError(error));
    }
}

export async function getActivePermit(): Promise<Permit | undefined> {
    const client = await requireConnectedClient();
    return client.permits.getActivePermit();
}

export async function encryptBidAmount(bidAmount: bigint): Promise<EncryptedBidInput> {
    try {
        const client = await requireConnectedClient();
        const account = getConnectedAccountOrThrow();
        const [encrypted] = await client
            .encryptInputs([Encryptable.uint64(bidAmount)])
            .setAccount(account)
            .setChainId(appChain.id)
            .execute();

        const rawSig = encrypted.signature as string;
        return {
            ctHash: encrypted.ctHash.toString(),
            securityZone: encrypted.securityZone,
            utype: encrypted.utype,
            signature: rawSig.startsWith('0x') ? rawSig : `0x${rawSig}`,
        };
    } catch (error) {
        throw new Error(mapCofheError(error));
    }
}

export async function decryptForTransaction(
    ctHash: bigint | string,
    options?: DecryptForTxOptions,
): Promise<{
    ctHash: bigint | string;
    decryptedValue: bigint;
    signature: `0x${string}`;
}> {
    try {
        const client = await requireConnectedClient();
        const account = getConnectedAccountOrThrow();
        const builder = client
            .decryptForTx(normalizeCtHash(ctHash))
            .setAccount(account)
            .setChainId(appChain.id);

        if (options?.requirePermit === false) {
            return await builder.withoutPermit().execute();
        }

        if (options?.permit) {
            if (typeof options.permit === 'string') {
                return await builder.withPermit(options.permit).execute();
            }
            return await builder.withPermit(options.permit).execute();
        }

        await client.permits.getOrCreateSelfPermit();
        return await builder.withPermit().execute();
    } catch (error) {
        throw new Error(mapCofheError(error));
    }
}

export async function decryptForView(
    ctHash: bigint | string,
    fheType: number = FheTypes.Uint64,
): Promise<bigint | boolean | string> {
    try {
        const client = await requireConnectedClient();
        const account = getConnectedAccountOrThrow();
        await client.permits.getOrCreateSelfPermit();
        return await client
            .decryptForView(normalizeCtHash(ctHash), fheType)
            .setAccount(account)
            .setChainId(appChain.id)
            .withPermit()
            .execute();
    } catch (error) {
        throw new Error(mapCofheError(error));
    }
}

export function getCofheClient(): CofheClient | null {
    return cofheClient;
}

export function disconnectCofhe(): void {
    cofheClient?.disconnect();
    connectedClients = null;
}

export { Encryptable, FheTypes };
