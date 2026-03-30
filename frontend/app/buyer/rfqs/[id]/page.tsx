'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/Button';
import {
    ActionBar,
    CopyableText,
    DataGrid,
    DataPoint,
    InfoList,
    InfoRow,
    Notice,
    PageHeader,
    PageShell,
    Panel,
    PricingChip,
    StatusChip,
    TokenChip,
} from '@/components/protocol/ProtocolPrimitives';
import { useWallet } from '@/contexts/WalletContext';
import { authenticatedFetch } from '@/lib/authFetch';
import { fetchCurrentBlockHeight } from '@/lib/sepoliaClient';
import { formatAmount, PRICING_MODE, pricingLabel } from '@/lib/sealProtocol';
import { truncateMiddle } from '@/lib/utils';

type RfqDetail = {
    id: string;
    creator: string;
    biddingDeadline: number;
    revealDeadline: number;
    minBid: string;
    minBidCount: string;
    flatStake: string;
    tokenType: number;
    mode: number;
    statusCode: number;
    status: string;
    bidCount: string;
    winnerAddress: string;
    winnerBidId: string;
    winnerAccepted: boolean;
    paid: boolean;
    finalPaymentReleased: boolean;
    lowestPublishedBid: string;
    lowestBidPublished: boolean;
    auctionSource: string;
    importedWinnerPrice: string;
    escrow: {
        originalAmount: string;
        currentAmount: string;
        totalReleased: string;
    };
};

type Bid = {
    bidId: string;
    owner: string;
    encryptedAmountCtHash: string;
    stake: string;
    revealed: boolean;
    revealedAmount: string;
};

export default function BuyerRfqDetailPage({ params }: { params: { id: string } }) {
    const { role } = useWallet();
    const isVendor = role === 'VENDOR';
    const [rfq, setRfq] = useState<RfqDetail | null>(null);
    const [bids, setBids] = useState<Bid[]>([]);
    const [currentBlock, setCurrentBlock] = useState<number | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;

        const load = async () => {
            try {
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

                if (!cancelled) {
                    setRfq(rfqPayload.data);
                    setBids(Array.isArray(bidsPayload?.data) ? bidsPayload.data : []);
                    setCurrentBlock(blockHeight);
                }
            } catch (caught: any) {
                if (!cancelled) {
                    setError(caught?.message || 'Failed to load RFQ.');
                }
            } finally {
                if (!cancelled) {
                    setLoading(false);
                }
            }
        };

        load();
        const intervalId = window.setInterval(load, 15000);
        return () => {
            cancelled = true;
            window.clearInterval(intervalId);
        };
    }, [params.id]);

    const nextAction = useMemo(() => {
        if (!rfq) {
            return null;
        }

        if (rfq.mode !== PRICING_MODE.RFQ && (!rfq.auctionSource || rfq.auctionSource === '0x' + '0'.repeat(64))) {
            return {
                label: `Open ${pricingLabel(rfq.mode)} workspace`,
                href: rfq.mode === PRICING_MODE.VICKREY ? `/auctions/vickrey?rfqId=${encodeURIComponent(rfq.id)}` : `/auctions/dutch?rfqId=${encodeURIComponent(rfq.id)}`,
                description: 'This RFQ waits for an imported auction result before winner response and escrow can continue.',
            };
        }

        if (rfq.mode === PRICING_MODE.RFQ && currentBlock !== null && currentBlock >= rfq.biddingDeadline && rfq.statusCode < 3) {
            return {
                label: 'Open winner selection',
                href: `/buyer/rfqs/${encodeURIComponent(rfq.id)}/select-winner`,
                description: rfq.lowestBidPublished
                    ? 'Paste the bidder proof package and select the winning bid.'
                    : 'Publish the lowest encrypted bid proof, then select the winner.',
            };
        }

        if (rfq.statusCode === 3 && rfq.winnerAccepted) {
            return {
                label: 'Fund escrow',
                href: `/buyer/rfqs/${encodeURIComponent(rfq.id)}/fund-escrow`,
                description: 'The winner accepted. Funding escrow is the next on-chain step.',
            };
        }

        if (rfq.statusCode === 4) {
            return {
                label: 'Open escrow',
                href: `/escrow/${encodeURIComponent(rfq.id)}`,
                description: 'Escrow is funded and settlement is now active.',
            };
        }

        return null;
    }, [currentBlock, rfq]);

    if (loading) {
        return (
            <PageShell>
                <Panel title="Loading RFQ">
                    <div className="text-sm text-[hsl(var(--muted-foreground))]">Fetching the Sepolia RFQ state and bid list.</div>
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
                title="RFQ detail"
                description="Track the live Sepolia contract state, encrypted bids, winner selection, and escrow progress from one place."
                actions={
                    <ActionBar>
                        <StatusChip status={rfq.status} />
                        <TokenChip tokenType={rfq.tokenType} />
                        <PricingChip pricingMode={rfq.mode} />
                    </ActionBar>
                }
            />

            {error ? <Notice tone="danger">{error}</Notice> : null}
            {rfq.mode !== PRICING_MODE.RFQ ? (
                <Notice title="Auction-backed RFQ">
                    This RFQ uses {pricingLabel(rfq.mode)} pricing. Winner selection comes from an imported auction result rather than direct encrypted bids.
                </Notice>
            ) : null}
            {isVendor && rfq.mode === PRICING_MODE.RFQ && rfq.statusCode === 1 ? (
                <Notice title="Seller action available">
                    Submit your encrypted bid from the vendor workspace.
                    <ActionBar className="mt-3">
                        <Link href={`/vendor/bid/${encodeURIComponent(rfq.id)}`}>
                            <Button size="sm">Open bid page</Button>
                        </Link>
                    </ActionBar>
                </Notice>
            ) : null}

            <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
                <div className="space-y-6">
                    <Panel title="RFQ summary">
                        <DataGrid columns={2}>
                            <DataPoint label="RFQ id" value={<CopyableText value={rfq.id} displayValue={truncateMiddle(rfq.id, 16, 10)} />} />
                            <DataPoint label="Creator" value={<CopyableText value={rfq.creator} displayValue={truncateMiddle(rfq.creator, 14, 10)} />} />
                            <DataPoint label="Minimum bid" value={formatAmount(rfq.minBid, rfq.tokenType)} />
                            <DataPoint label="Flat stake" value={formatAmount(rfq.flatStake, rfq.tokenType)} />
                            <DataPoint label="Bid count" value={`${rfq.bidCount} / ${rfq.minBidCount}`} />
                            <DataPoint label="Current block" value={currentBlock ?? '--'} />
                            <DataPoint label="Lowest published bid" value={rfq.lowestBidPublished ? formatAmount(rfq.lowestPublishedBid, rfq.tokenType) : 'Not published'} />
                            <DataPoint label="Winner accepted" value={rfq.winnerAccepted ? 'Yes' : 'No'} />
                        </DataGrid>
                    </Panel>

                    <Panel title="Bids">
                        {bids.length === 0 ? (
                            <div className="text-sm text-[hsl(var(--muted-foreground))]">No encrypted bids have been indexed for this RFQ yet.</div>
                        ) : (
                            <div className="space-y-3">
                                {bids.map((bid) => (
                                    <div key={bid.bidId} className="rounded-xl border border-slate-200 bg-slate-50/80 p-4">
                                        <DataGrid columns={2}>
                                            <DataPoint label="Bid id" value={<CopyableText value={bid.bidId} displayValue={truncateMiddle(bid.bidId, 14, 8)} />} />
                                            <DataPoint label="Vendor" value={<CopyableText value={bid.owner} displayValue={truncateMiddle(bid.owner, 14, 10)} />} />
                                            <DataPoint label="Stake" value={formatAmount(bid.stake, rfq.tokenType)} />
                                            <DataPoint label="Selected amount" value={bid.revealed ? formatAmount(bid.revealedAmount, rfq.tokenType) : 'Still encrypted'} />
                                        </DataGrid>
                                    </div>
                                ))}
                            </div>
                        )}
                    </Panel>
                </div>

                <div className="space-y-6">
                    <Panel title="Lifecycle">
                        <InfoList>
                            <InfoRow label="Status" value={rfq.status} />
                            <InfoRow label="Winner bid" value={rfq.winnerBidId && rfq.winnerBidId !== '0x' + '0'.repeat(64) ? <CopyableText value={rfq.winnerBidId} displayValue={truncateMiddle(rfq.winnerBidId, 14, 8)} /> : '--'} />
                            <InfoRow label="Winner address" value={rfq.winnerAddress && rfq.winnerAddress !== '0x0000000000000000000000000000000000000000' ? <CopyableText value={rfq.winnerAddress} displayValue={truncateMiddle(rfq.winnerAddress, 14, 10)} /> : '--'} />
                            <InfoRow label="Auction source" value={rfq.auctionSource && rfq.auctionSource !== '0x' + '0'.repeat(64) ? <CopyableText value={rfq.auctionSource} displayValue={truncateMiddle(rfq.auctionSource, 16, 10)} /> : '--'} />
                            <InfoRow label="Imported winner price" value={rfq.importedWinnerPrice !== '0' ? formatAmount(rfq.importedWinnerPrice, rfq.tokenType) : '--'} />
                        </InfoList>
                        {nextAction ? (
                            <ActionBar className="mt-4">
                                <Link href={nextAction.href}>
                                    <Button>{nextAction.label}</Button>
                                </Link>
                            </ActionBar>
                        ) : null}
                        {nextAction ? <div className="mt-3 text-sm text-white/55">{nextAction.description}</div> : null}
                    </Panel>

                    <Panel title="Escrow state">
                        <InfoList>
                            <InfoRow label="Original amount" value={formatAmount(rfq.escrow.originalAmount, rfq.tokenType)} />
                            <InfoRow label="Current amount" value={formatAmount(rfq.escrow.currentAmount, rfq.tokenType)} />
                            <InfoRow label="Total released" value={formatAmount(rfq.escrow.totalReleased, rfq.tokenType)} />
                            <InfoRow label="Private payment" value={rfq.paid ? 'Recorded' : 'Not recorded'} />
                            <InfoRow label="Final payment released" value={rfq.finalPaymentReleased ? 'Yes' : 'No'} />
                        </InfoList>
                    </Panel>
                </div>
            </div>
        </PageShell>
    );
}
