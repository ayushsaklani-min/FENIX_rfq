'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/Button';
import {
    ActionBar,
    CopyableText,
    DataGrid,
    DataPoint,
    EmptyState,
    Notice,
    PageHeader,
    PageShell,
    Panel,
    PricingChip,
    StatusChip,
    TokenChip,
} from '@/components/protocol/ProtocolPrimitives';
import { useToast } from '@/components/Toast';
import { authenticatedFetch } from '@/lib/authFetch';
import { fetchCurrentBlockHeight } from '@/lib/sepoliaClient';
import { formatAmount } from '@/lib/sealProtocol';
import { truncateMiddle } from '@/lib/utils';
import { walletFirstTx } from '@/lib/walletTx';

type HydratedBid = {
    bidId: string;
    rfqId: string;
    owner: string;
    encryptedAmountCtHash: string;
    stake: string;
    revealed: boolean;
    revealedAmount: string;
    itemName?: string | null;
    description?: string | null;
    rfq: {
        status: string;
        statusCode: number;
        tokenType: number;
        mode: number;
        biddingDeadline: number;
        revealDeadline: number;
        winnerAddress: string;
        winnerAccepted: boolean;
    };
};

export default function VendorMyBidsPage() {
    const toast = useToast();
    const [bids, setBids] = useState<HydratedBid[]>([]);
    const [currentBlock, setCurrentBlock] = useState<number | null>(null);
    const [loading, setLoading] = useState(true);
    const [acting, setActing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [txHash, setTxHash] = useState<string | null>(null);

    const loadBids = async () => {
        const response = await authenticatedFetch('/api/fhenix/rfq/my-bids');
        const payload = await response.json();
        if (!response.ok) {
            throw new Error(payload?.error?.message || 'Failed to load indexed bids.');
        }
        const hydrated = Array.isArray(payload?.data) ? (payload.data as HydratedBid[]) : [];
        setBids(hydrated);
    };

    useEffect(() => {
        let cancelled = false;

        const load = async () => {
            try {
                if (!cancelled) {
                    await loadBids();
                }
            } catch (caught: any) {
                if (!cancelled) {
                    setError(caught?.message || 'Failed to load indexed bids.');
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
    }, []);

    useEffect(() => {
        let cancelled = false;

        fetchCurrentBlockHeight()
            .then((blockHeight) => {
                if (!cancelled) {
                    setCurrentBlock(blockHeight);
                }
            })
            .catch(() => {});

        return () => {
            cancelled = true;
        };
    }, []);

    const respondToAward = async (rfqId: string, accept: boolean) => {
        setActing(true);
        setError(null);
        try {
            const result = await walletFirstTx(
                `/api/fhenix/rfq/${encodeURIComponent(rfqId)}/winner-respond`,
                { accept },
                (_prepareData, confirmedTxHash) => ({ accept, txHash: confirmedTxHash }),
            );
            setTxHash(result.txHash || null);
            await loadBids();
            toast.success('Winner response confirmed on-chain.');
        } catch (caught: any) {
            const message = caught?.message || 'Failed to submit winner response.';
            setError(message);
            toast.error(message);
        } finally {
            setActing(false);
        }
    };

    const wonCount = useMemo(
        () => bids.filter((bid) => bid.rfq.winnerAddress?.toLowerCase() === bid.owner.toLowerCase()).length,
        [bids],
    );
    const proofCount = useMemo(
        () => bids.filter((bid) => currentBlock !== null && currentBlock >= bid.rfq.biddingDeadline && bid.rfq.statusCode < 3).length,
        [bids, currentBlock],
    );

    if (loading) {
        return (
            <PageShell>
                <Panel title="Loading vendor workspace">
                    <div className="text-sm text-[hsl(var(--muted-foreground))]">Fetching indexed bids and live Sepolia contract state.</div>
                </Panel>
            </PageShell>
        );
    }

    return (
        <PageShell className="space-y-6">
            <PageHeader
                eyebrow="Vendor"
                title="My bids"
                description="Manage your indexed encrypted RFQ bids, share winner proof packages, and respond if one of your bids is selected."
            />

            {error ? <Notice tone="danger">{error}</Notice> : null}

            <DataGrid columns={3}>
                <DataPoint label="Indexed bids" value={bids.length} />
                <DataPoint label="Need proof share" value={proofCount} />
                <DataPoint label="Won" value={wonCount} />
            </DataGrid>

            <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
                <div className="space-y-6">
                    <Panel title="Indexed bid workspace">
                        {bids.length === 0 ? (
                            <EmptyState
                                title="No indexed encrypted bids"
                                description="Submit an encrypted bid and confirm the transfer check first, then this page will track it from the live contracts."
                                actionHref="/buyer/rfqs"
                                actionLabel="Browse RFQs"
                            />
                        ) : (
                            <div className="space-y-3">
                                {bids.map((bid) => {
                                    const isWinner = bid.rfq.winnerAddress?.toLowerCase() === bid.owner.toLowerCase();
                                    const canRespond = isWinner && bid.rfq.statusCode === 3 && !bid.rfq.winnerAccepted;
                                    const canShareProof = currentBlock !== null && currentBlock >= bid.rfq.biddingDeadline && bid.rfq.statusCode < 3;

                                    return (
                                        <div key={bid.bidId} className="rounded-xl border border-white/12 bg-white/[0.05] p-4 transition hover:border-white/20 hover:bg-white/[0.07]">
                                            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                                                <div>
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        <StatusChip status={bid.rfq.status} />
                                                        <TokenChip tokenType={bid.rfq.tokenType} />
                                                        <PricingChip pricingMode={bid.rfq.mode} />
                                                    </div>
                                                    {bid.itemName ? <div className="mt-3 text-base font-semibold text-white">{bid.itemName}</div> : null}
                                                    <div className="mt-3 max-w-fit">
                                                        <CopyableText value={bid.rfqId} displayValue={truncateMiddle(bid.rfqId, 16, 10)} className="text-sm font-semibold" />
                                                    </div>
                                                    <div className="mt-2 max-w-fit">
                                                        <CopyableText value={bid.bidId} displayValue={truncateMiddle(bid.bidId, 14, 8)} />
                                                    </div>
                                                </div>
                                                <div className="rounded-xl border border-amber-200/20 bg-amber-400/[0.06] px-4 py-3 text-sm lg:min-w-[220px]">
                                                    <div className={isWinner ? 'font-semibold text-emerald-300' : 'text-white/70'}>
                                                        {isWinner ? 'Selected winner' : bid.revealed ? 'Selected on-chain' : 'Still encrypted'}
                                                    </div>
                                                    <div className="text-white/60">Stake: <span className="font-medium text-white">{formatAmount(bid.stake, bid.rfq.tokenType)}</span></div>
                                                    <div className="text-white/60">Bid: <span className="font-medium text-white">{bid.revealed ? formatAmount(bid.revealedAmount, bid.rfq.tokenType) : 'Encrypted'}</span></div>
                                                </div>
                                            </div>

                                            <ActionBar className="mt-3">
                                                <Link href={`/vendor/reveal/${encodeURIComponent(bid.bidId)}?rfqId=${encodeURIComponent(bid.rfqId)}`}>
                                                    <Button size="sm" variant="secondary">
                                                        {canShareProof ? 'Share winner proof' : 'Open proof page'}
                                                    </Button>
                                                </Link>

                                                {canRespond ? (
                                                    <>
                                                        <Button size="sm" onClick={() => respondToAward(bid.rfqId, true)} isLoading={acting}>
                                                            Accept award
                                                        </Button>
                                                        <Button size="sm" variant="danger" onClick={() => respondToAward(bid.rfqId, false)} isLoading={acting}>
                                                            Decline award
                                                        </Button>
                                                    </>
                                                ) : null}

                                                <Link href={`/buyer/rfqs/${encodeURIComponent(bid.rfqId)}`}>
                                                    <Button size="sm" variant="secondary">Open RFQ</Button>
                                                </Link>
                                            </ActionBar>
                                        </div>
                                    );
                                })}
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
