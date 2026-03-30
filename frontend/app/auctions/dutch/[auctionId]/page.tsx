'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { encodeFunctionData } from 'viem';
import { TxStatusView } from '@/components/TxStatus';
import { Button } from '@/components/ui/Button';
import {
    ActionBar,
    CopyableText,
    DataGrid,
    DataPoint,
    EmptyState,
    Field,
    Notice,
    PageHeader,
    PageShell,
    Panel,
    TextInput,
} from '@/components/protocol/ProtocolPrimitives';
import { authenticatedFetch } from '@/lib/authFetch';
import { fetchCurrentBlockHeight, getPublicClient, readContract } from '@/lib/sepoliaClient';
import { CONTRACT_ADDRESSES, PRICING_MODE } from '@/lib/sealProtocol';
import { confirmTransferVerificationFromReceipt } from '@/lib/fhenixWorkflow';
import { truncateMiddle } from '@/lib/utils';
import { executeSimpleTx, walletFirstTx } from '@/lib/walletTx';
import { useWallet } from '@/contexts/WalletContext';

type AuctionDetail = {
    id: string;
    creator: string;
    rfqId: string;
    startPrice: string;
    reservePrice: string;
    priceDecrement: string;
    startBlock: number;
    endBlock: number;
    statusCode: number;
    committor: string;
    commitBlock: number;
    commitPrice: string;
    winner: string;
    finalPrice: string;
    currentPrice: string;
    currentBlock: number;
};

type AcceptanceDetail = {
    auctionId: string;
    acceptanceId: string;
    bidder: string;
    stake: string;
    commitBlock: number;
    committedPrice: string;
    confirmed: boolean;
    slashed: boolean;
};

const FHERC20_OPERATOR_ABI = [
    {
        type: 'function',
        name: 'setOperator',
        stateMutability: 'nonpayable',
        inputs: [
            { name: 'operator', type: 'address' },
            { name: 'until', type: 'uint48' },
        ],
        outputs: [],
    },
    {
        type: 'function',
        name: 'isOperator',
        stateMutability: 'view',
        inputs: [
            { name: 'holder', type: 'address' },
            { name: 'spender', type: 'address' },
        ],
        outputs: [{ name: '', type: 'bool' }],
    },
] as const;

function dutchStatusLabel(statusCode: number) {
    if (statusCode === 1) return 'ACTIVE';
    if (statusCode === 2) return 'COMMITTED';
    if (statusCode === 3) return 'CONFIRMED';
    if (statusCode === 4) return 'EXPIRED';
    if (statusCode === 5) return 'CANCELLED';
    return 'UNKNOWN';
}

export default function DutchDetailPage({ params }: { params: { auctionId: string } }) {
    const { walletAddress, sessionHydrating } = useWallet();
    const [auction, setAuction] = useState<AuctionDetail | null>(null);
    const [savedAcceptances, setSavedAcceptances] = useState<AcceptanceDetail[]>([]);
    const [selectedAcceptanceId, setSelectedAcceptanceId] = useState<string | null>(null);
    const [manualAcceptanceId, setManualAcceptanceId] = useState('');
    const [acceptance, setAcceptance] = useState<AcceptanceDetail | null>(null);
    const [currentBlock, setCurrentBlock] = useState<number | null>(null);
    const [txKey, setTxKey] = useState<string | null>(null);
    const [txHash, setTxHash] = useState<string | null>(null);
    const [operatorApproved, setOperatorApproved] = useState<boolean | null>(null);
    const [approving, setApproving] = useState(false);
    const [loading, setLoading] = useState(true);
    const [acting, setActing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);

    async function loadAcceptanceDetail(acceptanceId: string) {
        const response = await authenticatedFetch(
            `/api/fhenix/auction/dutch/${encodeURIComponent(params.auctionId)}/acceptances/${encodeURIComponent(acceptanceId)}`,
        );
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload?.status !== 'success') {
            return null;
        }
        return payload.data as AcceptanceDetail;
    }

    async function loadAuctionState() {
        const [auctionResponse, acceptancesResponse, blockHeight] = await Promise.all([
            authenticatedFetch(`/api/fhenix/auction/dutch/${encodeURIComponent(params.auctionId)}`),
            authenticatedFetch(`/api/fhenix/auction/dutch/${encodeURIComponent(params.auctionId)}/acceptances`),
            fetchCurrentBlockHeight(),
        ]);
        const auctionPayload = await auctionResponse.json();
        const acceptancesPayload = await acceptancesResponse.json().catch(() => ({ data: [] }));
        if (!auctionResponse.ok || auctionPayload?.status !== 'success') {
            throw new Error(auctionPayload?.error?.message || 'Failed to load the Dutch auction.');
        }

        const acceptances = Array.isArray(acceptancesPayload?.data) ? (acceptancesPayload.data as AcceptanceDetail[]) : [];
        const ownAcceptances = walletAddress
            ? acceptances.filter((acceptance) => acceptance.bidder.toLowerCase() === walletAddress.toLowerCase())
            : acceptances;
        const activeAcceptanceId = (selectedAcceptanceId || manualAcceptanceId || ownAcceptances[0]?.acceptanceId || '').trim();
        const acceptancePayload = ownAcceptances.find((entry) => entry.acceptanceId.toLowerCase() === activeAcceptanceId.toLowerCase()) ?? null;

        setAuction(auctionPayload.data);
        setCurrentBlock(blockHeight);
        setSavedAcceptances(ownAcceptances);
        setAcceptance(acceptancePayload);
        if (activeAcceptanceId) {
            setSelectedAcceptanceId(activeAcceptanceId);
            setManualAcceptanceId(activeAcceptanceId);
        }
    }

    useEffect(() => {
        let cancelled = false;

        if (sessionHydrating) {
            return () => {
                cancelled = true;
            };
        }

        const load = async () => {
            try {
                await loadAuctionState();
            } catch (caught: any) {
                if (!cancelled) {
                    setError(caught?.message || 'Failed to load the Dutch auction.');
                }
            } finally {
                if (!cancelled) {
                    setLoading(false);
                }
            }
        };

        load();
        return () => {
            cancelled = true;
        };
    }, [params.auctionId, sessionHydrating, walletAddress]);

    useEffect(() => {
        let cancelled = false;

        const loadOperatorStatus = async () => {
            if (!walletAddress) {
                if (!cancelled) {
                    setOperatorApproved(null);
                }
                return;
            }

            const approved = await readContract<boolean>({
                address: CONTRACT_ADDRESSES.stakeToken as `0x${string}`,
                abi: FHERC20_OPERATOR_ABI as any[],
                functionName: 'isOperator',
                args: [walletAddress, CONTRACT_ADDRESSES.dutch],
            });

            if (!cancelled) {
                setOperatorApproved(Boolean(approved));
            }
        };

        loadOperatorStatus();
        return () => {
            cancelled = true;
        };
    }, [walletAddress]);

    const effectiveAcceptanceId = (selectedAcceptanceId || manualAcceptanceId).trim();
    const linkedRfq = auction?.rfqId && auction.rfqId !== `0x${'0'.repeat(64)}` ? auction.rfqId : null;

    const handleEnableOperator = async () => {
        if (!walletAddress) {
            setError('Connect your wallet before enabling stake-token access.');
            return;
        }

        setApproving(true);
        setError(null);
        setSuccess(null);

        try {
            const latestBlock = await getPublicClient().getBlock();
            const until = Number(latestBlock.timestamp) + 600;
            const data = encodeFunctionData({
                abi: FHERC20_OPERATOR_ABI,
                functionName: 'setOperator',
                args: [CONTRACT_ADDRESSES.dutch, until],
            });

            const result = await executeSimpleTx({
                to: CONTRACT_ADDRESSES.stakeToken,
                data,
                value: '0',
                chainId: Number(process.env.NEXT_PUBLIC_FHENIX_CHAIN_ID || '11155111'),
            });

            setTxHash(result.txHash || null);
            setOperatorApproved(true);
            setSuccess('Stake-token access enabled for 10 minutes. You can commit or direct-accept now.');
        } catch (caught: any) {
            setError(caught?.message || 'Failed to enable stake-token access.');
        } finally {
            setApproving(false);
        }
    };

    const commitAcceptance = async () => {
        if (acting) {
            return;
        }

        setActing(true);
        setError(null);
        setSuccess(null);

        try {
            if (!operatorApproved) {
                throw new Error('Enable stake-token access first so the auction contract can lock the flat stake.');
            }
            const result = await walletFirstTx(
                `/api/fhenix/auction/dutch/${encodeURIComponent(params.auctionId)}/commit`,
                {},
                (_prepareData, confirmedTxHash) => ({ txHash: confirmedTxHash }),
            );

            if (!result.receipt) {
                throw new Error('Commit transaction was mined, but transfer verification receipt data was unavailable.');
            }

            await confirmTransferVerificationFromReceipt(
                `/api/fhenix/auction/dutch/${encodeURIComponent(params.auctionId)}/confirm-transfer`,
                result.receipt,
                CONTRACT_ADDRESSES.dutch,
                { acceptanceId: result.data.acceptanceId },
            );

            if (result.data?.acceptanceId) {
                setSelectedAcceptanceId(result.data.acceptanceId);
                setManualAcceptanceId(result.data.acceptanceId);
            }

            setTxKey(result.idempotencyKey || null);
            setTxHash(result.txHash || null);
            setSuccess('Acceptance commitment recorded and stake transfer verified.');
            await loadAuctionState();
        } catch (caught: any) {
            setError(caught?.message || 'Failed to commit the acceptance.');
        } finally {
            setActing(false);
        }
    };

    const confirmAcceptance = async () => {
        if (!effectiveAcceptanceId || acting) {
            return;
        }

        setActing(true);
        setError(null);
        setSuccess(null);

        try {
            const result = await walletFirstTx(
                `/api/fhenix/auction/dutch/${encodeURIComponent(params.auctionId)}/confirm`,
                { acceptanceId: effectiveAcceptanceId },
                (_prepareData, confirmedTxHash) => ({ acceptanceId: effectiveAcceptanceId, txHash: confirmedTxHash }),
            );
            setTxKey(result.idempotencyKey || null);
            setTxHash(result.txHash || null);
            setSuccess('Acceptance confirmed on-chain.');
            await loadAuctionState();
        } catch (caught: any) {
            setError(caught?.message || 'Failed to confirm the acceptance.');
        } finally {
            setActing(false);
        }
    };

    const acceptCurrentPrice = async () => {
        if (acting) {
            return;
        }

        setActing(true);
        setError(null);
        setSuccess(null);

        try {
            if (!operatorApproved) {
                throw new Error('Enable stake-token access first so the auction contract can lock the flat stake.');
            }
            const result = await walletFirstTx(
                `/api/fhenix/auction/dutch/${encodeURIComponent(params.auctionId)}/accept-price`,
                {},
                (_prepareData, confirmedTxHash) => ({ txHash: confirmedTxHash }),
            );

            if (!result.receipt) {
                throw new Error('Accept-price transaction was mined, but transfer verification receipt data was unavailable.');
            }

            await confirmTransferVerificationFromReceipt(
                `/api/fhenix/auction/dutch/${encodeURIComponent(params.auctionId)}/confirm-transfer`,
                result.receipt,
                CONTRACT_ADDRESSES.dutch,
                effectiveAcceptanceId ? { acceptanceId: effectiveAcceptanceId } : undefined,
            );

            setTxKey(result.idempotencyKey || null);
            setTxHash(result.txHash || null);
            setSuccess('Direct accept-price path completed and stake transfer verified.');
            await loadAuctionState();
        } catch (caught: any) {
            setError(caught?.message || 'Failed to accept the current price.');
        } finally {
            setActing(false);
        }
    };

    const resetCommitment = async () => {
        if (!effectiveAcceptanceId || acting) {
            return;
        }

        setActing(true);
        setError(null);
        setSuccess(null);

        try {
            const result = await walletFirstTx(
                `/api/fhenix/auction/dutch/${encodeURIComponent(params.auctionId)}/reset`,
                { acceptanceId: effectiveAcceptanceId },
                (_prepareData, confirmedTxHash) => ({ acceptanceId: effectiveAcceptanceId, txHash: confirmedTxHash }),
            );
            setTxKey(result.idempotencyKey || null);
            setTxHash(result.txHash || null);
            setSuccess('Expired commitment reset on-chain.');
            await loadAuctionState();
        } catch (caught: any) {
            setError(caught?.message || 'Failed to reset the commitment.');
        } finally {
            setActing(false);
        }
    };

    const claimStake = async () => {
        if (!effectiveAcceptanceId || acting) {
            return;
        }

        setActing(true);
        setError(null);
        setSuccess(null);

        try {
            const result = await walletFirstTx(
                `/api/fhenix/auction/dutch/${encodeURIComponent(params.auctionId)}/claim-stake`,
                { acceptanceId: effectiveAcceptanceId },
                (_prepareData, confirmedTxHash) => ({ acceptanceId: effectiveAcceptanceId, txHash: confirmedTxHash }),
            );

            if (!result.receipt) {
                throw new Error('Stake refund transaction was mined, but transfer verification receipt data was unavailable.');
            }

            await confirmTransferVerificationFromReceipt(
                `/api/fhenix/auction/dutch/${encodeURIComponent(params.auctionId)}/confirm-transfer`,
                result.receipt,
                CONTRACT_ADDRESSES.dutch,
            );

            setTxKey(result.idempotencyKey || null);
            setTxHash(result.txHash || null);
            setSuccess('Stake refund requested and transfer verification completed.');
            await loadAuctionState();
        } catch (caught: any) {
            setError(caught?.message || 'Failed to claim the stake refund.');
        } finally {
            setActing(false);
        }
    };

    const cancelAuction = async () => {
        if (acting) {
            return;
        }

        setActing(true);
        setError(null);
        setSuccess(null);

        try {
            const result = await walletFirstTx(
                `/api/fhenix/auction/dutch/${encodeURIComponent(params.auctionId)}/cancel`,
                {},
                (_prepareData, confirmedTxHash) => ({ txHash: confirmedTxHash }),
            );
            setTxKey(result.idempotencyKey || null);
            setTxHash(result.txHash || null);
            setSuccess('Auction cancellation submitted on-chain.');
            await loadAuctionState();
        } catch (caught: any) {
            setError(caught?.message || 'Failed to cancel the auction.');
        } finally {
            setActing(false);
        }
    };

    const importIntoRfq = async () => {
        if (!linkedRfq || acting) {
            return;
        }

        setActing(true);
        setError(null);
        setSuccess(null);

        try {
            const result = await walletFirstTx(
                `/api/fhenix/rfq/${encodeURIComponent(linkedRfq)}/import-auction`,
                {
                    auctionId: params.auctionId,
                    auctionType: PRICING_MODE.DUTCH,
                },
                (_prepareData, confirmedTxHash) => ({
                    auctionId: params.auctionId,
                    auctionType: PRICING_MODE.DUTCH,
                    txHash: confirmedTxHash,
                }),
            );

            setTxKey(result.idempotencyKey || null);
            setTxHash(result.txHash || null);
            setSuccess('Dutch auction result imported back into the linked RFQ.');
        } catch (caught: any) {
            setError(caught?.message || 'Failed to import the auction result.');
        } finally {
            setActing(false);
        }
    };

    if (loading || sessionHydrating) {
        return (
            <PageShell>
                <Panel title="Loading Dutch workspace">
                    <div className="text-sm text-white/60">Fetching the live Sepolia auction state and syncing your wallet session.</div>
                </Panel>
            </PageShell>
        );
    }

    if (!auction) {
        return (
            <PageShell>
                <Notice tone="danger">{error || 'Auction not found.'}</Notice>
            </PageShell>
        );
    }

    const isCreator = Boolean(walletAddress && auction.creator && walletAddress.toLowerCase() === auction.creator.toLowerCase());

    return (
        <PageShell className="space-y-6">
            <PageHeader
                eyebrow="Auctions"
                title={`Dutch ${truncateMiddle(params.auctionId, 18, 12)}`}
                description="Commit and confirm a staked Dutch acceptance, or take the direct accept-price path, then import the final price back into the linked RFQ."
            />

            <Notice title="Operator approval required">
                Vendors must grant short-lived operator access on the stake token before committing or using direct accept-price.
                Recommended pattern: <code className="ml-1">stakeToken.setOperator(auctionContract, block.timestamp + 10 minutes)</code>
                <ActionBar className="mt-3">
                    <Button type="button" size="sm" variant={operatorApproved ? 'secondary' : 'primary'} onClick={handleEnableOperator} isLoading={approving}>
                        {operatorApproved ? 'Stake access enabled' : 'Enable stake access'}
                    </Button>
                </ActionBar>
            </Notice>

            {error ? <Notice tone="danger">{error}</Notice> : null}
            {success ? <Notice title="Auction update">{success}</Notice> : null}

            <DataGrid columns={3}>
                <DataPoint label="Status" value={dutchStatusLabel(auction.statusCode)} />
                <DataPoint label="Current block" value={currentBlock ?? auction.currentBlock} />
                <DataPoint label="Indexed commitments" value={savedAcceptances.length} />
            </DataGrid>

            <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
                <div className="space-y-6">
                    <Panel title="Auction summary">
                        <DataGrid columns={2}>
                            <DataPoint label="Auction id" value={<CopyableText value={auction.id} displayValue={truncateMiddle(auction.id, 16, 10)} />} />
                            <DataPoint label="Creator" value={<CopyableText value={auction.creator} displayValue={truncateMiddle(auction.creator, 14, 10)} />} />
                            <DataPoint
                                label="Linked RFQ"
                                value={linkedRfq ? <CopyableText value={linkedRfq} displayValue={truncateMiddle(linkedRfq, 16, 10)} /> : 'Standalone'}
                            />
                            <DataPoint label="Current price" value={auction.currentPrice} />
                            <DataPoint label="Start price" value={auction.startPrice} />
                            <DataPoint label="Reserve price" value={auction.reservePrice} />
                            <DataPoint label="Decrement / block" value={auction.priceDecrement} />
                            <DataPoint label="Start block" value={auction.startBlock} />
                            <DataPoint label="End block" value={auction.endBlock} />
                            <DataPoint label="Winner" value={auction.winner === '0x0000000000000000000000000000000000000000' ? '--' : auction.winner} />
                            <DataPoint label="Final price" value={auction.finalPrice || '--'} />
                        </DataGrid>
                    </Panel>

                    {!isCreator ? (
                        <>
                            <Panel title="Commit then confirm">
                                <div className="space-y-4">
                                    <Field label="Acceptance id" hint="Choose an indexed commitment below or paste one here for confirm/reset/refund actions.">
                                        <TextInput value={manualAcceptanceId} onChange={(event) => setManualAcceptanceId(event.target.value)} placeholder="0x..." />
                                    </Field>
                                    <ActionBar>
                                        <Button onClick={commitAcceptance} isLoading={acting} disabled={!operatorApproved}>
                                            Commit acceptance
                                        </Button>
                                        <Button variant="secondary" onClick={confirmAcceptance} isLoading={acting} disabled={!effectiveAcceptanceId}>
                                            Confirm acceptance
                                        </Button>
                                    </ActionBar>
                                    <ActionBar>
                                        <Button variant="secondary" onClick={resetCommitment} isLoading={acting} disabled={!effectiveAcceptanceId}>
                                            Reset expired commitment
                                        </Button>
                                        <Button variant="secondary" onClick={claimStake} isLoading={acting} disabled={!effectiveAcceptanceId}>
                                            Claim stake
                                        </Button>
                                    </ActionBar>
                                </div>
                            </Panel>

                            <Panel title="Direct accept-price path">
                                <div className="space-y-4">
                                    <div className="rounded-xl border border-white/12 bg-white/[0.05] px-4 py-3 text-sm text-white/60">
                                        This path skips the separate confirm step. It still requires operator approval and a transfer verification follow-up in the same workflow.
                                    </div>
                                    <ActionBar>
                                        <Button onClick={acceptCurrentPrice} isLoading={acting} disabled={!operatorApproved}>
                                            Accept current price
                                        </Button>
                                    </ActionBar>
                                </div>
                            </Panel>

                            <Panel title="Indexed commitments">
                                {savedAcceptances.length === 0 ? (
                                    <EmptyState
                                        title="No indexed commitments for this wallet"
                                        description="Commit an acceptance and confirm the transfer check to make it appear here for confirm, reset, and refund actions."
                                    />
                                ) : (
                                    <div className="space-y-3">
                                        {savedAcceptances.map((bundle) => (
                                            <button
                                                key={bundle.acceptanceId}
                                                type="button"
                                                onClick={async () => {
                                                    setSelectedAcceptanceId(bundle.acceptanceId);
                                                    setManualAcceptanceId(bundle.acceptanceId);
                                                    setAcceptance(await loadAcceptanceDetail(bundle.acceptanceId));
                                                }}
                                                className={`w-full rounded-xl border p-4 text-left transition ${
                                                    selectedAcceptanceId === bundle.acceptanceId
                                                        ? 'border-emerald-300/40 bg-emerald-400/10'
                                                        : 'border-white/12 bg-white/[0.05]'
                                                }`}
                                            >
                                                <DataGrid columns={2}>
                                                    <DataPoint label="Acceptance id" value={<CopyableText value={bundle.acceptanceId} displayValue={truncateMiddle(bundle.acceptanceId, 14, 8)} />} />
                                                    <DataPoint label="Bidder" value={truncateMiddle(bundle.bidder, 14, 10)} />
                                                </DataGrid>
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </Panel>
                        </>
                    ) : null}
                </div>

                <div className="space-y-6">
                    <Panel title="Selected commitment">
                        {acceptance ? (
                            <DataGrid columns={2}>
                                <DataPoint label="Bidder" value={acceptance.bidder} />
                                <DataPoint label="Stake" value={acceptance.stake} />
                                <DataPoint label="Commit block" value={acceptance.commitBlock} />
                                <DataPoint label="Committed price" value={acceptance.committedPrice} />
                                <DataPoint label="Confirmed" value={acceptance.confirmed ? 'Yes' : 'No'} />
                                <DataPoint label="Slashed" value={acceptance.slashed ? 'Yes' : 'No'} />
                            </DataGrid>
                        ) : (
                            <div className="text-sm text-white/60">Select or paste an acceptance id to inspect its current on-chain state.</div>
                        )}
                    </Panel>

                    <Panel title={isCreator ? 'Creator actions' : 'Auction status'}>
                        {isCreator ? (
                            <>
                                <ActionBar>
                                    <Button onClick={importIntoRfq} isLoading={acting} disabled={!linkedRfq || auction.winner === '0x0000000000000000000000000000000000000000'}>
                                        Import into RFQ
                                    </Button>
                                    <Button variant="secondary" onClick={cancelAuction} isLoading={acting}>
                                        Cancel auction
                                    </Button>
                                </ActionBar>
                                {linkedRfq ? (
                                    <ActionBar>
                                        <Link href={`/buyer/rfqs/${encodeURIComponent(linkedRfq)}`}>
                                            <Button variant="secondary">Open RFQ</Button>
                                        </Link>
                                    </ActionBar>
                                ) : null}
                            </>
                        ) : (
                            <div className="rounded-xl border border-white/12 bg-white/[0.05] px-4 py-3 text-sm text-white/60">
                                The creator imports the final Dutch price into the linked RFQ or cancels the auction from this panel.
                            </div>
                        )}
                    </Panel>

                    {txKey || txHash ? (
                        <Panel title="Latest transaction">
                            {txKey ? <TxStatusView idempotencyKey={txKey} compact={true} /> : null}
                            {txHash && !txKey ? (
                                <DataGrid columns={2}>
                                    <DataPoint label="Tx hash" value={<CopyableText value={txHash} displayValue={truncateMiddle(txHash, 18, 12)} />} />
                                </DataGrid>
                            ) : null}
                        </Panel>
                    ) : null}
                </div>
            </div>
        </PageShell>
    );
}
