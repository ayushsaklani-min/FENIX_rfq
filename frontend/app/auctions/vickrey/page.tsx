'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
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
    WorkflowGuide,
    type WorkflowGuideStep,
} from '@/components/protocol/ProtocolPrimitives';
import { useWallet } from '@/contexts/WalletContext';
import { authenticatedFetch } from '@/lib/authFetch';
import { fetchCurrentBlockHeight } from '@/lib/sepoliaClient';
import { formatBlockTime, randomField } from '@/lib/sealProtocol';
import { truncateMiddle } from '@/lib/utils';
import { walletFirstTx } from '@/lib/walletTx';

type SavedAuction = {
    id: string;
    rfqId: string;
    statusCode: number;
    biddingDeadline: number;
    revealDeadline: number;
    flatStake: string;
    minBidCount: string;
    bidCount: string;
    revealedCount: string;
    finalWinner: string;
    finalPrice: string;
    finalized: boolean;
};

const DURATION_OPTIONS = [
    { label: '30 minutes', blocks: 360 },
    { label: '1 hour', blocks: 720 },
    { label: '2 hours', blocks: 1440 },
    { label: '4 hours', blocks: 2880 },
    { label: '8 hours', blocks: 5760 },
    { label: '1 day', blocks: 17280 },
];

function vickreyStatusLabel(statusCode: number) {
    if (statusCode === 1) return 'OPEN';
    if (statusCode === 2) return 'REVEAL';
    if (statusCode === 3) return 'FINALIZED';
    if (statusCode === 4) return 'CANCELLED';
    return 'UNKNOWN';
}

export default function VickreyAuctionsPage() {
    const searchParams = useSearchParams();
    const linkedRfqId = searchParams.get('rfqId')?.trim() ?? '';
    const { walletAddress } = useWallet();
    const [savedAuctions, setSavedAuctions] = useState<SavedAuction[]>([]);
    const [currentBlock, setCurrentBlock] = useState<number | null>(null);
    const [rfqId, setRfqId] = useState(linkedRfqId);
    const [biddingBlocks, setBiddingBlocks] = useState('720');
    const [revealBlocks, setRevealBlocks] = useState('720');
    const [flatStake, setFlatStake] = useState('10000');
    const [minBidCount, setMinBidCount] = useState('1');
    const [createdAuctionId, setCreatedAuctionId] = useState<string | null>(null);
    const [txKey, setTxKey] = useState<string | null>(null);
    const [txHash, setTxHash] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [acting, setActing] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const loadAuctions = async () => {
        const blockHeight = await fetchCurrentBlockHeight();
        const response = await authenticatedFetch('/api/fhenix/auction/vickrey/my');
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload?.status !== 'success') {
            throw new Error(payload?.error?.message || 'Failed to load indexed Vickrey auctions.');
        }
        const fetched = Array.isArray(payload?.data) ? (payload.data as SavedAuction[]) : [];
        setCurrentBlock(blockHeight);
        setSavedAuctions(fetched);
    };

    const effectiveBiddingBlocks = Number(biddingBlocks || '0');
    const effectiveRevealBlocks = Number(revealBlocks || '0');
    const biddingDeadline = currentBlock !== null && effectiveBiddingBlocks > 0 ? currentBlock + effectiveBiddingBlocks : null;
    const revealDeadline =
        biddingDeadline !== null && effectiveRevealBlocks > 0 ? biddingDeadline + effectiveRevealBlocks : null;

    useEffect(() => {
        if (linkedRfqId) {
            setRfqId((current) => current || linkedRfqId);
        }
    }, [linkedRfqId]);

    useEffect(() => {
        let cancelled = false;

        const load = async () => {
            try {
                if (!cancelled) {
                    await loadAuctions();
                }
            } catch (caught: any) {
                if (!cancelled) {
                    setError(caught?.message || 'Failed to load indexed Vickrey auctions.');
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

    const createAuction = async () => {
        if (!walletAddress || acting) {
            return;
        }

        setActing(true);
        setError(null);

        try {
            if (currentBlock === null) {
                throw new Error('Current Sepolia block is unavailable. Retry in a moment.');
            }
            if (effectiveBiddingBlocks <= 0 || effectiveRevealBlocks <= 0) {
                throw new Error('Bidding and reveal windows must be positive block counts.');
            }
            if (!/^\d+$/.test(flatStake) || BigInt(flatStake) <= 0n) {
                throw new Error('Flat stake must be a positive integer amount.');
            }
            if (!/^\d+$/.test(minBidCount) || BigInt(minBidCount) <= 0n) {
                throw new Error('Minimum reveal count must be a positive integer.');
            }

            const salt = randomField();
            const body = {
                salt,
                rfqId: rfqId.trim() || undefined,
                biddingDeadline: currentBlock + effectiveBiddingBlocks,
                revealDeadline: currentBlock + effectiveBiddingBlocks + effectiveRevealBlocks,
                flatStake,
                minBidCount,
            };

            const result = await walletFirstTx(
                '/api/fhenix/auction/vickrey/create',
                body,
                (_prepareData, confirmedTxHash) => ({ ...body, txHash: confirmedTxHash }),
            );

            if (result.data?.auctionId) {
                setCreatedAuctionId(result.data.auctionId);
            }
            setTxKey(result.idempotencyKey || null);
            setTxHash(result.txHash || null);
            await loadAuctions();
        } catch (caught: any) {
            setError(caught?.message || 'Failed to create the Vickrey auction.');
        } finally {
            setActing(false);
        }
    };

    const linkedAuctions = useMemo(
        () => (linkedRfqId ? savedAuctions.filter((auction) => auction.rfqId?.toLowerCase() === linkedRfqId.toLowerCase()) : []),
        [linkedRfqId, savedAuctions],
    );

    const workflowSteps: WorkflowGuideStep[] = [
        {
            title: 'Create the auction',
            description: 'Create the linked Vickrey auction on Ethereum Sepolia with a flat stake and reveal threshold.',
            state: createdAuctionId ? 'complete' : 'current',
        },
        {
            title: 'Vendors commit encrypted bids',
            description: 'Vendors encrypt bid amounts locally, submit them, and confirm the FHERC20 stake transfer.',
            state: createdAuctionId ? 'current' : 'upcoming',
        },
        {
            title: 'Reveal and finalize',
            description: 'After bidding closes, vendors reveal their own bid ciphertexts and the buyer finalizes the second-price result.',
            state: 'upcoming',
        },
        {
            title: 'Import into RFQ',
            description: 'Once finalized, import the winner and clearing price back into the linked RFQ.',
            state: 'upcoming',
        },
    ];

    return (
        <PageShell className="space-y-6">
            <PageHeader
                eyebrow="Auctions"
                title="Vickrey auctions"
                description="Create and reopen your indexed Sepolia Vickrey auctions without relying on browser-local ids."
            />

            {error ? <Notice tone="danger">{error}</Notice> : null}

            <DataGrid columns={3}>
                <DataPoint label="Indexed auctions" value={savedAuctions.length} />
                <DataPoint label="Current block" value={currentBlock ?? 'Loading...'} />
                <DataPoint label="Linked RFQ matches" value={linkedAuctions.length} />
            </DataGrid>

            {linkedRfqId ? (
                <Notice title="Linked RFQ workspace">
                    This page was opened from RFQ <CopyableText value={linkedRfqId} displayValue={truncateMiddle(linkedRfqId, 16, 10)} />.
                    New auctions created here will stay linked to that RFQ.
                </Notice>
            ) : null}

            <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
                <Panel title="Create Vickrey auction">
                    <div className="space-y-4">
                        <Field label="Linked RFQ id" hint="Optional. Keep it filled if this auction should import back into an RFQ.">
                            <TextInput value={rfqId} onChange={(event) => setRfqId(event.target.value)} placeholder="0x..." />
                        </Field>

                        <Field label="Flat stake" hint="Every bidder stakes this same FHERC20 amount before their encrypted bid is accepted.">
                            <TextInput value={flatStake} onChange={(event) => setFlatStake(event.target.value)} placeholder="10000" />
                        </Field>

                        <Field label="Minimum reveal count" hint="The auction can only finalize once at least this many bids have been revealed.">
                            <TextInput value={minBidCount} onChange={(event) => setMinBidCount(event.target.value)} placeholder="1" />
                        </Field>

                        <div className="grid gap-4 md:grid-cols-2">
                            <Field label="Bidding window (blocks)" hint={biddingDeadline ? `Closes at block ${biddingDeadline}` : 'Length of the encrypted bidding phase.'}>
                                <TextInput value={biddingBlocks} onChange={(event) => setBiddingBlocks(event.target.value)} placeholder="720" />
                            </Field>
                            <Field label="Reveal window (blocks)" hint={revealDeadline ? `Closes at block ${revealDeadline}` : 'Length of the post-close reveal phase.'}>
                                <TextInput value={revealBlocks} onChange={(event) => setRevealBlocks(event.target.value)} placeholder="720" />
                            </Field>
                        </div>

                        <div className="rounded-xl border border-white/12 bg-white/[0.05] px-4 py-3 text-sm text-white/65">
                            <div>Preset ideas: {DURATION_OPTIONS.map((option) => option.blocks).join(', ')} blocks.</div>
                            {effectiveBiddingBlocks > 0 ? <div>Bidding duration: {formatBlockTime(effectiveBiddingBlocks)}</div> : null}
                            {effectiveRevealBlocks > 0 ? <div>Reveal duration: {formatBlockTime(effectiveRevealBlocks)}</div> : null}
                        </div>

                        <ActionBar>
                            <Button onClick={createAuction} isLoading={acting} disabled={!walletAddress || currentBlock === null}>
                                Create auction
                            </Button>
                            {linkedRfqId ? (
                                <Link href={`/buyer/rfqs/${encodeURIComponent(linkedRfqId)}`}>
                                    <Button variant="secondary">Back to RFQ</Button>
                                </Link>
                            ) : null}
                        </ActionBar>
                    </div>
                </Panel>

                <div className="space-y-6">
                    <Panel title="Workflow">
                        <WorkflowGuide steps={workflowSteps} />
                    </Panel>

                    <Panel title="Indexed auctions">
                        {loading ? (
                            <div className="text-sm text-white/60">Loading your indexed Vickrey auctions.</div>
                        ) : savedAuctions.length === 0 ? (
                            <EmptyState
                                title="No indexed Vickrey auctions"
                                description="Create a Vickrey auction from this page or open one from an RFQ to add it to the shared indexed workspace."
                            />
                        ) : (
                            <div className="space-y-3">
                                {savedAuctions.map((auction) => (
                                    <div key={auction.id} className="rounded-xl border border-white/12 bg-white/[0.05] p-4">
                                        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                                            <div className="space-y-2">
                                                <div className="max-w-fit">
                                                    <CopyableText value={auction.id} displayValue={truncateMiddle(auction.id, 16, 10)} />
                                                </div>
                                                {auction.rfqId && auction.rfqId !== `0x${'0'.repeat(64)}` ? (
                                                    <div className="max-w-fit">
                                                        <CopyableText value={auction.rfqId} displayValue={truncateMiddle(auction.rfqId, 16, 10)} />
                                                    </div>
                                                ) : (
                                                    <div className="text-sm text-white/55">Standalone auction</div>
                                                )}
                                            </div>
                                            <div className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white/70">
                                                <div className="font-semibold text-white">{vickreyStatusLabel(auction.statusCode)}</div>
                                                <div>Bid count: {auction.bidCount}</div>
                                                <div>Revealed: {auction.revealedCount}</div>
                                                <div>Flat stake: {auction.flatStake}</div>
                                            </div>
                                        </div>

                                        <ActionBar className="mt-4">
                                            <Link href={`/auctions/vickrey/${encodeURIComponent(auction.id)}`}>
                                                <Button size="sm">Open auction</Button>
                                            </Link>
                                            {auction.rfqId && auction.rfqId !== `0x${'0'.repeat(64)}` ? (
                                                <Link href={`/buyer/rfqs/${encodeURIComponent(auction.rfqId)}`}>
                                                    <Button size="sm" variant="secondary">Open RFQ</Button>
                                                </Link>
                                            ) : null}
                                        </ActionBar>
                                    </div>
                                ))}
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
