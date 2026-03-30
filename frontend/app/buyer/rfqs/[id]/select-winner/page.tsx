'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/Button';
import {
    ActionBar,
    CopyableText,
    DataGrid,
    DataPoint,
    Field,
    Notice,
    PageHeader,
    PageShell,
    Panel,
    PricingChip,
    StatusChip,
    TextAreaInput,
    TokenChip,
} from '@/components/protocol/ProtocolPrimitives';
import { authenticatedFetch } from '@/lib/authFetch';
import { fetchCurrentBlockHeight } from '@/lib/sepoliaClient';
import { decryptForTransaction } from '@/lib/cofheClient';
import { decodeWinnerProofShare } from '@/lib/fhenixWorkflow';
import { formatAmount, PRICING_MODE } from '@/lib/sealProtocol';
import { truncateMiddle } from '@/lib/utils';
import { walletFirstTx } from '@/lib/walletTx';

type RfqDetail = {
    id: string;
    status: string;
    statusCode: number;
    tokenType: number;
    mode: number;
    revealDeadline: number;
    biddingDeadline: number;
    lowestEncryptedBidCtHash: string;
    lowestPublishedBid: string;
    lowestBidPublished: boolean;
    winnerBidId: string;
};

type Bid = {
    bidId: string;
    owner: string;
    encryptedAmountCtHash: string;
    stake: string;
    revealed: boolean;
    revealedAmount: string;
};

export default function SelectWinnerPage({ params }: { params: { id: string } }) {
    const [rfq, setRfq] = useState<RfqDetail | null>(null);
    const [bids, setBids] = useState<Bid[]>([]);
    const [currentBlock, setCurrentBlock] = useState<number | null>(null);
    const [selectedBidId, setSelectedBidId] = useState<string | null>(null);
    const [proofPackage, setProofPackage] = useState('');
    const [txHash, setTxHash] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [acting, setActing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);

    const loadSelectionState = async () => {
        const [rfqResponse, bidsResponse, blockHeight] = await Promise.all([
            authenticatedFetch(`/api/fhenix/rfq/${params.id}`),
            authenticatedFetch(`/api/fhenix/rfq/${params.id}/bids`),
            fetchCurrentBlockHeight(),
        ]);

        const rfqPayload = await rfqResponse.json();
        const bidsPayload = await bidsResponse.json().catch(() => ({ data: [] }));

        if (!rfqResponse.ok) {
            throw new Error(rfqPayload?.error?.message || 'Failed to load RFQ.');
        }

        setRfq(rfqPayload.data);
        setBids(Array.isArray(bidsPayload?.data) ? bidsPayload.data : []);
        setCurrentBlock(blockHeight);
    };

    useEffect(() => {
        let cancelled = false;

        const load = async () => {
            try {
                if (!cancelled) {
                    await loadSelectionState();
                }
            } catch (caught: any) {
                if (!cancelled) {
                    setError(caught?.message || 'Failed to load winner selection.');
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
    }, [params.id]);

    const publishLowestBid = async () => {
        if (!rfq || acting) {
            return;
        }

        setActing(true);
        setError(null);
        setSuccess(null);

        try {
            if (rfq.lowestBidPublished) {
                throw new Error('The lowest bid has already been published on-chain.');
            }
            const proof = await decryptForTransaction(rfq.lowestEncryptedBidCtHash, { requirePermit: true });
            const result = await walletFirstTx(
                `/api/fhenix/rfq/${encodeURIComponent(rfq.id)}/publish-lowest`,
                {
                    plaintext: proof.decryptedValue.toString(),
                    signature: proof.signature,
                },
                (_prepareData, confirmedTxHash) => ({
                    plaintext: proof.decryptedValue.toString(),
                    signature: proof.signature,
                    txHash: confirmedTxHash,
                }),
            );

            setTxHash(result.txHash || null);
            await loadSelectionState();
            setSuccess('Lowest bid proof published on-chain. You can now select the winning bid with the bidder-provided proof package.');
        } catch (caught: any) {
            setError(caught?.message || 'Failed to publish the lowest bid.');
        } finally {
            setActing(false);
        }
    };

    const selectWinner = async () => {
        if (!rfq || !selectedBidId || acting) {
            return;
        }

        setActing(true);
        setError(null);
        setSuccess(null);

        try {
            if (!proofPackage.trim()) {
                throw new Error('Paste the vendor proof package first.');
            }
            const proof = decodeWinnerProofShare(proofPackage);
            if (proof.bidId.toLowerCase() !== selectedBidId.toLowerCase()) {
                throw new Error('The pasted proof package does not match the selected bid.');
            }

            const result = await walletFirstTx(
                `/api/fhenix/rfq/${encodeURIComponent(rfq.id)}/select-winner`,
                {
                    bidId: proof.bidId,
                    plaintext: proof.plaintext,
                    signature: proof.signature,
                },
                (_prepareData, confirmedTxHash) => ({
                    bidId: proof.bidId,
                    plaintext: proof.plaintext,
                    signature: proof.signature,
                    txHash: confirmedTxHash,
                }),
            );

            setTxHash(result.txHash || null);
            await loadSelectionState();
            setSuccess('Winner selected on-chain.');
        } catch (caught: any) {
            setError(caught?.message || 'Failed to select the winner.');
        } finally {
            setActing(false);
        }
    };

    const canPublishLowest = useMemo(() => {
        return Boolean(rfq && currentBlock !== null && currentBlock >= rfq.biddingDeadline && !rfq.lowestBidPublished);
    }, [currentBlock, rfq]);

    const canSelectWinner = useMemo(() => {
        return Boolean(rfq && rfq.lowestBidPublished && rfq.statusCode !== 3 && rfq.statusCode !== 4 && rfq.statusCode !== 5);
    }, [rfq]);

    if (loading) {
        return (
            <PageShell>
                <Panel title="Loading winner selection">
                    <div className="text-sm text-[hsl(var(--muted-foreground))]">Fetching the RFQ state and encrypted bid list.</div>
                </Panel>
            </PageShell>
        );
    }

    if (!rfq) {
        return (
            <PageShell>
                <Notice tone="danger">{error || 'RFQ not found.'}</Notice>
            </PageShell>
        );
    }

    return (
        <PageShell className="space-y-6">
            <PageHeader
                eyebrow="Buyer"
                title="Finalize direct RFQ winner"
                description="First publish the encrypted lowest bid proof, then paste the bidder’s shared proof package for the winning bid."
                actions={
                    <ActionBar>
                        <StatusChip status={rfq.status} />
                        <TokenChip tokenType={rfq.tokenType} />
                        <PricingChip pricingMode={rfq.mode} />
                    </ActionBar>
                }
            />

            {rfq.mode !== PRICING_MODE.RFQ ? (
                <Notice tone="warning" title="Auction-backed RFQ">
                    This RFQ imports its price from an auction. Direct RFQ winner selection is not available for this mode.
                </Notice>
            ) : null}

            {error ? <Notice tone="danger">{error}</Notice> : null}
            {success ? <Notice title="Winner workflow">{success}</Notice> : null}

            <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
                <div className="space-y-6">
                    <Panel title="Step 1: Publish lowest bid">
                        <DataGrid columns={2}>
                            <DataPoint label="Bidding deadline" value={rfq.biddingDeadline} />
                            <DataPoint label="Reveal deadline" value={rfq.revealDeadline} />
                            <DataPoint
                                label="Lowest published"
                                value={rfq.lowestBidPublished ? formatAmount(rfq.lowestPublishedBid, rfq.tokenType) : 'Not yet'}
                            />
                            <DataPoint
                                label="Lowest ciphertext"
                                value={<CopyableText value={rfq.lowestEncryptedBidCtHash} displayValue={truncateMiddle(rfq.lowestEncryptedBidCtHash, 18, 12)} />}
                            />
                        </DataGrid>
                        <ActionBar className="mt-4">
                            <Button onClick={publishLowestBid} isLoading={acting} disabled={!canPublishLowest}>
                                Publish lowest bid
                            </Button>
                        </ActionBar>
                    </Panel>

                    <Panel title="Step 2: Select winner">
                        <div className="space-y-4">
                            <Field label="Bidder proof package" hint="Paste the proof package shared by the winning vendor.">
                                <TextAreaInput
                                    value={proofPackage}
                                    onChange={(event) => setProofPackage(event.target.value)}
                                    placeholder="Paste the vendor proof package here"
                                />
                            </Field>
                            <ActionBar>
                                <Button onClick={selectWinner} isLoading={acting} disabled={!canSelectWinner || !selectedBidId}>
                                    Select winner
                                </Button>
                                {rfq.statusCode === 3 ? (
                                    <Link href={`/buyer/rfqs/${encodeURIComponent(rfq.id)}/fund-escrow`}>
                                        <Button variant="secondary">Continue to escrow funding</Button>
                                    </Link>
                                ) : null}
                            </ActionBar>
                        </div>
                    </Panel>
                </div>

                <div className="space-y-6">
                    <Panel title="Encrypted bids">
                        {bids.length === 0 ? (
                            <div className="text-sm text-[hsl(var(--muted-foreground))]">No bids have been indexed for this RFQ yet.</div>
                        ) : (
                            <div className="space-y-3">
                                {bids.map((bid) => (
                                    <button
                                        key={bid.bidId}
                                        type="button"
                                        onClick={() => setSelectedBidId(bid.bidId)}
                                        className={`w-full rounded-xl border p-4 text-left transition ${
                                            selectedBidId === bid.bidId
                                                ? 'border-emerald-300 bg-emerald-50/10'
                                                : 'border-slate-200 bg-slate-50/70'
                                        }`}
                                    >
                                        <DataGrid columns={2}>
                                            <DataPoint label="Bid id" value={<CopyableText value={bid.bidId} displayValue={truncateMiddle(bid.bidId, 14, 8)} />} />
                                            <DataPoint label="Vendor" value={<CopyableText value={bid.owner} displayValue={truncateMiddle(bid.owner, 14, 10)} />} />
                                            <DataPoint label="Stake" value={formatAmount(bid.stake, rfq.tokenType)} />
                                            <DataPoint
                                                label="On-chain revealed"
                                                value={bid.revealed ? formatAmount(bid.revealedAmount, rfq.tokenType) : 'Still encrypted'}
                                            />
                                        </DataGrid>
                                    </button>
                                ))}
                            </div>
                        )}
                    </Panel>

                    {txHash ? (
                        <Panel title="Latest transaction">
                            <DataGrid columns={2}>
                                <DataPoint label="Tx hash" value={<CopyableText value={txHash} displayValue={truncateMiddle(txHash, 18, 12)} />} />
                            </DataGrid>
                        </Panel>
                    ) : null}
                </div>
            </div>
        </PageShell>
    );
}
