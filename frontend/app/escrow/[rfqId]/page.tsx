'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { TxStatusView } from '@/components/TxStatus';
import { useToast } from '@/components/Toast';
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
    StatusChip,
    TextInput,
    TokenChip,
} from '@/components/protocol/ProtocolPrimitives';
import { useWallet } from '@/contexts/WalletContext';
import { authenticatedJson, ApiError } from '@/lib/authFetch';
import { fetchCurrentBlockHeight } from '@/lib/sepoliaClient';
import { confirmTransferVerificationFromReceipt } from '@/lib/fhenixWorkflow';
import { CONTRACT_ADDRESSES, formatAmount, formatBlockTime, TIMING } from '@/lib/sealProtocol';
import { truncateMiddle } from '@/lib/utils';
import { walletFirstTx } from '@/lib/walletTx';

type RfqSettlement = {
    id: string;
    creator: string;
    tokenType: number;
    status: string;
    statusCode: number;
    winnerAddress: string;
    winnerAccepted: boolean;
    paid: boolean;
    finalPaymentReleased: boolean;
    lifecycleBlock: number;
    winningBidAmount: string;
    invoiceReceipt: string;
    feeBps: number;
    escrow: {
        originalAmount: string;
        currentAmount: string;
        totalReleased: string;
    };
};

type LinkedInvoice = {
    invoiceId: string;
    payer: string;
    payee: string;
    token: string;
    amount: string;
    statusCode: number;
    status: string;
    createdAt: number;
    paidAt: number;
    descriptionHash: string;
    receiptId: string;
    receipt: {
        receiptId: string;
        invoiceId: string;
        payer: string;
        payee: string;
        token: string;
        amount: string;
        timestamp: number;
        txHash: string;
    } | null;
};

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const ZERO_BYTES32 = '0x' + '0'.repeat(64);

function formatRawAmount(amount: string | bigint | null | undefined, tokenType: number) {
    return formatAmount(amount, tokenType, 0);
}

export default function EscrowDetailPage({ params }: { params: { rfqId: string } }) {
    const { walletAddress } = useWallet();
    const toast = useToast();
    const [rfq, setRfq] = useState<RfqSettlement | null>(null);
    const [linkedInvoices, setLinkedInvoices] = useState<LinkedInvoice[]>([]);
    const [currentBlock, setCurrentBlock] = useState<number | null>(null);
    const [releasePercentage, setReleasePercentage] = useState('25');
    const [txKey, setTxKey] = useState<string | null>(null);
    const [txHash, setTxHash] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [acting, setActing] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const loadSettlement = async (quiet = false) => {
        if (!quiet) {
            setLoading(true);
        }

        try {
            const [rfqData, invoiceData, blockHeight] = await Promise.all([
                authenticatedJson<RfqSettlement>(`/api/fhenix/rfq/${encodeURIComponent(params.rfqId)}`),
                authenticatedJson<LinkedInvoice[]>(`/api/fhenix/rfq/${encodeURIComponent(params.rfqId)}/invoices`).catch((caught) => {
                    if (caught instanceof ApiError && caught.status === 404) {
                        return [];
                    }
                    throw caught;
                }),
                fetchCurrentBlockHeight(),
            ]);

            setRfq(rfqData);
            setLinkedInvoices(Array.isArray(invoiceData) ? invoiceData : []);
            setCurrentBlock(blockHeight);
        } catch (caught: any) {
            setError(caught?.message || 'Failed to load escrow settlement.');
        } finally {
            if (!quiet) {
                setLoading(false);
            }
        }
    };

    useEffect(() => {
        let cancelled = false;

        const load = async () => {
            if (cancelled) return;
            await loadSettlement(cancelled);
        };

        void load();
        const intervalId = window.setInterval(() => {
            if (!cancelled) {
                void loadSettlement(true);
            }
        }, 15000);

        return () => {
            cancelled = true;
            window.clearInterval(intervalId);
        };
    }, [params.rfqId]);

    const runTransferManagedAction = async (
        endpoint: string,
        prepareBody: Record<string, any>,
        buildSubmitBody: (txHash: string) => Record<string, any>,
        pendingMessage: string,
        confirmedMessage: string,
    ) => {
        if (!rfq || acting) return;

        setActing(true);
        setError(null);
        try {
            const result = await walletFirstTx(
                endpoint,
                prepareBody,
                (_prepareData, confirmedTxHash) => buildSubmitBody(confirmedTxHash),
            );

            if (!result.receipt) {
                throw new Error(`${pendingMessage} was mined, but no receipt was available for transfer verification.`);
            }

            const confirmation = await confirmTransferVerificationFromReceipt(
                `/api/fhenix/rfq/${encodeURIComponent(rfq.id)}/confirm-transfer`,
                result.receipt,
                CONTRACT_ADDRESSES.rfq,
            );

            setTxKey(confirmation.idempotencyKey || result.idempotencyKey || null);
            setTxHash(confirmation.txHash || result.txHash || null);
            toast.success(confirmedMessage);
            await loadSettlement(true);
        } catch (caught: any) {
            const message = caught?.message || pendingMessage;
            setError(message);
            toast.error(message);
        } finally {
            setActing(false);
        }
    };

    const releasePartial = async () => {
        const percentage = Number(releasePercentage);
        if (!Number.isInteger(percentage) || percentage < 1 || percentage > 100) {
            setError('Release percentage must be an integer between 1 and 100.');
            return;
        }

        await runTransferManagedAction(
            `/api/fhenix/rfq/${encodeURIComponent(params.rfqId)}/release`,
            { percentage },
            (confirmedTxHash) => ({ percentage, txHash: confirmedTxHash }),
            'Failed to release escrow payment.',
            'Escrow release was confirmed on-chain.',
        );
    };

    const creatorReclaim = async () => {
        await runTransferManagedAction(
            `/api/fhenix/rfq/${encodeURIComponent(params.rfqId)}/creator-reclaim`,
            {},
            (confirmedTxHash) => ({ txHash: confirmedTxHash }),
            'Failed to reclaim escrow back to the creator.',
            'Creator reclaim was confirmed on-chain.',
        );
    };

    const winnerClaim = async () => {
        await runTransferManagedAction(
            `/api/fhenix/rfq/${encodeURIComponent(params.rfqId)}/winner-claim`,
            {},
            (confirmedTxHash) => ({ txHash: confirmedTxHash }),
            'Failed to release escrow to the winner.',
            'Winner escrow claim was confirmed on-chain.',
        );
    };

    const settlementSummary = useMemo(() => {
        if (!rfq) {
            return null;
        }

        const currentAmount = BigInt(rfq.escrow.currentAmount);
        const winningAmount = BigInt(rfq.winningBidAmount || '0');
        const releasePercent = Number(releasePercentage);
        const validPercentage = Number.isInteger(releasePercent) && releasePercent >= 1 && releasePercent <= 100;
        const grossRelease = validPercentage ? (currentAmount * BigInt(releasePercent)) / 100n : 0n;
        const fee = validPercentage ? (grossRelease * BigInt(rfq.feeBps)) / 10_000n : 0n;
        const winnerNet = grossRelease - fee;
        const timeoutBlock = rfq.lifecycleBlock > 0 ? rfq.lifecycleBlock + TIMING.ESCROW_TIMEOUT_BLOCKS : null;
        const blocksUntilTimeout =
            timeoutBlock !== null && currentBlock !== null ? Math.max(timeoutBlock - currentBlock, 0) : null;

        return {
            currentAmount,
            winningAmount,
            validPercentage,
            grossRelease,
            fee,
            winnerNet,
            timeoutBlock,
            blocksUntilTimeout,
        };
    }, [currentBlock, releasePercentage, rfq]);

    if (loading) {
        return (
            <PageShell>
                <Panel title="Loading settlement">
                    <div className="text-sm text-[hsl(var(--muted-foreground))]">
                        Fetching live Sepolia escrow balances, linked invoice state, and timeout windows.
                    </div>
                </Panel>
            </PageShell>
        );
    }

    if (!rfq || !settlementSummary) {
        return (
            <PageShell>
                <Notice tone="danger">{error || 'Escrow settlement not found.'}</Notice>
            </PageShell>
        );
    }

    const isCreator = Boolean(walletAddress && walletAddress.toLowerCase() === rfq.creator.toLowerCase());
    const hasWinner = rfq.winnerAddress && rfq.winnerAddress !== ZERO_ADDRESS;
    const isWinner = Boolean(walletAddress && hasWinner && walletAddress.toLowerCase() === rfq.winnerAddress.toLowerCase());
    const settlementActive = rfq.status === 'ESCROW_FUNDED' || rfq.status === 'COMPLETED' || rfq.status === 'CANCELLED';
    const timeoutReached = settlementSummary.timeoutBlock !== null && currentBlock !== null
        ? currentBlock > settlementSummary.timeoutBlock
        : false;
    const canRelease =
        isCreator &&
        rfq.status === 'ESCROW_FUNDED' &&
        !rfq.paid &&
        !rfq.finalPaymentReleased &&
        settlementSummary.currentAmount > 0n;
    const canCreatorReclaim =
        isCreator &&
        rfq.status === 'ESCROW_FUNDED' &&
        !rfq.paid &&
        !rfq.finalPaymentReleased &&
        settlementSummary.currentAmount > 0n &&
        timeoutReached;
    const canWinnerClaim =
        isWinner &&
        rfq.status === 'ESCROW_FUNDED' &&
        !rfq.paid &&
        !rfq.finalPaymentReleased &&
        settlementSummary.currentAmount > 0n &&
        timeoutReached;
    const receiptRecorded = rfq.invoiceReceipt && rfq.invoiceReceipt !== ZERO_BYTES32;

    return (
        <PageShell className="space-y-6">
            <PageHeader
                eyebrow="Settlement"
                title={`Escrow for ${rfq.id}`}
                description="Manage the live Sepolia RFQ settlement: release escrow publicly, wait out timeout windows, and inspect any linked invoice state."
                actions={
                    <ActionBar>
                        <StatusChip status={rfq.status} />
                        <TokenChip tokenType={rfq.tokenType} />
                    </ActionBar>
                }
            />

            {error ? <Notice tone="danger">{error}</Notice> : null}
            {!settlementActive ? (
                <Notice tone="warning" title="Escrow is not active yet">
                    This RFQ is currently in <strong>{rfq.status}</strong>. Escrow actions only become available after funding, or after the settlement has already completed.
                </Notice>
            ) : null}
            {rfq.paid ? (
                <Notice tone="warning" title="Linked invoice payment recorded">
                    The current Sepolia RFQ deployment records invoice payment on-chain, but it does not expose a separate bond-recovery function after <code>paid = true</code>.
                    This workspace keeps linked invoice state read-only to avoid presenting a misleading recovery flow.
                </Notice>
            ) : null}

            <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
                <div className="space-y-6">
                    <Panel title="Settlement summary">
                        <DataGrid columns={2}>
                            <DataPoint label="RFQ id" value={<CopyableText value={rfq.id} displayValue={truncateMiddle(rfq.id, 16, 10)} />} />
                            <DataPoint label="Creator" value={<CopyableText value={rfq.creator} displayValue={truncateMiddle(rfq.creator, 14, 10)} />} />
                            <DataPoint
                                label="Winner"
                                value={
                                    hasWinner
                                        ? <CopyableText value={rfq.winnerAddress} displayValue={truncateMiddle(rfq.winnerAddress, 14, 10)} />
                                        : '--'
                                }
                            />
                            <DataPoint label="Winner accepted" value={rfq.winnerAccepted ? 'Yes' : 'No'} />
                            <DataPoint label="Winning amount" value={formatRawAmount(rfq.winningBidAmount, rfq.tokenType)} />
                            <DataPoint label="Fee" value={`${rfq.feeBps} bps`} />
                            <DataPoint label="Original escrow" value={formatRawAmount(rfq.escrow.originalAmount, rfq.tokenType)} />
                            <DataPoint label="Current escrow" value={formatRawAmount(rfq.escrow.currentAmount, rfq.tokenType)} />
                            <DataPoint label="Total released" value={formatRawAmount(rfq.escrow.totalReleased, rfq.tokenType)} />
                            <DataPoint label="Current block" value={currentBlock ?? '--'} />
                            <DataPoint
                                label="Timeout block"
                                value={settlementSummary.timeoutBlock ?? '--'}
                                subtle={
                                    settlementSummary.blocksUntilTimeout !== null
                                        ? settlementSummary.blocksUntilTimeout > 0
                                            ? `${settlementSummary.blocksUntilTimeout} blocks remaining (${formatBlockTime(settlementSummary.blocksUntilTimeout)})`
                                            : 'Timeout window is open'
                                        : 'Waiting for lifecycle data'
                                }
                            />
                            <DataPoint label="Recorded invoice receipt" value={receiptRecorded ? <CopyableText value={rfq.invoiceReceipt} displayValue={truncateMiddle(rfq.invoiceReceipt, 16, 10)} /> : 'None'} />
                        </DataGrid>
                    </Panel>

                    <Panel title="Public escrow path">
                        <div className="space-y-4">
                            <div className="text-sm text-white/55">
                                Release escrow directly to the selected vendor. The RFQ contract computes the released amount from the current escrow balance and this percentage.
                            </div>
                            <Field label="Release percentage" hint="Use an integer between 1 and 100.">
                                <TextInput
                                    value={releasePercentage}
                                    onChange={(event) => setReleasePercentage(event.target.value)}
                                    placeholder="25"
                                />
                            </Field>
                            <DataGrid columns={3}>
                                <DataPoint
                                    label="Gross release"
                                    value={
                                        settlementSummary.validPercentage
                                            ? formatRawAmount(settlementSummary.grossRelease, rfq.tokenType)
                                            : '--'
                                    }
                                />
                                <DataPoint
                                    label="Protocol fee"
                                    value={
                                        settlementSummary.validPercentage
                                            ? formatRawAmount(settlementSummary.fee, rfq.tokenType)
                                            : '--'
                                    }
                                />
                                <DataPoint
                                    label="Winner receives"
                                    value={
                                        settlementSummary.validPercentage
                                            ? formatRawAmount(settlementSummary.winnerNet, rfq.tokenType)
                                            : '--'
                                    }
                                />
                            </DataGrid>
                            <ActionBar>
                                <Button onClick={releasePartial} isLoading={acting} disabled={!canRelease}>
                                    Release escrow
                                </Button>
                                <Link href={`/buyer/rfqs/${encodeURIComponent(rfq.id)}`}>
                                    <Button variant="secondary">Back to RFQ</Button>
                                </Link>
                            </ActionBar>
                            <div className="text-sm text-white/55">
                                {!isCreator
                                    ? 'Only the RFQ creator can release escrow.'
                                    : rfq.paid
                                      ? 'Invoice settlement was recorded, so public releases are disabled.'
                                      : rfq.finalPaymentReleased
                                        ? 'The final payment has already been released.'
                                        : rfq.status !== 'ESCROW_FUNDED'
                                          ? 'Escrow must be funded before releases are available.'
                                          : 'Each release requires a second on-chain transfer verification confirmation.'}
                            </div>
                        </div>
                    </Panel>

                    <Panel title="Linked invoice state">
                        <div className="space-y-4">
                            <Notice tone="neutral" title="Read-only in this workspace">
                                Linked invoice state is shown here for auditing. This Sepolia deployment does not provide a safe RFQ bond-recovery path after invoice payment, so invoice actions are intentionally not exposed from the escrow workspace.
                            </Notice>
                            {linkedInvoices.length === 0 ? (
                                <div className="text-sm text-white/60">
                                    No linked invoices are currently recorded for this RFQ.
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    {linkedInvoices.map((invoice) => (
                                        <div key={invoice.invoiceId} className="rounded-xl border border-white/12 bg-white/[0.05] p-4">
                                            <div className="flex flex-wrap items-center justify-between gap-3">
                                                <div className="text-sm font-semibold text-white">{invoice.status}</div>
                                                <div className="text-sm text-white/55">{formatRawAmount(invoice.amount, rfq.tokenType)}</div>
                                            </div>
                                            <DataGrid columns={2}>
                                                <DataPoint label="Invoice id" value={<CopyableText value={invoice.invoiceId} displayValue={truncateMiddle(invoice.invoiceId, 16, 10)} />} />
                                                <DataPoint label="Receipt id" value={invoice.receiptId !== ZERO_BYTES32 ? <CopyableText value={invoice.receiptId} displayValue={truncateMiddle(invoice.receiptId, 16, 10)} /> : 'Pending'} />
                                                <DataPoint label="Payer" value={<CopyableText value={invoice.payer} displayValue={truncateMiddle(invoice.payer, 14, 10)} />} />
                                                <DataPoint label="Payee" value={<CopyableText value={invoice.payee} displayValue={truncateMiddle(invoice.payee, 14, 10)} />} />
                                                <DataPoint label="Created" value={invoice.createdAt ? new Date(invoice.createdAt * 1000).toLocaleString() : '--'} />
                                                <DataPoint label="Paid at" value={invoice.paidAt ? new Date(invoice.paidAt * 1000).toLocaleString() : '--'} />
                                            </DataGrid>
                                            {invoice.receipt ? (
                                                <div className="mt-3 rounded-xl border border-white/10 bg-black/15 p-3">
                                                    <DataGrid columns={2}>
                                                        <DataPoint label="Receipt tx" value={<CopyableText value={invoice.receipt.txHash} displayValue={truncateMiddle(invoice.receipt.txHash, 18, 12)} />} />
                                                        <DataPoint label="Receipt amount" value={formatRawAmount(invoice.receipt.amount, rfq.tokenType)} />
                                                    </DataGrid>
                                                </div>
                                            ) : null}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </Panel>
                </div>

                <div className="space-y-6">
                    <Panel title="Timeout actions">
                        <InfoList>
                            <InfoRow label="Status" value={rfq.status} />
                            <InfoRow label="Creator reclaim ready" value={canCreatorReclaim ? 'Yes' : 'No'} />
                            <InfoRow label="Winner claim ready" value={canWinnerClaim ? 'Yes' : 'No'} />
                            <InfoRow label="Invoice paid flag" value={rfq.paid ? 'Yes' : 'No'} />
                            <InfoRow label="Final payment released" value={rfq.finalPaymentReleased ? 'Yes' : 'No'} />
                        </InfoList>
                        <ActionBar className="mt-4">
                            <Button variant="secondary" onClick={creatorReclaim} isLoading={acting} disabled={!canCreatorReclaim}>
                                Creator reclaim
                            </Button>
                            <Button onClick={winnerClaim} isLoading={acting} disabled={!canWinnerClaim}>
                                Winner claim
                            </Button>
                        </ActionBar>
                        <div className="mt-3 text-sm text-white/55">
                            {rfq.paid
                                ? 'Timeout claims are disabled once invoice payment is recorded on the RFQ.'
                                : !timeoutReached
                                  ? 'Timeout claims only open after the escrow timeout block.'
                                  : 'Both claim paths also require transfer verification after the payout transaction is mined.'}
                        </div>
                    </Panel>

                    <Panel title="Navigation">
                        <ActionBar>
                            <Link href={`/buyer/rfqs/${encodeURIComponent(rfq.id)}`}>
                                <Button variant="secondary">Buyer RFQ view</Button>
                            </Link>
                            {hasWinner ? (
                                <Link href="/vendor/my-bids">
                                    <Button variant="secondary">Vendor workspace</Button>
                                </Link>
                            ) : null}
                        </ActionBar>
                    </Panel>

                    {txKey || txHash ? (
                        <Panel title="Latest transaction">
                            {txKey ? <TxStatusView idempotencyKey={txKey} compact={true} onConfirmed={() => void loadSettlement(true)} /> : null}
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
