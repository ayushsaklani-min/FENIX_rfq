'use client';

import { createWalletClient, custom, type Hash } from 'viem';
import { appChain } from '@/contexts/ProvableWalletProvider';
import { ApiError, authenticatedFetch, authenticatedJson } from './authFetch';
import { getExplorerTxUrl, waitForTransaction } from './sepoliaClient';

export type TxPayload = {
    to: `0x${string}`;
    data: `0x${string}`;
    value?: string;
    chainId: number;
};

export type WalletTxResult<T = any> = {
    success: true;
    data: T;
    txHash?: string;
    explorerUrl?: string;
    idempotencyKey?: string;
    receipt?: any;
} & T;

function normalizeApiData<T = any>(payload: any): T {
    return (payload?.data ?? payload) as T;
}

function normalizePreparedTx(data: any): TxPayload | null {
    if (!data) return null;
    return (data.tx ?? data.request ?? null) as TxPayload | null;
}

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
        console.warn('[walletTx] fee estimation fallback', error);
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
        console.warn('[walletTx] gas estimation fallback', error);
        if (tx.data && tx.data !== '0x') {
            return FALLBACK_FHE_GAS_LIMIT;
        }
        return undefined;
    }
}

async function notifyTracker(
    idempotencyKey: string | undefined,
    payload: Record<string, any>,
): Promise<any | null> {
    if (!idempotencyKey) {
        return null;
    }

    try {
        return await authenticatedJson(`/api/tx/${encodeURIComponent(idempotencyKey)}/submit`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
    } catch (error) {
        console.warn('[walletTx] tracker update failed', error);
        return null;
    }
}

async function getWalletClient(): Promise<any> {
    if (typeof window === 'undefined') {
        throw new Error('Wallet actions are only available in the browser.');
    }

    const w = window as any;
    if (w.__wagmiWalletClient) {
        return w.__wagmiWalletClient;
    }

    if (!w.ethereum) {
        throw new Error('No injected wallet found. Install MetaMask or another Ethereum wallet.');
    }

    const [account] = await w.ethereum.request({ method: 'eth_requestAccounts' });
    if (!account) {
        throw new Error('No wallet account is connected.');
    }

    return createWalletClient({
        account,
        chain: appChain,
        transport: custom(w.ethereum),
    });
}

export async function walletFirstTx<T extends Record<string, any> = any>(
    endpoint: string,
    prepareBody: Record<string, any>,
    buildSubmitBody: (prepareData: any, txHash: string) => Record<string, any>,
    options?: {
        onPrepared?: (data: any) => void;
        onSubmitted?: (txHash: string) => void;
        onConfirmed?: (data: T) => void;
    },
): Promise<WalletTxResult<T>> {
    const prepareData = await authenticatedJson<any>(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(prepareBody),
    });

    options?.onPrepared?.(prepareData);

    const preparedTx = normalizePreparedTx(prepareData);
    if (!preparedTx) {
        return {
            success: true,
            data: prepareData,
            idempotencyKey: prepareData?.idempotencyKey,
            ...(prepareData as T),
        };
    }

    const walletClient = await getWalletClient();
    const gas = await estimateBufferedGas(walletClient, preparedTx);
    const fees = await estimateBufferedFees(walletClient);

    let txHash: Hash;
    try {
        txHash = await walletClient.sendTransaction({
            to: preparedTx.to,
            data: preparedTx.data,
            value: BigInt(preparedTx.value || '0'),
            chainId: preparedTx.chainId,
            ...(gas ? { gas } : {}),
            ...(fees ?? {}),
        });
    } catch (error: any) {
        await notifyTracker(prepareData?.idempotencyKey, {
            txHash: null,
            status: 'rejected',
            error: error?.message || 'Wallet rejected the transaction',
            rawResponse: error,
        });
        throw new ApiError(error?.message || 'Wallet rejected the transaction');
    }

    options?.onSubmitted?.(txHash);

    const receipt = await waitForTransaction(txHash, { timeout: 300_000 });
    const submitBody = buildSubmitBody(prepareData, txHash);

    const tracked = await notifyTracker(prepareData?.idempotencyKey, {
        ...submitBody,
        txHash,
        status: 'confirmed',
        blockHeight: Number(receipt.blockNumber),
        blockHash: receipt.blockHash,
        rawResponse: receipt,
    });

    const submitFallback = !prepareData?.idempotencyKey
        ? await authenticatedFetch(endpoint, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                  ...submitBody,
                  txHash,
              }),
          })
              .then(async (response) => {
                  if (!response.ok) {
                      return null;
                  }
                  const payload = await response.json().catch(() => null);
                  return normalizeApiData(payload);
              })
              .catch(() => null)
        : null;

    const confirmedData = normalizeApiData<T>(tracked) ?? submitFallback ?? (prepareData as T);
    options?.onConfirmed?.(confirmedData);

    return {
        success: true,
        data: confirmedData,
        txHash,
        explorerUrl: getExplorerTxUrl(txHash),
        idempotencyKey: confirmedData?.idempotencyKey || prepareData?.idempotencyKey,
        receipt,
        ...(confirmedData as T),
    };
}

export async function executeSimpleTx(
    txPayload: TxPayload,
    onTxHash?: (hash: Hash) => void,
): Promise<{ txHash: Hash; receipt: any }> {
    const walletClient = await getWalletClient();
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
    return { txHash, receipt };
}

export async function submitTrackedResult(
    endpoint: string,
    txId: string,
    body: Record<string, any>,
): Promise<{ success: boolean; data?: any; error?: string }> {
    try {
        const data = await authenticatedJson(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ txHash: txId, ...body }),
        });
        return { success: true, data };
    } catch (error: any) {
        return { success: false, error: error?.message || 'Failed to submit tracked result' };
    }
}

export type ShieldCreditsRecordSummary = {
    id: string;
    amount: string;
    owner: string;
    spent?: boolean;
};

export type ShieldStablecoinRecordSummary = {
    id: string;
    amount: string;
    owner: string;
    tokenType: string;
    spent?: boolean;
};

export async function listShieldCreditsRecords(_programId?: string): Promise<ShieldCreditsRecordSummary[]> {
    return [];
}

export async function listShieldStablecoinRecords(_programId?: string): Promise<ShieldStablecoinRecordSummary[]> {
    return [];
}

export async function requestCreditsRecord(_amount: string): Promise<{ success: false; error: string }> {
    return {
        success: false,
        error: 'Shield record funding is not part of the Sepolia Fhenix settlement flow.',
    };
}

export async function requestStablecoinRecord(
    _tokenType: string,
    _amount: string,
): Promise<{ success: false; error: string }> {
    return {
        success: false,
        error: 'Shield record funding is not part of the Sepolia Fhenix settlement flow.',
    };
}

export async function requestStablecoinRecordWithProofs(
    _tokenType: string,
    _amount: string,
): Promise<{ success: false; error: string }> {
    return {
        success: false,
        error: 'Sepolia Fhenix uses CoFHE encrypted values, not legacy proof-backed record funding.',
    };
}

export async function executeWithAdapter<T>(
    fn: () => Promise<T>,
    options?: { onError?: (e: Error) => void },
): Promise<T | null> {
    try {
        return await fn();
    } catch (error: any) {
        options?.onError?.(error);
        throw error;
    }
}

export * from './fhenixTx';
