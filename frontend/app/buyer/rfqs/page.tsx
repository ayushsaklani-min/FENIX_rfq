'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
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
    PricingChip,
    SelectInput,
    StatusChip,
    TextInput,
    TokenChip,
} from '@/components/protocol/ProtocolPrimitives';
import { useWallet } from '@/contexts/WalletContext';
import { authenticatedFetch } from '@/lib/authFetch';
import { formatAmount, pricingLabel, tokenLabel } from '@/lib/sealProtocol';
import { truncateMiddle } from '@/lib/utils';

type RfqListItem = {
    id: string;
    itemName?: string | null;
    description?: string | null;
    quantity?: string | null;
    unit?: string | null;
    status: string;
    tokenType: number;
    pricingMode: number;
    minBid: string;
    biddingDeadline: number;
    revealDeadline: number;
    bidCount?: string | null;
    minBidCount?: string | null;
    paid?: boolean;
    auctionSource?: string | null;
};

function nextActionLabel(rfq: RfqListItem) {
    if (rfq.status === 'BIDDING') return 'Submit encrypted bid';
    if (rfq.pricingMode !== 0 && !rfq.auctionSource) return 'Import auction result';
    if (rfq.status === 'REVEAL') return 'Winner workflow';
    if (rfq.status === 'WINNER_SELECTED') return 'Wait for winner response';
    if (rfq.status === 'ESCROW_FUNDED') return 'Manage settlement';
    return 'Open RFQ';
}

export default function BuyerRfqsPage() {
    const router = useRouter();
    const { role } = useWallet();
    const isVendor = role === 'VENDOR';
    const [lookupId, setLookupId] = useState('');
    const [rfqs, setRfqs] = useState<RfqListItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [statusFilter, setStatusFilter] = useState('ALL');
    const [tokenFilter, setTokenFilter] = useState('ALL');
    const [pricingFilter, setPricingFilter] = useState('ALL');

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            try {
                const response = await authenticatedFetch(isVendor ? '/api/fhenix/rfq/open' : '/api/fhenix/rfq/my-rfqs');
                const payload = await response.json();
                if (!response.ok) {
                    throw new Error(payload?.error?.message || 'Failed to load RFQs.');
                }

                const responses = Array.isArray(payload?.data)
                    ? payload.data.map((item: any) => ({
                          ...item,
                          pricingMode: item.pricingMode ?? item.mode,
                      }))
                    : [];

                if (!cancelled) setRfqs(responses);
            } catch (caught: any) {
                if (!cancelled) setError(caught?.message || 'Failed to load RFQs.');
            } finally {
                if (!cancelled) setLoading(false);
            }
        };

        load();
        return () => {
            cancelled = true;
        };
    }, [isVendor]);

    const filtered = useMemo(
        () =>
            rfqs.filter((rfq) => {
                if (statusFilter !== 'ALL' && rfq.status !== statusFilter) return false;
                if (tokenFilter !== 'ALL' && String(rfq.tokenType) !== tokenFilter) return false;
                if (pricingFilter !== 'ALL' && String(rfq.pricingMode) !== pricingFilter) return false;
                return true;
            }),
        [pricingFilter, rfqs, statusFilter, tokenFilter],
    );

    const openCount = rfqs.filter((rfq) => rfq.status === 'BIDDING').length;
    const settlementCount = rfqs.filter((rfq) => rfq.status === 'ESCROW_FUNDED').length;
    const importCount = rfqs.filter((rfq) => rfq.pricingMode !== 0 && !rfq.auctionSource).length;
    const rfqDetailHref = (rfqId: string) =>
        isVendor ? `/vendor/bid/${encodeURIComponent(rfqId)}` : `/buyer/rfqs/${encodeURIComponent(rfqId)}`;
    const lookupHref = (rfqId: string) =>
        isVendor ? `/vendor/bid/${encodeURIComponent(rfqId)}` : `/buyer/rfqs/${encodeURIComponent(rfqId)}`;

    return (
        <PageShell className="space-y-6">
            <PageHeader
                eyebrow={isVendor ? 'Vendor' : 'Buyer'}
                title={isVendor ? 'Open RFQs' : 'My RFQs'}
                description={
                    isVendor
                        ? 'Browse indexed open RFQs on Sepolia and jump directly into the encrypted bidding flow.'
                        : 'A compact view of every RFQ you created, with the next action for each.'
                }
                actions={
                    <ActionBar>
                        {isVendor ? (
                            <Link href="/vendor/my-bids">
                                <Button>My bids</Button>
                            </Link>
                        ) : (
                            <Link href="/buyer/create-rfq">
                                <Button>Create RFQ</Button>
                            </Link>
                        )}
                        <Link href="/auctions">
                            <Button variant="secondary">Auctions</Button>
                        </Link>
                    </ActionBar>
                }
            />

            {error ? <Notice tone="danger">{error}</Notice> : null}
            {isVendor ? (
                <Notice tone="neutral" title="Viewing as Seller">
                    You are browsing indexed open Sepolia RFQs as a seller. Use the lookup below for any direct id, or go to your <a href="/vendor/my-bids" className="underline">Vendor dashboard</a> to track submitted bids.
                </Notice>
            ) : null}

            <div className="flex gap-3">
                <div className="flex-1">
                    <TextInput
                        value={lookupId}
                        onChange={(e) => setLookupId(e.target.value)}
                        placeholder="Open any RFQ by ID..."
                        onKeyDown={(e) => { if (e.key === 'Enter' && lookupId.trim()) router.push(lookupHref(lookupId.trim())); }}
                    />
                </div>
                <Button disabled={!lookupId.trim()} onClick={() => router.push(lookupHref(lookupId.trim()))}>
                    Open
                </Button>
            </div>

            <DataGrid columns={4}>
                <DataPoint label="Total RFQs" value={rfqs.length} />
                <DataPoint label="Open for bids" value={openCount} />
                <DataPoint label="Need auction import" value={importCount} subtle="Vickrey or Dutch RFQs still waiting for a result" />
                <DataPoint label="In settlement" value={settlementCount} />
            </DataGrid>

            <div className="grid gap-4 md:grid-cols-3">
                <Field label="Status">
                    <SelectInput value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                        <option value="ALL">All statuses</option>
                        <option value="BIDDING">Accepting bids</option>
                        <option value="REVEAL">Reveal phase</option>
                        <option value="WINNER_SELECTED">Awaiting winner response</option>
                        <option value="ESCROW_FUNDED">In delivery</option>
                        <option value="COMPLETED">Completed</option>
                        <option value="CANCELLED">Cancelled</option>
                        <option value="REJECTED">Winner declined</option>
                    </SelectInput>
                </Field>
                <Field label="Token">
                    <SelectInput value={tokenFilter} onChange={(event) => setTokenFilter(event.target.value)}>
                        <option value="ALL">All tokens</option>
                        <option value="0">{tokenLabel(0)}</option>
                        <option value="1">{tokenLabel(1)}</option>
                    </SelectInput>
                </Field>
                <Field label="Pricing mode">
                    <SelectInput value={pricingFilter} onChange={(event) => setPricingFilter(event.target.value)}>
                        <option value="ALL">All pricing modes</option>
                        <option value="0">{pricingLabel(0)}</option>
                        <option value="1">{pricingLabel(1)}</option>
                        <option value="2">{pricingLabel(2)}</option>
                    </SelectInput>
                </Field>
            </div>

            {loading ? (
                <div className="space-y-4">
                    {[1, 2, 3].map((i) => (
                        <div key={i} className="rounded-2xl border border-white/12 bg-white/[0.04] p-5 space-y-3">
                            <div className="skeleton h-5 w-1/4 rounded-lg" />
                            <div className="skeleton h-6 w-1/3 rounded-lg" />
                            <div className="skeleton h-4 w-2/3 rounded-lg" />
                            <div className="grid gap-3 md:grid-cols-4 mt-4">
                                {[1,2,3,4].map((j) => <div key={j} className="skeleton h-16 rounded-xl" />)}
                            </div>
                        </div>
                    ))}
                </div>
            ) : filtered.length === 0 ? (
                <EmptyState
                    title="No RFQs match these filters"
                    description={isVendor ? 'Try a broader filter or open an RFQ directly by id.' : 'Create a new RFQ or open one directly by id.'}
                    actionHref={isVendor ? '/vendor/my-bids' : '/buyer/create-rfq'}
                    actionLabel={isVendor ? 'Open my bids' : 'Create RFQ'}
                />
            ) : (
                <div className="space-y-4">
                    {filtered.map((rfq) => (
                        <Link
                            key={rfq.id}
                            href={rfqDetailHref(rfq.id)}
                            className="group block rounded-2xl border border-white/12 bg-white/[0.04] p-5 transition-all duration-200 hover:-translate-y-0.5 hover:border-amber-200/30 hover:bg-white/[0.07] hover:shadow-[0_8px_32px_rgba(0,0,0,0.35)]"
                        >
                            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                                <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <StatusChip status={rfq.status} />
                                        <TokenChip tokenType={rfq.tokenType} />
                                        <PricingChip pricingMode={rfq.pricingMode} />
                                    </div>
                                    <div className="mt-3 text-lg font-semibold text-white group-hover:text-amber-50 transition-colors">{rfq.itemName || 'Direct Sepolia RFQ'}</div>
                                    <div className="mt-2 max-w-fit">
                                        <CopyableText value={rfq.id} displayValue={truncateMiddle(rfq.id, 16, 10)} />
                                    </div>
                                    {rfq.description ? (
                                        <p className="mt-3 max-w-3xl text-sm leading-6 text-white/60">
                                            {rfq.description}
                                        </p>
                                    ) : null}
                                </div>
                                <div className="rounded-xl border border-amber-200/20 bg-amber-400/[0.06] px-4 py-3 lg:min-w-[220px]">
                                    <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-amber-200/70">Next action</div>
                                    <div className="mt-1.5 text-sm font-semibold text-amber-100">{nextActionLabel(rfq)}</div>
                                    <div className="mt-3 space-y-1 text-xs text-white/55">
                                        <div>Bid close: <span className="text-white/80 font-medium">block {rfq.biddingDeadline}</span></div>
                                        <div>Buyer flow: <span className="text-white/80 font-medium">block {rfq.revealDeadline}</span></div>
                                    </div>
                                </div>
                            </div>

                            <div className="mt-4 grid gap-3 md:grid-cols-4">
                                <DataPoint label="Minimum bid" value={formatAmount(rfq.minBid, rfq.tokenType)} />
                                <DataPoint label="Bid count" value={`${rfq.bidCount ?? '0'} / ${rfq.minBidCount ?? '1'}`} />
                                <DataPoint label="Quantity" value={rfq.quantity ? `${rfq.quantity} ${rfq.unit || ''}`.trim() : '--'} />
                                <DataPoint label="Settlement" value={rfq.paid ? 'Paid privately' : rfq.auctionSource ? 'Auction imported' : 'Pending'} />
                            </div>
                        </Link>
                    ))}
                </div>
            )}
        </PageShell>
    );
}
