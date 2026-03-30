'use client';

import { useEffect, useRef, useState } from 'react';
import { CopyInlineButton } from '@/components/protocol/ProtocolPrimitives';
import { authenticatedFetch } from '@/lib/authFetch';
import { CheckCircle, Clock, XCircle, AlertTriangle } from 'lucide-react';

type TxStatus = 'PREPARED' | 'SUBMITTED' | 'CONFIRMED' | 'REJECTED' | 'EXPIRED';

interface TransactionStatus {
    id: string;
    idempotencyKey: string;
    canonicalTxKey: string;
    txHash?: string;
    transition: string;
    status: TxStatus;
    statusHistory: Array<{ status: TxStatus; timestamp: string }> | string;
    preparedAt: string;
    submittedAt?: string;
    confirmedAt?: string;
    rejectedAt?: string;
    expiredAt?: string;
    blockHeight?: number;
    blockHash?: string;
    error?: string;
    errorCode?: number;
    errorClass?: string;
    retryCount: number;
    maxRetries: number;
    canRetry: boolean;
}

interface TxStatusProps {
    idempotencyKey: string;
    canonicalTxKey?: string;
    onRetry?: () => Promise<void>;
    onResume?: () => Promise<void>;
    /** Called once when status first reaches CONFIRMED */
    onConfirmed?: () => void;
    showHistory?: boolean;
    compact?: boolean;
}

export function TxStatusView({
    idempotencyKey,
    onRetry,
    onResume,
    onConfirmed,
    showHistory = false,
    compact = false,
}: TxStatusProps) {
    const [tx, setTx] = useState<TransactionStatus | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [retrying, setRetrying] = useState(false);
    const firedRef = useRef(false);

    // Reset fired flag when key changes
    useEffect(() => { firedRef.current = false; }, [idempotencyKey]);

    useEffect(() => {
        let intervalId: NodeJS.Timeout | null = null;
        const fetchStatus = async () => {
            try {
                const response = await authenticatedFetch(`/api/tx/${idempotencyKey}`);
                const payload = await response.json();
                if (!response.ok) throw new Error(payload?.error?.message || 'Failed to fetch status');
                setTx(payload.data);
                setError(null);
                setLoading(false);
                if (['CONFIRMED', 'REJECTED', 'EXPIRED'].includes(payload.data.status)) {
                    if (intervalId) clearInterval(intervalId);
                    if (payload.data.status === 'CONFIRMED' && onConfirmed && !firedRef.current) {
                        firedRef.current = true;
                        onConfirmed();
                    }
                }
            } catch (err: any) {
                setError(err.message);
                setLoading(false);
            }
        };
        fetchStatus();
        intervalId = setInterval(() => {
            if (!tx || tx.status === 'PREPARED' || tx.status === 'SUBMITTED') fetchStatus();
        }, 2000);
        return () => { if (intervalId) clearInterval(intervalId); };
    }, [idempotencyKey, tx?.status]);

    const handleRetry = async () => {
        if (retrying || !onRetry) return;
        setRetrying(true);
        try { await onRetry(); } catch (err: any) { setError(err.message); } finally { setRetrying(false); }
    };

    const handleResume = async () => {
        if (retrying || !onResume) return;
        setRetrying(true);
        try { await onResume(); } catch (err: any) { setError(err.message); } finally { setRetrying(false); }
    };

    if (loading) {
        return (
            <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3 text-sm text-white/50">
                Fetching transaction status…
            </div>
        );
    }

    if (error || !tx) {
        return (
            <div className="rounded-xl border border-red-400/25 bg-red-400/[0.07] p-3 text-sm text-red-300">
                {error || 'Transaction not found'}
            </div>
        );
    }

    const history: Array<{ status: TxStatus; timestamp: string }> = Array.isArray(tx.statusHistory)
        ? tx.statusHistory
        : (() => { try { return JSON.parse(tx.statusHistory || '[]'); } catch { return []; } })();

    const meta: Record<TxStatus, { icon: React.ReactNode; label: string; border: string; bg: string; textColor: string }> = {
        PREPARED:  { icon: <Clock className="h-4 w-4 text-white/40" />,            label: 'Preparing',           border: 'border-white/10',        bg: 'bg-white/[0.04]',        textColor: 'text-white/70' },
        SUBMITTED: { icon: <Clock className="h-4 w-4 animate-pulse text-blue-400" />, label: 'Processing on-chain…', border: 'border-blue-400/25',     bg: 'bg-blue-400/[0.07]',     textColor: 'text-blue-200' },
        CONFIRMED: { icon: <CheckCircle className="h-4 w-4 text-emerald-400" />,   label: 'Confirmed',           border: 'border-emerald-400/25',  bg: 'bg-emerald-400/[0.07]',  textColor: 'text-emerald-200' },
        REJECTED:  { icon: <XCircle className="h-4 w-4 text-red-400" />,           label: 'Failed',              border: 'border-red-400/25',      bg: 'bg-red-400/[0.07]',      textColor: 'text-red-200' },
        EXPIRED:   { icon: <AlertTriangle className="h-4 w-4 text-amber-400" />,   label: 'Expired',             border: 'border-amber-400/25',    bg: 'bg-amber-400/[0.07]',    textColor: 'text-amber-200' },
    };

    const { icon, label, border, bg, textColor } = meta[tx.status];

    return (
        <div className={`rounded-xl border ${border} ${bg} ${compact ? 'p-3' : 'p-4'}`}>
            <div className="flex items-center gap-2">
                {icon}
                <span className={`text-sm font-semibold ${textColor}`}>{label}</span>
                <span className="ml-auto font-mono text-xs text-white/30">{tx.transition}</span>
            </div>

            {tx.txHash && (
                <div className="mt-3">
                    <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/30">Transaction</div>
                    <div className="flex items-center gap-2">
                        {tx.txHash.startsWith('0x') ? (
                            <a
                                href={`${process.env.NEXT_PUBLIC_FHENIX_EXPLORER_URL || 'https://explorer.fhenix.zone'}/tx/${tx.txHash}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="min-w-0 truncate font-mono text-xs text-blue-300 hover:underline"
                            >
                                {tx.txHash}
                            </a>
                        ) : (
                            <span className="min-w-0 truncate font-mono text-xs text-white/45">{tx.txHash}</span>
                        )}
                        <CopyInlineButton value={tx.txHash} title="Copy transaction hash" />
                    </div>
                </div>
            )}

            {tx.status === 'REJECTED' && tx.error && (
                <div className="mt-2 text-xs text-red-300/80">{tx.error}</div>
            )}

            {tx.status === 'REJECTED' && tx.canRetry && onRetry && (
                <button onClick={handleRetry} disabled={retrying} className="mt-3 rounded-lg border border-red-400/30 bg-red-400/10 px-3 py-1.5 text-xs font-medium text-red-300 transition hover:bg-red-400/20 disabled:opacity-50">
                    {retrying ? 'Retrying…' : 'Retry'}
                </button>
            )}

            {tx.status === 'EXPIRED' && onResume && (
                <button onClick={handleResume} disabled={retrying} className="mt-3 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-1.5 text-xs font-medium text-amber-300 transition hover:bg-amber-400/20 disabled:opacity-50">
                    {retrying ? 'Rebuilding…' : 'Resume'}
                </button>
            )}

            {showHistory && history.length > 0 && (
                <div className="mt-3 space-y-1 border-t border-white/8 pt-3">
                    {history.map((entry, idx) => (
                        <div key={idx} className="flex items-center justify-between text-xs">
                            <span className="text-white/50">{entry.status}</span>
                            <span className="font-mono text-white/30">{new Date(entry.timestamp).toLocaleTimeString()}</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
