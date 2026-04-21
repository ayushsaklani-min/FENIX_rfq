'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import DeadlineCountdown from '@/components/DeadlineCountdown';
import {
    CopyableText,
    DataGrid,
    DataPoint,
    InfoList,
    InfoRow,
    Notice,
    PageHeader,
    PageShell,
    Panel,
} from '@/components/protocol/ProtocolPrimitives';
import { authenticatedFetch } from '@/lib/authFetch';
import { formatAmount } from '@/lib/sealProtocol';
import { safeGetItem } from '@/lib/safeLocalStorage';
import { safeGetSessionItem } from '@/lib/safeSessionStorage';
import { truncateMiddle } from '@/lib/utils';

type SavedBidBundle = {
    bidId: string;
    rfqId: string;
    encryptedAmountCtHash: string;
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
    const raw = safeGetSessionItem(`fhenix_bid_${bidId}`) ?? safeGetItem(`fhenix_bid_${bidId}`);
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
    const [loading, setLoading] = useState(true);
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
                const [bidResponse, rfqResponse] = await Promise.all([
                    authenticatedFetch(`/api/fhenix/rfq/${encodeURIComponent(rfqId)}/bids/${encodeURIComponent(params.bidId)}`),
                    authenticatedFetch(`/api/fhenix/rfq/${encodeURIComponent(rfqId)}`),
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
                }
            } catch (caught: any) {
                if (!cancelled) {
                    setError(caught?.message || 'Failed to load bid reference data.');
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
                title="Bid reference"
                description="Direct RFQ winner selection no longer needs a vendor proof package. Use this page only to inspect the saved bid reference and track the RFQ timing."
            />

            {error ? <Notice tone="danger">{error}</Notice> : null}
            {!rfqId ? (
                <Notice tone="warning" title="RFQ id required">
                    This page needs the RFQ id that owns the bid. Open it from the vendor workspace or include the RFQ id in the query string.
                </Notice>
            ) : null}

            <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
                <div className="space-y-6">
                    <Panel title="Bid reference">
                        {bid ? (
                            <DataGrid columns={2}>
                                <DataPoint label="RFQ id" value={<CopyableText value={rfqId} displayValue={truncateMiddle(rfqId, 16, 10)} />} />
                                <DataPoint label="Bid id" value={<CopyableText value={bid.bidId} displayValue={truncateMiddle(bid.bidId, 16, 10)} />} />
                                <DataPoint label="Stake" value={formatAmount(bid.stake, rfq?.tokenType ?? 0, 0)} />
                                <DataPoint
                                    label="Ciphertext handle"
                                    value={<CopyableText value={bid.encryptedAmountCtHash} displayValue={truncateMiddle(bid.encryptedAmountCtHash, 18, 12)} />}
                                />
                                <DataPoint label="Selected on-chain" value={bid.revealed ? 'Yes' : 'Not yet'} />
                            </DataGrid>
                        ) : (
                            <div className="text-sm text-white/55">Load this page from the bid workspace or include the RFQ id in the query string to see the saved bid reference.</div>
                        )}
                    </Panel>

                    <Panel title="Current direct RFQ model">
                        <div className="space-y-3 text-sm text-white/65">
                            <div>The buyer now finalizes direct RFQ winners from the contract-managed lowest bidder ciphertext.</div>
                            <div>You do not need to decrypt your bid or share an off-chain proof package for the buyer to complete winner selection.</div>
                            <div>Your next required action only starts if your bid is selected and you need to accept or decline the award.</div>
                        </div>
                        {rfqId ? (
                            <div className="mt-4">
                                <Link href={`/vendor/bid/${encodeURIComponent(rfqId)}`} className="text-sm font-medium text-emerald-300 hover:text-emerald-200">
                                    Back to bid workspace
                                </Link>
                            </div>
                        ) : null}
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
                                Buyer-side proof publication still happens after bidding closes, but the buyer no longer needs a vendor-provided proof package to finalize the direct RFQ winner.
                            </div>
                        </Panel>
                    ) : null}

                    {savedBundle ? (
                        <Panel title="Browser backup">
                            <InfoList>
                                <InfoRow label="RFQ id" value={<CopyableText value={savedBundle.rfqId} displayValue={truncateMiddle(savedBundle.rfqId, 16, 10)} />} />
                            </InfoList>
                            <div className="mt-3 text-sm text-white/55">
                                This browser backup is only a convenience fallback for the current browser session. The proof page still prefers the live indexed bid and RFQ state from Sepolia, and the amount itself is not persisted in plaintext.
                            </div>
                        </Panel>
                    ) : null}
                </div>
            </div>
        </PageShell>
    );
}
