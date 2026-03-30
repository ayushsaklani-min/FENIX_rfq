'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { TxStatusView } from '@/components/TxStatus';
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
    SelectInput,
    TextAreaInput,
    TextInput,
    TokenChip,
} from '@/components/protocol/ProtocolPrimitives';
import { useWallet } from '@/contexts/WalletContext';
import { fetchCurrentBlockHeight } from '@/lib/sepoliaClient';
import {
    createRfqSchema,
    formatAmount,
    formatBlockTime,
    hashToField,
    pricingLabel,
    PRICING_MODE,
    randomField,
    TIMING,
    TOKEN_TYPE,
    tokenLabel,
} from '@/lib/sealProtocol';
import { truncateMiddle } from '@/lib/utils';
import { normalizeWalletErrorMessage } from '@/lib/walletErrorMessage';
import { walletFirstTx } from '@/lib/walletTx';
import { useProtocolStore } from '@/stores/protocolStore';

type PlatformPayload = {
    initialized: boolean;
    paused: boolean;
    isAdmin: boolean;
    feeBps: number;
};

type ValidationIssue = {
    path?: PropertyKey[];
    message?: string;
};

function toMicroUnits(value: string): string | null {
    const normalized = value.trim();
    if (!/^\d+$/.test(normalized)) return null;
    if (BigInt(normalized) <= 0n) return null;
    return normalized;
}

function formatCreateRfqValidationError(issues: ValidationIssue[] | undefined) {
    const issue = issues?.[0];
    if (!issue) return 'Check the RFQ form values and try again.';

    const field = String(issue.path?.[0] ?? '');

    if (field === 'minBidCount') {
        return 'Minimum vendor count must be at least 1.';
    }
    if (field === 'minBid') {
        return 'Enter a valid minimum bid amount.';
    }
    if (field === 'biddingDeadline') {
        return 'Bidding window must end after the current block.';
    }
    if (field === 'revealDeadline') {
        if (!issue.message) return 'Reveal window is invalid.';
        return issue.message.endsWith('.') ? issue.message : `${issue.message}.`;
    }
    if (field === 'tokenType') {
        return 'Choose a valid settlement token.';
    }
    if (field === 'pricingMode') {
        return 'Choose a valid price source.';
    }

    return issue.message || 'Check the RFQ form values and try again.';
}

// Duration options in blocks (~5 seconds per Sepolia block in this app's UX model)
const BID_DURATIONS = [
    { label: '30 minutes', blocks: 360 },
    { label: '1 hour', blocks: 720 },
    { label: '2 hours', blocks: 1440 },
    { label: '4 hours', blocks: 2880 },
    { label: '8 hours', blocks: 5760 },
    { label: '1 day', blocks: 17280 },
    { label: 'Custom (blocks)', blocks: 0 },
];

const REVEAL_DURATIONS = [
    { label: '1 hour', blocks: 720 },
    { label: '2 hours', blocks: 1440 },
    { label: '4 hours', blocks: 2880 },
    { label: '8 hours', blocks: 5760 },
    { label: '1 day', blocks: 17280 },
    { label: 'Custom (blocks)', blocks: 0 },
];

export default function CreateRfqPage() {
    const { walletAddress, role, switchRole, switchingRole } = useWallet();
    const saveRfqSalt = useProtocolStore((state) => state.saveRfqSalt);
    const setPlatformConfig = useProtocolStore((state) => state.setPlatformConfig);
    const [currentBlock, setCurrentBlock] = useState<number | null>(null);
    const [platform, setPlatform] = useState<PlatformPayload | null>(null);
    const [itemName, setItemName] = useState('');
    const [description, setDescription] = useState('');
    const [quantity, setQuantity] = useState('');
    const [unit, setUnit] = useState('');
    const [bidDurationBlocks, setBidDurationBlocks] = useState<number>(720); // 1 hour default
    const [revealDurationBlocks, setRevealDurationBlocks] = useState<number>(TIMING.MIN_REVEAL_WINDOW); // 720 blocks = 1 hour
    const [customBidBlocks, setCustomBidBlocks] = useState('720');
    const [customRevealBlocks, setCustomRevealBlocks] = useState(String(TIMING.MIN_REVEAL_WINDOW));
    const [minBid, setMinBid] = useState('');
    const [minBidCount, setMinBidCount] = useState('1');
    const [tokenType, setTokenType] = useState(String(TOKEN_TYPE.TOKEN1));
    const [pricingMode, setPricingMode] = useState(String(PRICING_MODE.RFQ));
    const [rfqId, setRfqId] = useState<string | null>(null);
    const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
    const [txHash, setTxHash] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            const [blockHeight, configResponse] = await Promise.all([
                fetchCurrentBlockHeight(),
                fetch('/api/platform/config', { cache: 'no-store' }).catch(() => null),
            ]);

            if (cancelled) return;

            if (blockHeight) setCurrentBlock(blockHeight);

            if (configResponse) {
                const payload = await configResponse.json().catch(() => null);
                if (configResponse.ok && payload?.data) {
                    setPlatform(payload.data);
                    setPlatformConfig(payload.data);
                }
            }
        };

        load();
        return () => { cancelled = true; };
    }, [setPlatformConfig]);

    const effectiveBidBlocks = bidDurationBlocks === 0 ? Number(customBidBlocks) || 0 : bidDurationBlocks;
    const effectiveRevealBlocks = revealDurationBlocks === 0 ? Number(customRevealBlocks) || 0 : revealDurationBlocks;
    const biddingDeadline = currentBlock ? currentBlock + effectiveBidBlocks : 0;
    const revealDeadline = biddingDeadline ? biddingDeadline + effectiveRevealBlocks : 0;
    const minBidMicro = toMicroUnits(minBid);

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
        if (submitting) return;

        setSubmitting(true);
        setError(null);

        try {
            if (!walletAddress) throw new Error('Connect your wallet first.');
            if (role === 'VENDOR') throw new Error('Switch to the buyer workspace before creating an RFQ.');
            if (!platform?.initialized) throw new Error('Platform config has not been initialized yet.');
            if (platform.paused) throw new Error('Platform is paused. New RFQs are blocked.');
            if (!itemName.trim()) throw new Error('Enter a short title for the RFQ.');

            const minBidValue = toMicroUnits(minBid);
            const minBidCountValue = Number(minBidCount);
            if (!minBidValue) throw new Error('Enter a valid minimum bid amount.');
            if (BigInt(minBidValue) < 10n) {
                throw new Error('Minimum bid must be at least 10 raw units so the RFQ stake is non-zero. For eSEAL with 4 decimals, 1.0000 eSEAL is 10000.');
            }
            if (!Number.isInteger(minBidCountValue) || minBidCountValue < 1) {
                throw new Error('Minimum vendor count must be at least 1.');
            }
            if (effectiveBidBlocks < 1) throw new Error('Bidding window must be at least 1 block.');
            if (effectiveRevealBlocks < 1) throw new Error('Reveal window must be at least 1 block.');

            const salt = randomField();
            const metadataHash = await hashToField([
                'RFQ_METADATA',
                itemName.trim(),
                description.trim(),
                quantity.trim(),
                unit.trim(),
            ]);
            const parsed = createRfqSchema.safeParse({
                salt,
                metadataHash,
                biddingDeadline,
                revealDeadline,
                minBid: minBidValue,
                minBidCount: minBidCountValue,
                tokenType: Number(tokenType),
                pricingMode: Number(pricingMode),
            });
            if (!parsed.success) {
                throw new Error(formatCreateRfqValidationError(parsed.error.issues));
            }

            const prepareBody = {
                salt: parsed.data.salt,
                metadataHash: parsed.data.metadataHash,
                biddingDeadline: parsed.data.biddingDeadline,
                revealDeadline: parsed.data.revealDeadline,
                minBid: parsed.data.minBid,
                minBidCount: String(parsed.data.minBidCount),
                tokenType: Number(tokenType),
                mode: Number(pricingMode),
                itemName: itemName.trim(),
                description: description.trim(),
                quantity: quantity.trim(),
                unit: unit.trim(),
            };

            const result = await walletFirstTx('/api/fhenix/rfq/create', prepareBody, (_prepareData, txHash) => ({
                ...prepareBody,
                txHash,
            }));

            saveRfqSalt(result.data.rfqId, salt);
            setRfqId(result.data.rfqId);
            setIdempotencyKey(result.idempotencyKey || null);
            setTxHash(result.txHash || null);
        } catch (caught: any) {
            const message = normalizeWalletErrorMessage(caught?.message || '', { context: 'execution' });
            setError(message || 'Failed to create RFQ.');
            setSubmitting(false);
        }
    };

    if (rfqId) {
        return (
            <PageShell className="space-y-6">
                <PageHeader
                    eyebrow="Buyer"
                    title="RFQ created"
                    description="Your RFQ is on-chain. Share the link with vendors so they can submit sealed bids."
                />
                <Panel title="Submission status">
                    <div className="space-y-4">
                        <DataGrid>
                            <DataPoint label="RFQ id" value={<CopyableText value={rfqId} displayValue={truncateMiddle(rfqId, 16, 10)} />} />
                            <DataPoint label="Settlement token" value={tokenLabel(Number(tokenType))} />
                        </DataGrid>
                        {txHash ? (
                            <DataGrid>
                                <DataPoint label="Transaction hash" value={<CopyableText value={txHash} displayValue={truncateMiddle(txHash, 18, 12)} />} />
                            </DataGrid>
                        ) : null}
                        {idempotencyKey ? <TxStatusView idempotencyKey={idempotencyKey} showHistory={true} /> : null}
                        <ActionBar>
                            <Link
                                href={`/buyer/rfqs/${encodeURIComponent(rfqId)}`}
                                className="inline-flex rounded-lg bg-[hsl(var(--primary))] px-4 py-2 text-sm font-medium text-[hsl(var(--primary-foreground))]"
                            >
                                Open RFQ
                            </Link>
                            <Link
                                href="/buyer/create-rfq"
                                className="inline-flex rounded-lg border border-white/15 bg-white/[0.06] px-4 py-2 text-sm font-medium text-white transition hover:bg-white/[0.12]"
                            >
                                Create another
                            </Link>
                        </ActionBar>
                    </div>
                </Panel>
            </PageShell>
        );
    }

    return (
        <PageShell className="space-y-6">
            <PageHeader
                eyebrow="Buyer"
                title="Create RFQ"
                description="Set the item details, how long vendors have to bid, and the settlement token."
                actions={
                    <ActionBar>
                        <TokenChip tokenType={Number(tokenType)} />
                        <PricingChip pricingMode={Number(pricingMode)} />
                    </ActionBar>
                }
            />

            {platform?.initialized === false ? (
                <Notice tone="warning" title="Platform setup required">
                    The admin must initialize the platform before RFQs can be created.
                </Notice>
            ) : null}

            {role === 'VENDOR' ? (
                <Notice tone="warning" title="Buyer workspace required">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <span>You're currently in the seller workspace. Switch to buyer to create RFQs.</span>
                        <Button
                            type="button"
                            size="sm"
                            isLoading={switchingRole}
                            onClick={async () => {
                                const switched = await switchRole('BUYER');
                                if (!switched) {
                                    setError('Role switch failed. Reconnect and try again.');
                                }
                            }}
                        >
                            Switch to Buyer
                        </Button>
                    </div>
                </Notice>
            ) : null}

            {platform?.paused ? (
                <Notice tone="warning" title="Platform paused">
                    RFQ creation is temporarily disabled.
                </Notice>
            ) : null}

            {error ? <Notice tone="danger">{error}</Notice> : null}

            <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
                <Panel title="RFQ details">
                    <form className="space-y-6" onSubmit={handleSubmit}>
                        <div className="space-y-4">
                            <Field label="What are you buying?">
                                <TextInput value={itemName} onChange={(event) => setItemName(event.target.value)} placeholder="Industrial pump assembly" />
                            </Field>
                            <Field label="Description" hint="Specs, delivery notes, and compliance requirements.">
                                <TextAreaInput value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Scope, specifications, delivery terms, inspection requirements." />
                            </Field>
                            <div className="grid gap-4 md:grid-cols-2">
                                <Field label="Quantity">
                                    <TextInput value={quantity} onChange={(event) => setQuantity(event.target.value)} placeholder="100" />
                                </Field>
                                <Field label="Unit">
                                    <TextInput value={unit} onChange={(event) => setUnit(event.target.value)} placeholder="units, kg, cases" />
                                </Field>
                            </div>
                        </div>

                        <div className="grid gap-4 md:grid-cols-2">
                            <Field label="Minimum acceptable bid" hint="Enter the raw token amount. The value must be at least 10. With eSEAL 4 decimals, 1.0000 eSEAL = 10000.">
                                <TextInput type="text" inputMode="numeric" value={minBid} onChange={(event) => setMinBid(event.target.value)} placeholder="10000" />
                            </Field>
                            <Field label="Minimum vendor count" hint="RFQ can be cancelled if fewer vendors bid.">
                                <TextInput type="number" min="1" step="1" value={minBidCount} onChange={(event) => setMinBidCount(event.target.value)} />
                            </Field>
                        </div>

                        <div className="grid gap-4 md:grid-cols-2">
                            <Field
                                label="Bidding window"
                                hint={biddingDeadline > 0 ? `Closes at block ${biddingDeadline}` : 'How long vendors have to submit sealed bids'}
                            >
                                <SelectInput
                                    value={bidDurationBlocks}
                                    onChange={(e) => setBidDurationBlocks(Number(e.target.value))}
                                >
                                    {BID_DURATIONS.map((opt) => (
                                        <option key={opt.label} value={opt.blocks}>{opt.label}</option>
                                    ))}
                                </SelectInput>
                                {bidDurationBlocks === 0 && (
                                    <TextInput
                                        className="mt-2"
                                        type="number"
                                        min="1"
                                        value={customBidBlocks}
                                        onChange={(e) => setCustomBidBlocks(e.target.value)}
                                        placeholder="e.g. 720"
                                    />
                                )}
                            </Field>
                            <Field
                                label="Reveal window"
                                hint={revealDeadline > 0 ? `Closes at block ${revealDeadline}` : `Minimum ${formatBlockTime(TIMING.MIN_REVEAL_WINDOW)} for vendors to reveal`}
                            >
                                <SelectInput
                                    value={revealDurationBlocks}
                                    onChange={(e) => setRevealDurationBlocks(Number(e.target.value))}
                                >
                                    {REVEAL_DURATIONS.map((opt) => (
                                        <option key={opt.label} value={opt.blocks}>{opt.label}</option>
                                    ))}
                                </SelectInput>
                                {revealDurationBlocks === 0 && (
                                    <TextInput
                                        className="mt-2"
                                        type="number"
                                        min="1"
                                        value={customRevealBlocks}
                                        onChange={(e) => setCustomRevealBlocks(e.target.value)}
                                        placeholder={String(TIMING.MIN_REVEAL_WINDOW)}
                                    />
                                )}
                            </Field>
                        </div>

                        <div className="grid gap-4 md:grid-cols-2">
                            <Field label="Settlement token" hint="Bids, stake, and escrow settle in the selected FHERC20 token on Sepolia.">
                                <SelectInput value={tokenType} onChange={(event) => setTokenType(event.target.value)}>
                                    <option value={TOKEN_TYPE.TOKEN1}>FHERC20-1</option>
                                    <option value={TOKEN_TYPE.TOKEN2}>FHERC20-2</option>
                                </SelectInput>
                            </Field>
                            <Field label="Price source" hint="Choose whether the RFQ runs its own sealed flow or imports an auction result.">
                                <SelectInput value={pricingMode} onChange={(event) => setPricingMode(event.target.value)}>
                                    <option value={PRICING_MODE.RFQ}>RFQ sealed bids</option>
                                    <option value={PRICING_MODE.VICKREY}>Import Vickrey result</option>
                                    <option value={PRICING_MODE.DUTCH}>Import Dutch result</option>
                                </SelectInput>
                            </Field>
                        </div>

                        <Button type="submit" size="lg" isLoading={submitting} disabled={role === 'VENDOR' || switchingRole || platform?.paused || platform?.initialized === false || !currentBlock}>
                            Create RFQ
                        </Button>
                    </form>
                </Panel>

                <div className="space-y-6">
                    <Panel title="Timeline preview">
                        <DataGrid columns={2}>
                            <DataPoint label="Current block" value={currentBlock ?? 'Loading...'} />
                            <DataPoint label="Minimum bid" value={minBidMicro ? formatAmount(minBidMicro, Number(tokenType)) : '--'} />
                            <DataPoint
                                label="Bidding closes"
                                value={effectiveBidBlocks > 0 ? `~${formatBlockTime(effectiveBidBlocks)} from now` : '--'}
                                subtle={biddingDeadline > 0 ? `block ${biddingDeadline}` : undefined}
                            />
                            <DataPoint
                                label="Reveal closes"
                                value={effectiveRevealBlocks > 0 ? `~${formatBlockTime(effectiveRevealBlocks)} after bidding` : '--'}
                                subtle={revealDeadline > 0 ? `block ${revealDeadline}` : undefined}
                            />
                            <DataPoint label="Pricing mode" value={pricingLabel(Number(pricingMode))} />
                            <DataPoint label="Platform fee" value={`${platform?.feeBps ?? 0} bps`} />
                        </DataGrid>
                    </Panel>

                    <Panel title="What happens next">
                        <div className="space-y-2 text-sm text-[hsl(var(--muted-foreground))]">
                            <div>Vendors submit encrypted bids during the bidding window. Bid values stay encrypted on-chain.</div>
                            <div>After bidding closes, the buyer publishes the lowest bid proof and then selects the winner.</div>
                            <div>
                                {Number(pricingMode) === PRICING_MODE.RFQ
                                    ? 'This RFQ uses its own sealed-bid flow.'
                                    : `This RFQ will import a finalized ${pricingLabel(Number(pricingMode))} auction result.`}
                            </div>
                        </div>
                    </Panel>
                </div>
            </div>
        </PageShell>
    );
}
