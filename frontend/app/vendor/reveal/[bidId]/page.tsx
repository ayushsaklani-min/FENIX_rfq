'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import DeadlineCountdown from '@/components/DeadlineCountdown';
import { Button } from '@/components/ui/Button';
import {
    ActionBar,
    CopyableText,
    DataGrid,
    DataPoint,
    Field,
    InfoList,
    InfoRow,
    Notice,
    PageHeader,
    PageShell,
    Panel,
    TextAreaInput,
    TextInput,
} from '@/components/protocol/ProtocolPrimitives';
import { authenticatedFetch } from '@/lib/authFetch';
import { fetchCurrentBlockHeight } from '@/lib/sepoliaClient';
import { buildWinnerProofShare, encodeWinnerProofShare } from '@/lib/fhenixWorkflow';
import { formatAmount } from '@/lib/sealProtocol';
import { safeGetItem } from '@/lib/safeLocalStorage';
import { truncateMiddle } from '@/lib/utils';

type SavedBidBundle = {
    bidId: string;
    rfqId: string;
    encryptedAmountCtHash: string;
    bidAmount: string;
};

type BidDetail = {
    rfqId: string;
    bidId: string;
    owner: string;
    encryptedAmountCtHash: string;
    stake: string;
    revealed: boolean;
    revealedAmount: string;
};

type RfqDetail = {
    id: string;
    biddingDeadline: number;
    revealDeadline: number;
    tokenType: number;
    status: string;
    statusCode: number;
};

function loadSavedBidBundle(bidId: string): SavedBidBundle | null {
    const raw = safeGetItem(`fhenix_bid_${bidId}`);
    if (!raw) {
        return null;
    }

    try {
        return JSON.parse(raw) as SavedBidBundle;
    } catch {
        return null;
    }
}

export default function RevealBidPage({ params }: { params: { bidId: string } }) {
    const searchParams = useSearchParams();
    const [rfqId, setRfqId] = useState('');
    const [bid, setBid] = useState<BidDetail | null>(null);
    const [rfq, setRfq] = useState<RfqDetail | null>(null);
    const [currentBlock, setCurrentBlock] = useState<number | null>(null);
    const [proofPackage, setProofPackage] = useState('');
    const [loading, setLoading] = useState(true);
    const [building, setBuilding] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const fromQuery = searchParams.get('rfqId')?.trim();
        if (fromQuery) {
            setRfqId(fromQuery);
            return;
        }
        const saved = loadSavedBidBundle(params.bidId);
        if (saved?.rfqId) {
            setRfqId(saved.rfqId);
        }
    }, [params.bidId, searchParams]);

    useEffect(() => {
        let cancelled = false;

        const load = async () => {
            if (!rfqId) {
                setLoading(false);
                return;
            }

            setLoading(true);
            try {
                const [bidResponse, rfqResponse, blockHeight] = await Promise.all([
                    authenticatedFetch(`/api/fhenix/rfq/${encodeURIComponent(rfqId)}/bids/${encodeURIComponent(params.bidId)}`),
                    authenticatedFetch(`/api/fhenix/rfq/${encodeURIComponent(rfqId)}`),
                    fetchCurrentBlockHeight(),
                ]);

                const bidPayload = await bidResponse.json();
                const rfqPayload = await rfqResponse.json();

                if (!bidResponse.ok) {
                    throw new Error(bidPayload?.error?.message || 'Failed to load bid.');
                }
                if (!rfqResponse.ok) {
                    throw new Error(rfqPayload?.error?.message || 'Failed to load RFQ.');
                }

                if (!cancelled) {
                    setBid(bidPayload.data);
                    setRfq(rfqPayload.data);
                    setCurrentBlock(blockHeight);
                }
            } catch (caught: any) {
                if (!cancelled) {
                    setError(caught?.message || 'Failed to load bid proof data.');
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
    }, [params.bidId, rfqId]);

    const handleBuildProof = async () => {
        if (!bid || !rfq) {
            return;
        }

        setBuilding(true);
        setError(null);

        try {
            if (currentBlock !== null && currentBlock < rfq.biddingDeadline) {
                throw new Error('Wait until bidding closes before sharing a winner proof with the buyer.');
            }

            const proof = await buildWinnerProofShare(bid.encryptedAmountCtHash, bid.bidId as `0x${string}`);
            setProofPackage(encodeWinnerProofShare(proof));
        } catch (caught: any) {
            setError(caught?.message || 'Failed to build the winner proof package.');
        } finally {
            setBuilding(false);
        }
    };

    const savedBundle = useMemo(() => loadSavedBidBundle(params.bidId), [params.bidId]);

    if (loading) {
        return (
            <PageShell>
                <Panel title="Loading bid proof page">
                    <div className="text-sm text-[hsl(var(--muted-foreground))]">Fetching the RFQ state and your encrypted bid handle.</div>
                </Panel>
            </PageShell>
        );
    }

    return (
        <PageShell className="space-y-6">
            <PageHeader
                eyebrow="Vendor"
                title="Share winner proof"
                description="If the buyer needs your proof package to finalize direct RFQ winner selection, build it here from your encrypted bid handle and send it to them off-chain."
            />

            {error ? <Notice tone="danger">{error}</Notice> : null}
            {!rfqId ? (
                <Notice tone="warning" title="RFQ id required">
                    This page needs the RFQ id that owns the bid. If you opened it directly instead of coming from the vendor workspace, paste the RFQ id below first.
                </Notice>
            ) : null}

            <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
                <div className="space-y-6">
                    <Panel title="Bid reference">
                        <div className="space-y-4">
                            <Field label="RFQ id">
                                <TextInput
                                    value={rfqId}
                                    onChange={(event) => setRfqId(event.target.value)}
                                    placeholder="0x..."
                                />
                            </Field>
                            {bid ? (
                                <DataGrid columns={2}>
                                    <DataPoint label="Bid id" value={<CopyableText value={bid.bidId} displayValue={truncateMiddle(bid.bidId, 16, 10)} />} />
                                    <DataPoint label="Stake" value={formatAmount(bid.stake, rfq.tokenType, 0)} />
                                    <DataPoint
                                        label="Ciphertext handle"
                                        value={<CopyableText value={bid.encryptedAmountCtHash} displayValue={truncateMiddle(bid.encryptedAmountCtHash, 18, 12)} />}
                                    />
                                    <DataPoint label="Selected on-chain" value={bid.revealed ? 'Yes' : 'Not yet'} />
                                </DataGrid>
                            ) : null}
                            <ActionBar>
                                <Button onClick={handleBuildProof} isLoading={building} disabled={!bid || !rfq}>
                                    Build proof package
                                </Button>
                            </ActionBar>
                        </div>
                    </Panel>

                    <Panel title="Proof package" subtitle="Send this package to the buyer. They will paste it into the winner-selection screen.">
                        <Field label="Winner proof bundle">
                            <TextAreaInput
                                value={proofPackage}
                                onChange={(event) => setProofPackage(event.target.value)}
                                placeholder="Proof package will appear here after you build it."
                            />
                        </Field>
                        <ActionBar>
                            <Button
                                variant="secondary"
                                onClick={() => navigator.clipboard.writeText(proofPackage)}
                                disabled={!proofPackage}
                            >
                                Copy proof package
                            </Button>
                            {rfqId ? (
                                <Link href={`/vendor/bid/${encodeURIComponent(rfqId)}`}>
                                    <Button variant="secondary">Back to bid</Button>
                                </Link>
                            ) : null}
                        </ActionBar>
                    </Panel>
                </div>

                <div className="space-y-6">
                    {rfq ? (
                        <Panel title="RFQ timing">
                            <div className="space-y-3">
                                <DeadlineCountdown deadlineBlock={rfq.biddingDeadline} label="Bidding deadline" passedLabel="Bidding closed" />
                                <DeadlineCountdown deadlineBlock={rfq.revealDeadline} label="Buyer selection window" passedLabel="Selection window closed" />
                            </div>
                            <div className="mt-4 text-sm text-white/55">
                                Direct RFQ winner selection requires the bidder’s proof package because the winning ciphertext is not readable by the buyer directly.
                            </div>
                        </Panel>
                    ) : null}

                    {savedBundle ? (
                        <Panel title="Browser backup">
                            <InfoList>
                                <InfoRow label="RFQ id" value={<CopyableText value={savedBundle.rfqId} displayValue={truncateMiddle(savedBundle.rfqId, 16, 10)} />} />
                                <InfoRow label="Original bid" value={rfq ? formatAmount(savedBundle.bidAmount, rfq.tokenType, 0) : savedBundle.bidAmount} />
                            </InfoList>
                            <div className="mt-3 text-sm text-white/55">
                                This browser backup is only a convenience fallback. The proof page still prefers the live indexed bid and RFQ state from Sepolia.
                            </div>
                        </Panel>
                    ) : null}
                </div>
            </div>
        </PageShell>
    );
}
