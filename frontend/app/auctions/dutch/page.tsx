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

function dutchStatusLabel(statusCode: number) {
    if (statusCode === 1) return 'ACTIVE';
    if (statusCode === 2) return 'COMMITTED';
    if (statusCode === 3) return 'CONFIRMED';
    if (statusCode === 4) return 'EXPIRED';
    if (statusCode === 5) return 'CANCELLED';
    return 'UNKNOWN';
}

export default function DutchAuctionsPage() {
    const searchParams = useSearchParams();
    const linkedRfqId = searchParams.get('rfqId')?.trim() ?? '';
    const { walletAddress } = useWallet();
    const [savedAuctions, setSavedAuctions] = useState<SavedAuction[]>([]);
    const [currentBlock, setCurrentBlock] = useState<number | null>(null);
    const [rfqId, setRfqId] = useState(linkedRfqId);
    const [startPrice, setStartPrice] = useState('1000');
    const [reservePrice, setReservePrice] = useState('600');
    const [priceDecrement, setPriceDecrement] = useState('10');
    const [startDelayBlocks, setStartDelayBlocks] = useState('20');
    const [durationBlocks, setDurationBlocks] = useState('720');
    const [createdAuctionId, setCreatedAuctionId] = useState<string | null>(null);
    const [txKey, setTxKey] = useState<string | null>(null);
    const [txHash, setTxHash] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [acting, setActing] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const loadAuctions = async () => {
        const blockHeight = await fetchCurrentBlockHeight();
        const response = await authenticatedFetch('/api/fhenix/auction/dutch/my');
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload?.status !== 'success') {
            throw new Error(payload?.error?.message || 'Failed to load indexed Dutch auctions.');
        }
        const fetched = Array.isArray(payload?.data) ? (payload.data as SavedAuction[]) : [];
        setCurrentBlock(blockHeight);
        setSavedAuctions(fetched);
    };

    const effectiveStartDelay = Number(startDelayBlocks || '0');
    const effectiveDuration = Number(durationBlocks || '0');
    const startBlock = currentBlock !== null && effectiveStartDelay > 0 ? currentBlock + effectiveStartDelay : null;
    const endBlock = startBlock !== null && effectiveDuration > 0 ? startBlock + effectiveDuration : null;

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
                    setError(caught?.message || 'Failed to load indexed Dutch auctions.');
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
            if (!/^\d+$/.test(startPrice) || BigInt(startPrice) <= 0n) {
                throw new Error('Start price must be a positive integer.');
            }
            if (!/^\d+$/.test(reservePrice) || BigInt(reservePrice) <= 0n) {
                throw new Error('Reserve price must be a positive integer.');
            }
            if (BigInt(startPrice) <= BigInt(reservePrice)) {
                throw new Error('Start price must be greater than reserve price.');
            }
            if (!/^\d+$/.test(priceDecrement) || BigInt(priceDecrement) <= 0n) {
                throw new Error('Price decrement must be a positive integer.');
            }
            if (effectiveStartDelay <= 0 || effectiveDuration <= 0) {
                throw new Error('Start delay and duration must both be positive block counts.');
            }

            const salt = randomField();
            const body = {
                salt,
                rfqId: rfqId.trim() || undefined,
                startPrice,
                reservePrice,
                priceDecrement,
                startBlock: currentBlock + effectiveStartDelay,
                endBlock: currentBlock + effectiveStartDelay + effectiveDuration,
            };

            const result = await walletFirstTx(
                '/api/fhenix/auction/dutch/create',
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
            setError(caught?.message || 'Failed to create the Dutch auction.');
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
            description: 'Create the linked Dutch auction on Ethereum Sepolia with explicit price bounds and block windows.',
            state: createdAuctionId ? 'complete' : 'current',
        },
        {
            title: 'Vendor stakes and commits',
            description: 'A vendor either commits an acceptance then confirms it, or uses the direct accept-price path with FHERC20 stake verification.',
            state: createdAuctionId ? 'current' : 'upcoming',
        },
        {
            title: 'Finalize the live price outcome',
            description: 'Once confirmed, the auction stores the winner and final accepted price on-chain.',
            state: 'upcoming',
        },
        {
            title: 'Import into RFQ',
            description: 'Return the Dutch result to the linked RFQ so winner response and escrow funding can continue.',
            state: 'upcoming',
        },
    ];

    return (
        <PageShell className="space-y-6">
            <PageHeader
                eyebrow="Auctions"
                title="Dutch auctions"
                description="Create and reopen your indexed Sepolia Dutch auctions without relying on browser-local ids."
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
                    New Dutch auctions created here will stay linked to that RFQ.
                </Notice>
            ) : null}

            <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
                <Panel title="Create Dutch auction">
                    <div className="space-y-4">
                        <Field label="Linked RFQ id" hint="Optional. Keep it filled if this auction should import back into an RFQ.">
                            <TextInput value={rfqId} onChange={(event) => setRfqId(event.target.value)} placeholder="0x..." />
                        </Field>

                        <div className="grid gap-4 md:grid-cols-2">
                            <Field label="Start price" hint="The initial live price before the descending schedule begins.">
                                <TextInput value={startPrice} onChange={(event) => setStartPrice(event.target.value)} placeholder="1000" />
                            </Field>
                            <Field label="Reserve price" hint="The price floor once the descending schedule is exhausted.">
                                <TextInput value={reservePrice} onChange={(event) => setReservePrice(event.target.value)} placeholder="600" />
                            </Field>
                        </div>

                        <Field label="Price decrement per block" hint="How much the live price falls on each block between start and end.">
                            <TextInput value={priceDecrement} onChange={(event) => setPriceDecrement(event.target.value)} placeholder="10" />
                        </Field>

                        <div className="grid gap-4 md:grid-cols-2">
                            <Field label="Start delay (blocks)" hint={startBlock ? `Auction starts at block ${startBlock}` : 'Delay before price descent begins.'}>
                                <TextInput value={startDelayBlocks} onChange={(event) => setStartDelayBlocks(event.target.value)} placeholder="20" />
                            </Field>
                            <Field label="Duration (blocks)" hint={endBlock ? `Auction ends at block ${endBlock}` : 'Length of the active pricing window.'}>
                                <TextInput value={durationBlocks} onChange={(event) => setDurationBlocks(event.target.value)} placeholder="720" />
                            </Field>
                        </div>

                        <div className="rounded-xl border border-white/12 bg-white/[0.05] px-4 py-3 text-sm text-white/65">
                            {effectiveStartDelay > 0 ? <div>Start delay: {formatBlockTime(effectiveStartDelay)}</div> : null}
                            {effectiveDuration > 0 ? <div>Active duration: {formatBlockTime(effectiveDuration)}</div> : null}
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
                            <div className="text-sm text-white/60">Loading your indexed Dutch auctions.</div>
                        ) : savedAuctions.length === 0 ? (
                            <EmptyState
                                title="No indexed Dutch auctions"
                                description="Create a Dutch auction from this page or open one from an RFQ to add it to the shared indexed workspace."
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
                                                <div className="font-semibold text-white">{dutchStatusLabel(auction.statusCode)}</div>
                                                <div>Current price: {auction.currentPrice}</div>
                                                <div>Start block: {auction.startBlock}</div>
                                                <div>End block: {auction.endBlock}</div>
                                            </div>
                                        </div>

                                        <ActionBar className="mt-4">
                                            <Link href={`/auctions/dutch/${encodeURIComponent(auction.id)}`}>
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
