'use client';

import Link from 'next/link';
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
    PricingChip,
    StatusChip,
    TextInput,
    TokenChip,
} from '@/components/protocol/ProtocolPrimitives';
import { useWallet } from '@/contexts/WalletContext';
import { authenticatedFetch } from '@/lib/authFetch';
import { fetchCurrentBlockHeight, getPublicClient } from '@/lib/sepoliaClient';
import { encryptBidAmount } from '@/lib/cofheClient';
import { confirmTransferVerificationFromReceipt } from '@/lib/fhenixWorkflow';
import { CONTRACT_ADDRESSES, formatAmount, PRICING_MODE, pricingLabel } from '@/lib/sealProtocol';
import { safeGetItem, safeSetItem } from '@/lib/safeLocalStorage';
import { truncateMiddle } from '@/lib/utils';
import { walletFirstTx } from '@/lib/walletTx';

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
    metadataHash: string;
    tokenAddress: `0x${string}`;
};

type ExistingBid = {
    bidId: string;
    owner: string;
    encryptedAmountCtHash: string;
    stake: string;
    revealed: boolean;
    revealedAmount: string;
};

function toMicroUnits(value: string): string | null {
    const normalized = value.trim();
    if (!/^\d+$/.test(normalized)) return null;
    if (BigInt(normalized) <= 0n) return null;
    return normalized;
}

export default function VendorBidPage({ params }: { params: { rfqId: string } }) {
    const { walletAddress, sessionHydrating } = useWallet();
    const [rfq, setRfq] = useState<RfqDetail | null>(null);
    const [existingBid, setExistingBid] = useState<ExistingBid | null>(null);
    const [currentBlock, setCurrentBlock] = useState<number | null>(null);
    const [bidAmount, setBidAmount] = useState('');
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);
    const [txHash, setTxHash] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;

        if (sessionHydrating) {
            return () => {
                cancelled = true;
            };
        }

        const load = async () => {
            try {
                const [rfqResponse, bidsResponse, blockHeight] = await Promise.all([
                    authenticatedFetch(`/api/fhenix/rfq/${params.rfqId}`),
                    authenticatedFetch(`/api/fhenix/rfq/${params.rfqId}/bids`),
                    fetchCurrentBlockHeight(),
                ]);

                const rfqPayload = await rfqResponse.json();
                const bidsPayload = await bidsResponse.json().catch(() => ({ data: [] }));

                if (!rfqResponse.ok) {
                    throw new Error(rfqPayload?.error?.message || 'Failed to load RFQ.');
                }

                const bids = Array.isArray(bidsPayload?.data) ? bidsPayload.data : [];
                const matchedBid =
                    walletAddress
                        ? bids.find((bid: ExistingBid) => bid.owner?.toLowerCase() === walletAddress.toLowerCase()) ?? null
                        : null;

                if (!cancelled) {
                    setRfq(rfqPayload.data);
                    setExistingBid(matchedBid);
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
        return () => {
            cancelled = true;
        };
    }, [params.rfqId, sessionHydrating, walletAddress]);

    const biddingOpen = useMemo(() => {
        return currentBlock !== null && rfq !== null && currentBlock < rfq.biddingDeadline;
    }, [currentBlock, rfq]);

    const handleSubmitBid = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!rfq || submitting) {
            return;
        }

        setSubmitting(true);
        setError(null);
        setSuccess(null);

        try {
            if (!walletAddress) {
                throw new Error('Connect your wallet before submitting an encrypted bid.');
            }
            if (rfq.mode !== PRICING_MODE.RFQ) {
                throw new Error(`This RFQ uses ${pricingLabel(rfq.mode)} pricing. Submit through the auction workspace instead.`);
            }
            if (rfq.statusCode !== 1) {
                throw new Error(`This RFQ is in ${rfq.status}. Bids can only be submitted during BIDDING.`);
            }
            if (!biddingOpen) {
                throw new Error('Bidding is closed for this RFQ.');
            }
            if (existingBid) {
                throw new Error('You already submitted an encrypted bid for this RFQ.');
            }

            const amountMicro = toMicroUnits(bidAmount);
            if (!amountMicro) {
                throw new Error('Enter a valid bid amount.');
            }
            if (BigInt(amountMicro) < BigInt(rfq.minBid)) {
                throw new Error(`Bid must be at least ${formatAmount(rfq.minBid, rfq.tokenType)}.`);
            }

            // Build a permit so the contract can atomically approve operator + submit bid
            // in a single tx via permitAndSubmitBid. MockFHERC20 (testnet) ignores v/r/s.
            const latestBlock = await getPublicClient().getBlock();
            const permit = {
                deadline: (Number(latestBlock.timestamp) + 3600).toString(),
                v: 0,
                r: '0x' + '0'.repeat(64),
                s: '0x' + '0'.repeat(64),
            };

            const encryptedBid = await encryptBidAmount(BigInt(amountMicro));
            const result = await walletFirstTx(
                `/api/fhenix/rfq/${encodeURIComponent(rfq.id)}/bids`,
                { encryptedBid, permit },
                (prepareData, confirmedTxHash) => ({
                    bidId: prepareData.bidId,
                    encryptedBid,
                    txHash: confirmedTxHash,
                }),
            );

            if (!result.receipt) {
                throw new Error('Bid transaction was mined, but no receipt was available for transfer verification.');
            }

            await confirmTransferVerificationFromReceipt(
                `/api/fhenix/rfq/${encodeURIComponent(rfq.id)}/confirm-transfer`,
                result.receipt,
                CONTRACT_ADDRESSES.rfq,
                { bidId: result.data.bidId },
            );

            const bundle = {
                bidId: result.data.bidId,
                rfqId: rfq.id,
                encryptedAmountCtHash: encryptedBid.ctHash,
                bidAmount: amountMicro,
                savedAt: new Date().toISOString(),
            };

            safeSetItem(`fhenix_bid_${result.data.bidId}`, JSON.stringify(bundle));
            safeSetItem(`fhenix_rfq_bid_${rfq.id}`, JSON.stringify(bundle));

            setExistingBid({
                bidId: result.data.bidId,
                owner: walletAddress,
                encryptedAmountCtHash: encryptedBid.ctHash,
                stake: rfq.flatStake,
                revealed: false,
                revealedAmount: '0',
            });
            setTxHash(result.txHash || null);
            setSuccess('Encrypted bid submitted and transfer verification confirmed on-chain.');
        } catch (caught: any) {
            setError(caught?.message || 'Failed to submit encrypted bid.');
        } finally {
            setSubmitting(false);
        }
    };

    if (loading || sessionHydrating) {
        return (
            <PageShell>
                <Panel title="Loading RFQ">
                    <div className="text-sm text-[hsl(var(--muted-foreground))]">Fetching the Sepolia RFQ state and syncing your wallet session.</div>
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

    const savedBundleRaw = safeGetItem(`fhenix_rfq_bid_${rfq.id}`);
    let savedBundle: { bidId: string; bidAmount: string } | null = null;
    if (savedBundleRaw) {
        try {
            savedBundle = JSON.parse(savedBundleRaw);
        } catch {
            savedBundle = null;
        }
    }

    return (
        <PageShell className="space-y-6">
            <PageHeader
                eyebrow="Vendor"
                title="Submit encrypted bid"
                description="Seal your price with CoFHE, sign the Sepolia transaction, and keep the bid package so you can share a winner proof later if your bid wins."
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
                    This RFQ uses {pricingLabel(rfq.mode)} pricing. Direct encrypted RFQ bids are disabled for that mode.
                </Notice>
            ) : null}

            {error ? <Notice tone="danger">{error}</Notice> : null}
            {success ? <Notice title="Bid submitted">{success}</Notice> : null}

            <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
                <div className="space-y-6">
                    <Panel title="RFQ summary">
                        <DataGrid columns={2}>
                            <DataPoint label="RFQ id" value={<CopyableText value={rfq.id} displayValue={truncateMiddle(rfq.id, 16, 10)} />} />
                            <DataPoint label="Buyer" value={<CopyableText value={rfq.creator} displayValue={truncateMiddle(rfq.creator, 14, 10)} />} />
                            <DataPoint label="Minimum bid" value={formatAmount(rfq.minBid, rfq.tokenType, 0)} />
                            <DataPoint label="Required stake" value={formatAmount(rfq.flatStake, rfq.tokenType, 0)} />
                            <DataPoint label="Minimum bidders" value={rfq.minBidCount} />
                            <DataPoint label="Current bids" value={rfq.bidCount} />
                            <DataPoint label="Stake token" value={<CopyableText value={rfq.tokenAddress} displayValue={truncateMiddle(rfq.tokenAddress, 12, 8)} />} />
                        </DataGrid>
                    </Panel>

                    <Panel title="Submit bid" subtitle="Your amount is encrypted locally in the browser before the contract call is prepared.">
                        <form className="space-y-4" onSubmit={handleSubmitBid}>
                            <Field label="Your price" hint={`Enter the raw uint64 amount. Must be at least ${formatAmount(rfq.minBid, rfq.tokenType, 0)}.`}>
                                <TextInput
                                    type="text"
                                    inputMode="numeric"
                                    value={bidAmount}
                                    onChange={(event) => setBidAmount(event.target.value)}
                                    placeholder="125000"
                                />
                            </Field>
                            <Button
                                type="submit"
                                isLoading={submitting}
                                disabled={sessionHydrating || rfq.mode !== PRICING_MODE.RFQ || !biddingOpen || Boolean(existingBid)}
                            >
                                Submit encrypted bid
                            </Button>
                        </form>
                    </Panel>
                </div>

                <div className="space-y-6">
                    <Panel title="Deadlines">
                        <div className="space-y-3">
                            <DeadlineCountdown deadlineBlock={rfq.biddingDeadline} label="Bid window" passedLabel="Bidding closed" />
                            <DeadlineCountdown deadlineBlock={rfq.revealDeadline} label="Buyer proof window" passedLabel="Reveal window closed" />
                        </div>
                        <div className="mt-4 text-sm text-white/55">
                            Buyer-side proof publication starts after bidding closes. Vendors do not reveal bid amounts directly on-chain in the direct RFQ flow.
                        </div>
                    </Panel>

                    {existingBid ? (
                        <Panel title="Your bid package">
                            <InfoList>
                                <InfoRow label="Bid id" value={<CopyableText value={existingBid.bidId} displayValue={truncateMiddle(existingBid.bidId, 14, 8)} />} />
                                <InfoRow
                                    label="Ciphertext handle"
                                    value={
                                        <CopyableText
                                            value={existingBid.encryptedAmountCtHash}
                                            displayValue={truncateMiddle(existingBid.encryptedAmountCtHash, 18, 10)}
                                            breakAll={true}
                                        />
                                    }
                                />
                                <InfoRow label="Stake locked" value={formatAmount(existingBid.stake, rfq.tokenType, 0)} />
                            </InfoList>
                            <ActionBar className="mt-4">
                                <Link href={`/vendor/reveal/${encodeURIComponent(existingBid.bidId)}?rfqId=${encodeURIComponent(rfq.id)}`}>
                                    <Button size="sm">Open winner proof page</Button>
                                </Link>
                            </ActionBar>
                        </Panel>
                    ) : null}

                    {savedBundle ? (
                        <Panel title="Browser backup">
                            <InfoList>
                                <InfoRow label="Bid id" value={<CopyableText value={savedBundle.bidId} displayValue={truncateMiddle(savedBundle.bidId, 14, 8)} />} />
                                <InfoRow label="Bid amount" value={formatAmount(savedBundle.bidAmount, rfq.tokenType, 0)} />
                            </InfoList>
                            <div className="mt-3 text-sm text-white/55">
                                This optional browser backup only helps reopen the proof page directly. The shared workspace reads the indexed bid from Sepolia first.
                            </div>
                        </Panel>
                    ) : null}

                    {txHash ? (
                        <Panel title="Latest transaction">
                            <InfoList>
                                <InfoRow label="Tx hash" value={<CopyableText value={txHash} displayValue={truncateMiddle(txHash, 18, 12)} />} />
                            </InfoList>
                        </Panel>
                    ) : null}
                </div>
            </div>
        </PageShell>
    );
}
