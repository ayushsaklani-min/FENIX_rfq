'use client';

import { useEffect, useState, useCallback } from 'react';
import { Clock, CheckCircle, AlertTriangle } from 'lucide-react';
import { TIMING } from '@/lib/sealProtocol';
import { fetchCurrentBlockHeight } from '@/lib/sepoliaClient';

function formatTimeRemaining(seconds: number): string {
    if (seconds <= 0) return 'now';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
}

interface Props {
    deadlineBlock: number;
    label: string;
    passedLabel?: string;
    onDeadlineReached?: () => void;
    urgentWithinBlocks?: number;
}

export default function DeadlineCountdown({
    deadlineBlock,
    label,
    passedLabel = 'Deadline reached',
    onDeadlineReached,
    urgentWithinBlocks = TIMING.SNIPE_WINDOW_BLOCKS,
}: Props) {
    const [currentBlock, setCurrentBlock] = useState<number | null>(null);
    const [error, setError] = useState(false);

    const poll = useCallback(async () => {
        const h = await fetchCurrentBlockHeight();
        if (h !== null) { setCurrentBlock(h); setError(false); } else { setError(true); }
    }, []);

    useEffect(() => {
        poll();
        const id = setInterval(poll, 15_000);
        return () => clearInterval(id);
    }, [poll]);

    useEffect(() => {
        if (currentBlock !== null && currentBlock >= deadlineBlock) onDeadlineReached?.();
    }, [currentBlock, deadlineBlock, onDeadlineReached]);

    if (currentBlock === null) {
        return (
            <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3 text-sm text-slate-600">
                <Clock className="h-4 w-4 animate-pulse" />
                {error ? 'Unable to fetch block height' : 'Loading deadline...'}
            </div>
        );
    }

    const blocksRemaining = deadlineBlock - currentBlock;
    const isPassed = blocksRemaining <= 0;
    const isUrgent = !isPassed && blocksRemaining <= urgentWithinBlocks;
    const secondsRemaining = Math.round((blocksRemaining * TIMING.BLOCK_MS) / 1000);

    if (isPassed) {
        return (
            <div className="flex flex-col gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-3 text-sm text-emerald-800 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-2">
                    <CheckCircle className="h-4 w-4 shrink-0" />
                    <span className="font-medium">{passedLabel}</span>
                </div>
                <span className="text-xs font-medium uppercase tracking-[0.16em] text-emerald-700">Reached</span>
            </div>
        );
    }

    return (
        <div className={`flex flex-col gap-2 rounded-xl border px-3.5 py-3 text-sm sm:flex-row sm:items-center sm:justify-between ${
            isUrgent
                ? 'border-amber-200 bg-amber-50 text-amber-800'
                : 'border-slate-200 bg-slate-50 text-slate-700'
        }`}>
            <div className="flex items-center gap-2">
                {isUrgent ? <AlertTriangle className="h-4 w-4 shrink-0 animate-pulse" /> : <Clock className="h-4 w-4 shrink-0" />}
                <span className="font-medium">{label}</span>
            </div>
            <div className="flex items-center gap-3">
                <span className={`font-mono text-sm font-semibold ${isUrgent ? 'text-amber-900' : 'text-slate-950'}`}>
                    ~{formatTimeRemaining(secondsRemaining)}
                </span>
                <span className={`text-xs font-medium ${isUrgent ? 'text-amber-700' : 'text-slate-500'}`}>
                    {blocksRemaining} blocks
                </span>
            </div>
        </div>
    );
}
