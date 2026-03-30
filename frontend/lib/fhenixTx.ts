'use client';

import { authenticatedFetch } from './authFetch';
import { waitForTransaction, getExplorerTxUrl } from './sepoliaClient';
import type { Hash } from 'viem';
import type { EncryptedBidInput } from './sealProtocol';

// Transaction payload from backend
export type TxPayload = {
    to: `0x${string}`;
    data: `0x${string}`;
    value: string;
    chainId: number;
};

// Transaction result
export type TxResult = {
    txHash: Hash;
    explorerUrl: string;
    receipt?: any;
};

// CoFHE encryption result type
export type EncryptedValue = {
    ctHash: bigint;
    securityZone: number;
    utype: number;
    signature: string;
};

function toRpcHex(value: bigint): `0x${string}` {
    return `0x${value.toString(16)}`;
}

const SAFE_SEPOLIA_GAS_CAP = 16_000_000n;
const FALLBACK_FHE_GAS_LIMIT = 15_500_000n;
const MIN_PRIORITY_FEE_PER_GAS = 1_500_000_000n;
const MIN_MAX_FEE_PER_GAS = 5_000_000_000n;

function bufferGasEstimate(estimatedGas: bigint): bigint {
    const multiplier =
        estimatedGas >= 12_000_000n ? 105n :
        estimatedGas >= 5_000_000n ? 115n :
        130n;
    const additive = estimatedGas >= 12_000_000n ? 50_000n : 25_000n;
    const buffered = ((estimatedGas * multiplier) / 100n) + additive;
    return buffered > SAFE_SEPOLIA_GAS_CAP ? SAFE_SEPOLIA_GAS_CAP : buffered;
}

async function estimateBufferedFees(walletClient: any): Promise<
    | {
          maxFeePerGas: bigint;
          maxPriorityFeePerGas: bigint;
      }
    | undefined
> {
    try {
        const gasPriceHex = await walletClient.request({ method: 'eth_gasPrice' });
        const gasPrice = BigInt(gasPriceHex);
        const priorityFee = gasPrice / 5n;
        const bufferedPriorityFee =
            priorityFee > 0n
                ? (((priorityFee * 200n) / 100n) > MIN_PRIORITY_FEE_PER_GAS
                      ? ((priorityFee * 200n) / 100n)
                      : MIN_PRIORITY_FEE_PER_GAS)
                : MIN_PRIORITY_FEE_PER_GAS;
        const suggestedMaxFee = ((gasPrice * 250n) / 100n) + bufferedPriorityFee;
        const bufferedMaxFee =
            suggestedMaxFee > MIN_MAX_FEE_PER_GAS ? suggestedMaxFee : MIN_MAX_FEE_PER_GAS;

        return {
            maxFeePerGas: bufferedMaxFee,
            maxPriorityFeePerGas: bufferedPriorityFee,
        };
    } catch (error) {
        console.warn('[fhenixTx] fee estimation fallback', error);
        return undefined;
    }
}

async function estimateBufferedGas(walletClient: any, tx: TxPayload): Promise<bigint | undefined> {
    try {
        const from =
            walletClient?.account?.address ||
            (await walletClient.request({ method: 'eth_accounts' }))?.[0];

        if (!from) {
            return undefined;
        }

        const estimatedGasHex = await walletClient.request({
            method: 'eth_estimateGas',
            params: [
                {
                    from,
                    to: tx.to,
                    data: tx.data,
                    value: toRpcHex(BigInt(tx.value || '0')),
                },
            ],
        });

        const estimatedGas = BigInt(estimatedGasHex);
        return bufferGasEstimate(estimatedGas);
    } catch (error) {
        console.warn('[fhenixTx] gas estimation fallback', error);
        if (tx.data && tx.data !== '0x') {
            return FALLBACK_FHE_GAS_LIMIT;
        }
        return undefined;
    }
}

/**
 * Convert CoFHE SDK EncryptedValue to backend-expected format
 */
export function toEncryptedBidInput(encrypted: EncryptedValue): EncryptedBidInput {
    return {
        ctHash: encrypted.ctHash.toString(),
        securityZone: encrypted.securityZone,
        utype: encrypted.utype,
        signature: encrypted.signature,
    };
}

/**
 * Execute a Fhenix transaction:
 * 1. Call backend to get unsigned tx payload
 * 2. Sign and send via wallet
 * 3. Wait for confirmation
 */
export async function executeFhenixTx(
    endpoint: string,
    body: Record<string, any>,
    walletClient: any,
    options?: {
        waitForConfirmation?: boolean;
        onTxHash?: (hash: Hash) => void;
    },
): Promise<TxResult> {
    // 1. Get unsigned transaction from backend
    const response = await authenticatedFetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });

    const data = await response.json();
    if (data.status !== 'success' || !data.data?.tx) {
        throw new Error(data.error?.message || 'Failed to prepare transaction');
    }

    const txPayload: TxPayload = data.data.tx;
    const gas = await estimateBufferedGas(walletClient, txPayload);
    const fees = await estimateBufferedFees(walletClient);

    // 2. Sign and send transaction
    const txHash = await walletClient.sendTransaction({
        to: txPayload.to,
        data: txPayload.data,
        value: BigInt(txPayload.value || '0'),
        chainId: txPayload.chainId,
        ...(gas ? { gas } : {}),
        ...(fees ?? {}),
    });

    options?.onTxHash?.(txHash);

    const result: TxResult = {
        txHash,
        explorerUrl: getExplorerTxUrl(txHash),
    };

    // 3. Wait for confirmation if requested
    if (options?.waitForConfirmation !== false) {
        result.receipt = await waitForTransaction(txHash, { timeout: 300_000 });
    }

    return result;
}

/**
 * Report transaction to backend for tracking
 */
export async function reportTransaction(
    idempotencyKey: string,
    txHash: Hash,
    rfqId?: string,
): Promise<void> {
    try {
        await authenticatedFetch(`/api/tx/${idempotencyKey}/submit`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                txHash,
                rfqId,
            }),
        });
    } catch (error) {
        console.warn('Failed to report transaction:', error);
    }
}

/**
 * Create RFQ transaction
 */
export async function createRfqTx(
    walletClient: any,
    params: {
        biddingDeadline: number;
        revealDeadline: number;
        minBid: string;
        minBidCount: number;
        flatStake: string;
        metadataHash: string;
        tokenType: number;
        mode: number;
        salt: string;
    },
    onTxHash?: (hash: Hash) => void,
): Promise<TxResult & { rfqId: string }> {
    const response = await authenticatedFetch('/api/fhenix/rfq/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
    });

    const data = await response.json();
    if (data.status !== 'success' || !data.data?.tx) {
        throw new Error(data.error?.message || 'Failed to prepare RFQ transaction');
    }

    const txPayload: TxPayload = data.data.tx;
    const rfqId = data.data.rfqId;
    const gas = await estimateBufferedGas(walletClient, txPayload);
    const fees = await estimateBufferedFees(walletClient);

    const txHash = await walletClient.sendTransaction({
        to: txPayload.to,
        data: txPayload.data,
        value: BigInt(txPayload.value || '0'),
        chainId: txPayload.chainId,
        ...(gas ? { gas } : {}),
        ...(fees ?? {}),
    });

    onTxHash?.(txHash);

    const receipt = await waitForTransaction(txHash, { timeout: 300_000 });

    return {
        txHash,
        explorerUrl: getExplorerTxUrl(txHash),
        receipt,
        rfqId,
    };
}

/**
 * Submit encrypted bid transaction
 */
export async function submitBidTx(
    walletClient: any,
    params: {
        rfqId: string;
        stake: string;
        encryptedBid: EncryptedBidInput;
    },
    onTxHash?: (hash: Hash) => void,
): Promise<TxResult & { bidId: string }> {
    const response = await authenticatedFetch(`/api/fhenix/rfq/${params.rfqId}/bids`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            stake: params.stake,
            encryptedBid: params.encryptedBid,
        }),
    });

    const data = await response.json();
    if (data.status !== 'success' || !data.data?.tx) {
        throw new Error(data.error?.message || 'Failed to prepare bid transaction');
    }

    const txPayload: TxPayload = data.data.tx;
    const bidId = data.data.bidId;
    const gas = await estimateBufferedGas(walletClient, txPayload);
    const fees = await estimateBufferedFees(walletClient);

    const txHash = await walletClient.sendTransaction({
        to: txPayload.to,
        data: txPayload.data,
        value: BigInt(txPayload.value || '0'),
        chainId: txPayload.chainId,
        ...(gas ? { gas } : {}),
        ...(fees ?? {}),
    });

    onTxHash?.(txHash);

    const receipt = await waitForTransaction(txHash, { timeout: 300_000 });

    return {
        txHash,
        explorerUrl: getExplorerTxUrl(txHash),
        receipt,
        bidId,
    };
}

/**
 * Select winner transaction (with FHE decrypt proof)
 */
export async function selectWinnerTx(
    walletClient: any,
    params: {
        rfqId: string;
        bidId: string;
        plaintext: string;
        signature: string;
    },
    onTxHash?: (hash: Hash) => void,
): Promise<TxResult> {
    const response = await authenticatedFetch(`/api/fhenix/rfq/${params.rfqId}/select-winner`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            bidId: params.bidId,
            plaintext: params.plaintext,
            signature: params.signature,
        }),
    });

    const data = await response.json();
    if (data.status !== 'success' || !data.data?.tx) {
        throw new Error(data.error?.message || 'Failed to prepare select winner transaction');
    }

    const txPayload: TxPayload = data.data.tx;
    const gas = await estimateBufferedGas(walletClient, txPayload);
    const fees = await estimateBufferedFees(walletClient);

    const txHash = await walletClient.sendTransaction({
        to: txPayload.to,
        data: txPayload.data,
        value: BigInt(txPayload.value || '0'),
        chainId: txPayload.chainId,
        ...(gas ? { gas } : {}),
        ...(fees ?? {}),
    });

    onTxHash?.(txHash);

    const receipt = await waitForTransaction(txHash, { timeout: 300_000 });

    return {
        txHash,
        explorerUrl: getExplorerTxUrl(txHash),
        receipt,
    };
}

/**
 * Fund escrow transaction
 */
export async function fundEscrowTx(
    walletClient: any,
    params: {
        rfqId: string;
        amount: string;
    },
    onTxHash?: (hash: Hash) => void,
): Promise<TxResult> {
    const response = await authenticatedFetch(`/api/fhenix/rfq/${params.rfqId}/fund-escrow`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            amount: params.amount,
        }),
    });

    const data = await response.json();
    if (data.status !== 'success' || !data.data?.tx) {
        throw new Error(data.error?.message || 'Failed to prepare fund escrow transaction');
    }

    const txPayload: TxPayload = data.data.tx;
    const gas = await estimateBufferedGas(walletClient, txPayload);
    const fees = await estimateBufferedFees(walletClient);

    const txHash = await walletClient.sendTransaction({
        to: txPayload.to,
        data: txPayload.data,
        value: BigInt(txPayload.value || '0'),
        chainId: txPayload.chainId,
        ...(gas ? { gas } : {}),
        ...(fees ?? {}),
    });

    onTxHash?.(txHash);

    const receipt = await waitForTransaction(txHash, { timeout: 300_000 });

    return {
        txHash,
        explorerUrl: getExplorerTxUrl(txHash),
        receipt,
    };
}

/**
 * Release payment transaction
 */
export async function releasePaymentTx(
    walletClient: any,
    params: {
        rfqId: string;
        amount: string;
    },
    onTxHash?: (hash: Hash) => void,
): Promise<TxResult> {
    const response = await authenticatedFetch(`/api/fhenix/rfq/${params.rfqId}/release`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            amount: params.amount,
        }),
    });

    const data = await response.json();
    if (data.status !== 'success' || !data.data?.tx) {
        throw new Error(data.error?.message || 'Failed to prepare release transaction');
    }

    const txPayload: TxPayload = data.data.tx;
    const gas = await estimateBufferedGas(walletClient, txPayload);
    const fees = await estimateBufferedFees(walletClient);

    const txHash = await walletClient.sendTransaction({
        to: txPayload.to,
        data: txPayload.data,
        value: BigInt(txPayload.value || '0'),
        chainId: txPayload.chainId,
        ...(gas ? { gas } : {}),
        ...(fees ?? {}),
    });

    onTxHash?.(txHash);

    const receipt = await waitForTransaction(txHash, { timeout: 300_000 });

    return {
        txHash,
        explorerUrl: getExplorerTxUrl(txHash),
        receipt,
    };
}

/**
 * Winner respond transaction (accept/reject)
 */
export async function winnerRespondTx(
    walletClient: any,
    params: {
        rfqId: string;
        accept: boolean;
    },
    onTxHash?: (hash: Hash) => void,
): Promise<TxResult> {
    const response = await authenticatedFetch(`/api/fhenix/rfq/${params.rfqId}/winner-respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            accept: params.accept,
        }),
    });

    const data = await response.json();
    if (data.status !== 'success' || !data.data?.tx) {
        throw new Error(data.error?.message || 'Failed to prepare winner respond transaction');
    }

    const txPayload: TxPayload = data.data.tx;
    const gas = await estimateBufferedGas(walletClient, txPayload);
    const fees = await estimateBufferedFees(walletClient);

    const txHash = await walletClient.sendTransaction({
        to: txPayload.to,
        data: txPayload.data,
        value: BigInt(txPayload.value || '0'),
        chainId: txPayload.chainId,
        ...(gas ? { gas } : {}),
        ...(fees ?? {}),
    });

    onTxHash?.(txHash);

    const receipt = await waitForTransaction(txHash, { timeout: 300_000 });

    return {
        txHash,
        explorerUrl: getExplorerTxUrl(txHash),
        receipt,
    };
}

// ============================================================================
// Vickrey Auction Transactions
// ============================================================================

export async function vickreyCommitBidTx(
    walletClient: any,
    params: {
        auctionId: string;
        stake: string;
        encryptedBid: EncryptedBidInput;
    },
    onTxHash?: (hash: Hash) => void,
): Promise<TxResult & { bidId: string }> {
    const response = await authenticatedFetch(`/api/fhenix/auction/vickrey/${params.auctionId}/commit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            stake: params.stake,
            encryptedBid: params.encryptedBid,
        }),
    });

    const data = await response.json();
    if (data.status !== 'success' || !data.data?.tx) {
        throw new Error(data.error?.message || 'Failed to prepare commit bid transaction');
    }

    const txPayload: TxPayload = data.data.tx;
    const bidId = data.data.bidId;
    const gas = await estimateBufferedGas(walletClient, txPayload);
    const fees = await estimateBufferedFees(walletClient);

    const txHash = await walletClient.sendTransaction({
        to: txPayload.to,
        data: txPayload.data,
        value: BigInt(txPayload.value || '0'),
        chainId: txPayload.chainId,
        ...(gas ? { gas } : {}),
        ...(fees ?? {}),
    });

    onTxHash?.(txHash);

    const receipt = await waitForTransaction(txHash, { timeout: 300_000 });

    return {
        txHash,
        explorerUrl: getExplorerTxUrl(txHash),
        receipt,
        bidId,
    };
}

export async function vickreyRevealBidTx(
    walletClient: any,
    params: {
        auctionId: string;
        bidId: string;
        plaintext: string;
        signature: string;
    },
    onTxHash?: (hash: Hash) => void,
): Promise<TxResult> {
    const response = await authenticatedFetch(`/api/fhenix/auction/vickrey/${params.auctionId}/reveal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            bidId: params.bidId,
            plaintext: params.plaintext,
            signature: params.signature,
        }),
    });

    const data = await response.json();
    if (data.status !== 'success' || !data.data?.tx) {
        throw new Error(data.error?.message || 'Failed to prepare reveal bid transaction');
    }

    const txPayload: TxPayload = data.data.tx;
    const gas = await estimateBufferedGas(walletClient, txPayload);
    const fees = await estimateBufferedFees(walletClient);

    const txHash = await walletClient.sendTransaction({
        to: txPayload.to,
        data: txPayload.data,
        value: BigInt(txPayload.value || '0'),
        chainId: txPayload.chainId,
        ...(gas ? { gas } : {}),
        ...(fees ?? {}),
    });

    onTxHash?.(txHash);

    const receipt = await waitForTransaction(txHash, { timeout: 300_000 });

    return {
        txHash,
        explorerUrl: getExplorerTxUrl(txHash),
        receipt,
    };
}

// ============================================================================
// Dutch Auction Transactions
// ============================================================================

export async function dutchCommitTx(
    walletClient: any,
    params: {
        auctionId: string;
        deposit: string;
    },
    onTxHash?: (hash: Hash) => void,
): Promise<TxResult> {
    const response = await authenticatedFetch(`/api/fhenix/auction/dutch/${params.auctionId}/commit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            deposit: params.deposit,
        }),
    });

    const data = await response.json();
    if (data.status !== 'success' || !data.data?.tx) {
        throw new Error(data.error?.message || 'Failed to prepare Dutch commit transaction');
    }

    const txPayload: TxPayload = data.data.tx;
    const gas = await estimateBufferedGas(walletClient, txPayload);
    const fees = await estimateBufferedFees(walletClient);

    const txHash = await walletClient.sendTransaction({
        to: txPayload.to,
        data: txPayload.data,
        value: BigInt(txPayload.value || '0'),
        chainId: txPayload.chainId,
        ...(gas ? { gas } : {}),
        ...(fees ?? {}),
    });

    onTxHash?.(txHash);

    const receipt = await waitForTransaction(txHash, { timeout: 300_000 });

    return {
        txHash,
        explorerUrl: getExplorerTxUrl(txHash),
        receipt,
    };
}

export async function dutchAcceptPriceTx(
    walletClient: any,
    params: {
        auctionId: string;
    },
    onTxHash?: (hash: Hash) => void,
): Promise<TxResult> {
    const response = await authenticatedFetch(`/api/fhenix/auction/dutch/${params.auctionId}/accept-price`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
    });

    const data = await response.json();
    if (data.status !== 'success' || !data.data?.tx) {
        throw new Error(data.error?.message || 'Failed to prepare Dutch accept price transaction');
    }

    const txPayload: TxPayload = data.data.tx;
    const gas = await estimateBufferedGas(walletClient, txPayload);
    const fees = await estimateBufferedFees(walletClient);

    const txHash = await walletClient.sendTransaction({
        to: txPayload.to,
        data: txPayload.data,
        value: BigInt(txPayload.value || '0'),
        chainId: txPayload.chainId,
        ...(gas ? { gas } : {}),
        ...(fees ?? {}),
    });

    onTxHash?.(txHash);

    const receipt = await waitForTransaction(txHash, { timeout: 300_000 });

    return {
        txHash,
        explorerUrl: getExplorerTxUrl(txHash),
        receipt,
    };
}
