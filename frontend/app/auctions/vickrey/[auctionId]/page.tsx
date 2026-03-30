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
import { decryptForTransaction, encryptBidAmount } from '@/lib/cofheClient';
import { confirmTransferVerificationFromReceipt } from '@/lib/fhenixWorkflow';
import { CONTRACT_ADDRESSES, PRICING_MODE } from '@/lib/sealProtocol';
import { truncateMiddle } from '@/lib/utils';
import { executeSimpleTx, walletFirstTx } from '@/lib/walletTx';
import { useWallet } from '@/contexts/WalletContext';

type AuctionDetail = {
    id: string;
    creator: string;
    rfqId: string;
    biddingDeadline: number;
    revealDeadline: number;
    flatStake: string;
    minBidCount: string;
    statusCode: number;
    bidCount: string;
    revealedCount: string;
    finalWinner: string;
    finalPrice: string;
    finalized: boolean;
    encryptedLowestBidCtHash: string;
    encryptedSecondLowestBidCtHash: string;
    encryptedLowestBidderCtHash: string;
};

type HydratedBid = {
    bidId: string;
    auctionId: string;
    owner: string;
    encryptedAmountCtHash: string;
    stake: string;
    revealed: boolean;
    revealedAmount: string;
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

function toAddressFromBigInt(value: bigint): `0x${string}` {
    return `0x${value.toString(16).padStart(40, '0').slice(-40)}` as `0x${string}`;
}

function vickreyStatusLabel(statusCode: number) {
    if (statusCode === 1) return 'OPEN';
    if (statusCode === 2) return 'REVEAL';
    if (statusCode === 3) return 'FINALIZED';
    if (statusCode === 4) return 'CANCELLED';
    return 'UNKNOWN';
}

export default function VickreyDetailPage({ params }: { params: { auctionId: string } }) {
    const { walletAddress, sessionHydrating } = useWallet();
    const [auction, setAuction] = useState<AuctionDetail | null>(null);
    const [savedBids, setSavedBids] = useState<HydratedBid[]>([]);
    const [currentBlock, setCurrentBlock] = useState<number | null>(null);
    const [commitAmount, setCommitAmount] = useState('');
    const [selectedBidId, setSelectedBidId] = useState<string | null>(null);
    const [manualBidId, setManualBidId] = useState('');
    const [txKey, setTxKey] = useState<string | null>(null);
    const [txHash, setTxHash] = useState<string | null>(null);
    const [operatorApproved, setOperatorApproved] = useState<boolean | null>(null);
    const [approving, setApproving] = useState(false);
    const [loading, setLoading] = useState(true);
    const [acting, setActing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);

    async function loadAuctionState() {
        const [auctionResponse, bidsResponse, blockHeight] = await Promise.all([
            authenticatedFetch(`/api/fhenix/auction/vickrey/${encodeURIComponent(params.auctionId)}`),
            authenticatedFetch(`/api/fhenix/auction/vickrey/${encodeURIComponent(params.auctionId)}/bids`),
            fetchCurrentBlockHeight(),
        ]);
        const auctionPayload = await auctionResponse.json();
        const bidsPayload = await bidsResponse.json().catch(() => ({ data: [] }));
        if (!auctionResponse.ok || auctionPayload?.status !== 'success') {
            throw new Error(auctionPayload?.error?.message || 'Failed to load the Vickrey auction.');
        }

        setAuction(auctionPayload.data);
        setCurrentBlock(blockHeight);
        setSavedBids(Array.isArray(bidsPayload?.data) ? bidsPayload.data : []);
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
                    setError(caught?.message || 'Failed to load the Vickrey auction.');
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
    }, [params.auctionId, sessionHydrating]);

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
                args: [walletAddress, CONTRACT_ADDRESSES.vickrey],
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

    const visibleBids = useMemo(
        () =>
            walletAddress
                ? savedBids.filter((bid) => bid.owner.toLowerCase() === walletAddress.toLowerCase())
                : savedBids,
        [savedBids, walletAddress],
    );
    const selectedBid = useMemo(
        () => visibleBids.find((bid) => bid.bidId.toLowerCase() === (selectedBidId || '').toLowerCase()) || null,
        [visibleBids, selectedBidId],
    );

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
                args: [CONTRACT_ADDRESSES.vickrey, until],
            });

            const result = await executeSimpleTx({
                to: CONTRACT_ADDRESSES.stakeToken,
                data,
                value: '0',
                chainId: Number(process.env.NEXT_PUBLIC_FHENIX_CHAIN_ID || '11155111'),
            });

            setTxHash(result.txHash || null);
            setOperatorApproved(true);
            setSuccess('Stake-token access enabled for 10 minutes. You can commit the encrypted bid now.');
        } catch (caught: any) {
            setError(caught?.message || 'Failed to enable stake-token access.');
        } finally {
            setApproving(false);
        }
    };

    const commitBid = async () => {
        if (acting) {
            return;
        }

        setActing(true);
        setError(null);
        setSuccess(null);

        try {
            const amount = commitAmount.trim();
            if (!/^\d+$/.test(amount) || BigInt(amount) <= 0n) {
                throw new Error('Bid amount must be a positive integer.');
            }
            if (!operatorApproved) {
                throw new Error('Enable stake-token access first so the auction contract can lock the flat stake.');
            }

            const encryptedBid = await encryptBidAmount(BigInt(amount));
            const result = await walletFirstTx(
                `/api/fhenix/auction/vickrey/${encodeURIComponent(params.auctionId)}/bids`,
                { encryptedBid },
                (_prepareData, confirmedTxHash) => ({ encryptedBid, txHash: confirmedTxHash }),
            );

            if (!result.receipt) {
                throw new Error('Bid transaction was mined, but transfer verification receipt data was unavailable.');
            }

            await confirmTransferVerificationFromReceipt(
                `/api/fhenix/auction/vickrey/${encodeURIComponent(params.auctionId)}/confirm-transfer`,
                result.receipt,
                CONTRACT_ADDRESSES.vickrey,
                { bidId: result.data.bidId },
            );

            if (result.data?.bidId) {
                setSelectedBidId(result.data.bidId);
                setManualBidId(result.data.bidId);
            }

            setTxKey(result.idempotencyKey || null);
            setTxHash(result.txHash || null);
            setSuccess('Encrypted bid committed and stake transfer verified.');
            await loadAuctionState();
        } catch (caught: any) {
            setError(caught?.message || 'Failed to commit the encrypted bid.');
        } finally {
            setActing(false);
        }
    };

    const closeBidding = async () => {
        if (acting) {
            return;
        }

        setActing(true);
        setError(null);
        setSuccess(null);

        try {
            const result = await walletFirstTx(
                `/api/fhenix/auction/vickrey/${encodeURIComponent(params.auctionId)}/close`,
                {},
                (_prepareData, confirmedTxHash) => ({ txHash: confirmedTxHash }),
            );
            setTxKey(result.idempotencyKey || null);
            setTxHash(result.txHash || null);
            setSuccess('Bidding has been closed on-chain.');
            await loadAuctionState();
        } catch (caught: any) {
            setError(caught?.message || 'Failed to close bidding.');
        } finally {
            setActing(false);
        }
    };

    const revealBid = async () => {
        if (acting) {
            return;
        }

        setActing(true);
        setError(null);
        setSuccess(null);

        try {
            const bidId = (selectedBidId || manualBidId).trim();
            if (!bidId) {
                throw new Error('Select an indexed bid or enter a bid id to reveal.');
            }

            const bidResponse = await authenticatedFetch(
                `/api/fhenix/auction/vickrey/${encodeURIComponent(params.auctionId)}/bids/${encodeURIComponent(bidId)}`,
            );
            const bidPayload = await bidResponse.json();
            if (!bidResponse.ok || bidPayload?.status !== 'success') {
                throw new Error(bidPayload?.error?.message || 'Failed to load the bid ciphertext for reveal.');
            }

            const proof = await decryptForTransaction(bidPayload.data.encryptedAmountCtHash, { requirePermit: true });
            const result = await walletFirstTx(
                `/api/fhenix/auction/vickrey/${encodeURIComponent(params.auctionId)}/reveal`,
                {
                    bidId,
                    plaintext: proof.decryptedValue.toString(),
                    signature: proof.signature,
                },
                (_prepareData, confirmedTxHash) => ({
                    bidId,
                    plaintext: proof.decryptedValue.toString(),
                    signature: proof.signature,
                    txHash: confirmedTxHash,
                }),
            );

            setTxKey(result.idempotencyKey || null);
            setTxHash(result.txHash || null);
            setSuccess('Bid reveal proof submitted on-chain.');
            await loadAuctionState();
        } catch (caught: any) {
            setError(caught?.message || 'Failed to reveal the bid.');
        } finally {
            setActing(false);
        }
    };

    const finalizeAuction = async () => {
        if (!auction || acting) {
            return;
        }

        setActing(true);
        setError(null);
        setSuccess(null);

        try {
            const [lowestProof, secondProof, winnerProof] = await Promise.all([
                decryptForTransaction(auction.encryptedLowestBidCtHash, { requirePermit: true }),
                decryptForTransaction(auction.encryptedSecondLowestBidCtHash, { requirePermit: true }),
                decryptForTransaction(auction.encryptedLowestBidderCtHash, { requirePermit: true }),
            ]);

            const result = await walletFirstTx(
                `/api/fhenix/auction/vickrey/${encodeURIComponent(params.auctionId)}/finalize`,
                {
                    lowestBidPlaintext: lowestProof.decryptedValue.toString(),
                    lowestBidSignature: lowestProof.signature,
                    secondBidPlaintext: secondProof.decryptedValue.toString(),
                    secondBidSignature: secondProof.signature,
                    winnerPlaintext: toAddressFromBigInt(BigInt(winnerProof.decryptedValue)),
                    winnerSignature: winnerProof.signature,
                },
                (_prepareData, confirmedTxHash) => ({
                    txHash: confirmedTxHash,
                }),
            );

            setTxKey(result.idempotencyKey || null);
            setTxHash(result.txHash || null);
            setSuccess('Auction finalized and second-price result locked on-chain.');
            await loadAuctionState();
        } catch (caught: any) {
            setError(caught?.message || 'Failed to finalize the auction.');
        } finally {
            setActing(false);
        }
    };

    const importIntoRfq = async () => {
        if (!auction || !auction.rfqId || auction.rfqId === `0x${'0'.repeat(64)}` || acting) {
            return;
        }

        setActing(true);
        setError(null);
        setSuccess(null);

        try {
            const result = await walletFirstTx(
                `/api/fhenix/rfq/${encodeURIComponent(auction.rfqId)}/import-auction`,
                {
                    auctionId: params.auctionId,
                    auctionType: PRICING_MODE.VICKREY,
                },
                (_prepareData, confirmedTxHash) => ({
                    auctionId: params.auctionId,
                    auctionType: PRICING_MODE.VICKREY,
                    txHash: confirmedTxHash,
                }),
            );

            setTxKey(result.idempotencyKey || null);
            setTxHash(result.txHash || null);
            setSuccess('Auction result imported back into the linked RFQ.');
        } catch (caught: any) {
            setError(caught?.message || 'Failed to import the auction result.');
        } finally {
            setActing(false);
        }
    };

    const claimStake = async () => {
        const bidId = (selectedBidId || manualBidId).trim();
        if (!bidId || acting) {
            return;
        }

        setActing(true);
        setError(null);
        setSuccess(null);

        try {
            const result = await walletFirstTx(
                `/api/fhenix/auction/vickrey/${encodeURIComponent(params.auctionId)}/claim-stake`,
                { bidId },
                (_prepareData, confirmedTxHash) => ({ bidId, txHash: confirmedTxHash }),
            );

            if (!result.receipt) {
                throw new Error('Stake refund transaction was mined, but transfer verification receipt data was unavailable.');
            }

            await confirmTransferVerificationFromReceipt(
                `/api/fhenix/auction/vickrey/${encodeURIComponent(params.auctionId)}/confirm-transfer`,
                result.receipt,
                CONTRACT_ADDRESSES.vickrey,
                { bidId },
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
                `/api/fhenix/auction/vickrey/${encodeURIComponent(params.auctionId)}/cancel`,
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

    if (loading || sessionHydrating) {
        return (
            <PageShell>
                <Panel title="Loading Vickrey workspace">
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

    const linkedRfq = auction.rfqId && auction.rfqId !== `0x${'0'.repeat(64)}` ? auction.rfqId : null;
    const isCreator = Boolean(walletAddress && auction.creator && walletAddress.toLowerCase() === auction.creator.toLowerCase());

    return (
        <PageShell className="space-y-6">
            <PageHeader
                eyebrow="Auctions"
                title={`Vickrey ${truncateMiddle(params.auctionId, 18, 12)}`}
                description="Commit encrypted bids, verify stake transfers, reveal bidder-owned ciphertexts, finalize the second-price result, and import it into the linked RFQ."
            />

            <Notice title="Operator approval required">
                Bidders must grant short-lived operator access on the stake token before committing. Recommended pattern:
                <code className="ml-1">stakeToken.setOperator(auctionContract, block.timestamp + 10 minutes)</code>
                <ActionBar className="mt-3">
                    <Button type="button" size="sm" variant={operatorApproved ? 'secondary' : 'primary'} onClick={handleEnableOperator} isLoading={approving}>
                        {operatorApproved ? 'Stake access enabled' : 'Enable stake access'}
                    </Button>
                </ActionBar>
            </Notice>

            {error ? <Notice tone="danger">{error}</Notice> : null}
            {success ? <Notice title="Auction update">{success}</Notice> : null}

            <DataGrid columns={3}>
                <DataPoint label="Status" value={vickreyStatusLabel(auction.statusCode)} />
                <DataPoint label="Current block" value={currentBlock ?? 'Loading...'} />
                <DataPoint label="Indexed bids" value={visibleBids.length} />
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
                            <DataPoint label="Flat stake" value={auction.flatStake} />
                            <DataPoint label="Min reveal count" value={auction.minBidCount} />
                            <DataPoint label="Bid count" value={auction.bidCount} />
                            <DataPoint label="Revealed count" value={auction.revealedCount} />
                            <DataPoint label="Bidding deadline" value={auction.biddingDeadline} />
                            <DataPoint label="Reveal deadline" value={auction.revealDeadline} />
                            <DataPoint label="Final winner" value={auction.finalWinner === '0x0000000000000000000000000000000000000000' ? '--' : auction.finalWinner} />
                            <DataPoint label="Final price" value={auction.finalized ? auction.finalPrice : 'Pending'} />
                        </DataGrid>
                    </Panel>

                    {!isCreator ? (
                        <>
                            <Panel title="Commit encrypted bid">
                                <div className="space-y-4">
                                    <Field label="Bid amount" hint="Enter the exact integer amount that will be encrypted locally before submission.">
                                        <TextInput value={commitAmount} onChange={(event) => setCommitAmount(event.target.value)} placeholder="125" />
                                    </Field>
                                    <ActionBar>
                                        <Button onClick={commitBid} isLoading={acting} disabled={!operatorApproved}>
                                            Commit encrypted bid
                                        </Button>
                                    </ActionBar>
                                </div>
                            </Panel>

                            <Panel title="Reveal selected bid">
                                <div className="space-y-4">
                                    <Field label="Bid id" hint="Choose an indexed bid below or paste a bid id if you already know it.">
                                        <TextInput value={manualBidId} onChange={(event) => setManualBidId(event.target.value)} placeholder="0x..." />
                                    </Field>
                                    <ActionBar>
                                        <Button variant="secondary" onClick={revealBid} isLoading={acting}>
                                            Reveal bid
                                        </Button>
                                        <Button variant="secondary" onClick={claimStake} isLoading={acting}>
                                            Claim stake
                                        </Button>
                                    </ActionBar>
                                </div>
                            </Panel>

                            <Panel title="Indexed bid records">
                                {visibleBids.length === 0 ? (
                                    <EmptyState
                                        title="No indexed bids for this wallet"
                                        description="Commit an encrypted bid and confirm the transfer check to make it appear here for reveal and refund actions."
                                    />
                                ) : (
                                    <div className="space-y-3">
                                        {visibleBids.map((bid) => (
                                            <button
                                                key={bid.bidId}
                                                type="button"
                                                onClick={() => {
                                                    setSelectedBidId(bid.bidId);
                                                    setManualBidId(bid.bidId);
                                                }}
                                                className={`w-full rounded-xl border p-4 text-left transition ${
                                                    selectedBidId === bid.bidId
                                                        ? 'border-emerald-300/40 bg-emerald-400/10'
                                                        : 'border-white/12 bg-white/[0.05]'
                                                }`}
                                            >
                                                <DataGrid columns={2}>
                                                    <DataPoint label="Bid id" value={<CopyableText value={bid.bidId} displayValue={truncateMiddle(bid.bidId, 14, 8)} />} />
                                                    <DataPoint label="Owner" value={truncateMiddle(bid.owner, 14, 10)} />
                                                    <DataPoint label="Stake" value={bid.stake || '--'} />
                                                    <DataPoint label="Reveal status" value={bid.revealed ? `Revealed: ${bid.revealedAmount}` : 'Still encrypted'} />
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
                    <Panel title={isCreator ? 'Creator actions' : 'Auction status'}>
                        <div className="space-y-4">
                            {isCreator ? (
                                <>
                                    <ActionBar>
                                        <Button variant="secondary" onClick={closeBidding} isLoading={acting}>
                                            Close bidding
                                        </Button>
                                        <Button onClick={finalizeAuction} isLoading={acting}>
                                            Finalize auction
                                        </Button>
                                        <Button variant="secondary" onClick={cancelAuction} isLoading={acting}>
                                            Cancel auction
                                        </Button>
                                    </ActionBar>
                                    <ActionBar>
                                        <Button onClick={importIntoRfq} isLoading={acting} disabled={!linkedRfq || !auction.finalized}>
                                            Import into RFQ
                                        </Button>
                                        {linkedRfq ? (
                                            <Link href={`/buyer/rfqs/${encodeURIComponent(linkedRfq)}`}>
                                                <Button variant="secondary">Open RFQ</Button>
                                            </Link>
                                        ) : null}
                                    </ActionBar>
                                    <div className="rounded-xl border border-white/12 bg-white/[0.05] px-4 py-3 text-sm text-white/60">
                                        Finalization requires three decrypt proofs from the auction-tracking ciphertexts:
                                        lowest bid, second-lowest bid, and lowest bidder address.
                                    </div>
                                </>
                            ) : (
                                <div className="rounded-xl border border-white/12 bg-white/[0.05] px-4 py-3 text-sm text-white/60">
                                    The creator closes bidding, finalizes the second-price result, and imports the winner back into the linked RFQ from this panel.
                                </div>
                            )}
                        </div>
                    </Panel>

                    <Panel title="Encrypted tracker handles">
                        <DataGrid columns={2}>
                            <DataPoint
                                label="Lowest bid ciphertext"
                                value={<CopyableText value={auction.encryptedLowestBidCtHash} displayValue={truncateMiddle(auction.encryptedLowestBidCtHash, 18, 12)} />}
                            />
                            <DataPoint
                                label="Second bid ciphertext"
                                value={<CopyableText value={auction.encryptedSecondLowestBidCtHash} displayValue={truncateMiddle(auction.encryptedSecondLowestBidCtHash, 18, 12)} />}
                            />
                            <DataPoint
                                label="Winner ciphertext"
                                value={<CopyableText value={auction.encryptedLowestBidderCtHash} displayValue={truncateMiddle(auction.encryptedLowestBidderCtHash, 18, 12)} />}
                            />
                        </DataGrid>
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
