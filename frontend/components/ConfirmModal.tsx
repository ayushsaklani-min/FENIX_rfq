'use client';

import { useEffect } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';

export interface ConfirmDetail {
    label: string;
    value: string;
}

interface ConfirmModalProps {
    open: boolean;
    title: string;
    description?: string;
    details?: ConfirmDetail[];
    confirmLabel?: string;
    danger?: boolean;
    loading?: boolean;
    onConfirm: () => void;
    onCancel: () => void;
}

export function ConfirmModal({
    open,
    title,
    description,
    details = [],
    confirmLabel = 'Confirm & sign',
    danger = false,
    loading = false,
    onConfirm,
    onCancel,
}: ConfirmModalProps) {
    useEffect(() => {
        if (!open) return;
        const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [open, onCancel]);

    if (!open) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onCancel} />
            <div className="relative w-full max-w-md rounded-2xl border border-white/12 bg-[#0f1117] shadow-2xl">
                {/* Header */}
                <div className="flex items-start justify-between gap-4 border-b border-white/8 px-6 py-5">
                    <div>
                        {danger && <AlertTriangle className="mb-2 h-5 w-5 text-amber-400" />}
                        <h2 className="text-base font-semibold text-white">{title}</h2>
                        {description && <p className="mt-1 text-sm text-white/55">{description}</p>}
                    </div>
                    <button onClick={onCancel} className="mt-0.5 rounded-lg p-1 text-white/40 transition hover:bg-white/8 hover:text-white/80">
                        <X className="h-4 w-4" />
                    </button>
                </div>

                {/* Details rows */}
                {details.length > 0 && (
                    <div className="space-y-1 px-6 py-4">
                        {details.map((d, i) => (
                            <div key={i} className="flex items-center justify-between gap-4 rounded-lg px-3 py-2.5 even:bg-white/[0.03]">
                                <span className="text-xs font-medium uppercase tracking-wide text-white/45">{d.label}</span>
                                <span className="text-sm font-semibold text-white">{d.value}</span>
                            </div>
                        ))}
                    </div>
                )}

                {/* Wallet notice */}
                <div className="mx-6 mb-4 rounded-xl border border-amber-400/20 bg-amber-400/[0.06] px-4 py-3 text-xs text-amber-200/80">
                    Your Ethereum wallet will open to approve this Sepolia transaction. Review the details carefully before signing.
                </div>

                {/* Actions */}
                <div className="flex items-center justify-end gap-3 border-t border-white/8 px-6 py-4">
                    <Button variant="secondary" onClick={onCancel} disabled={loading}>
                        Cancel
                    </Button>
                    <Button
                        variant={danger ? 'danger' : 'primary'}
                        onClick={onConfirm}
                        isLoading={loading}
                        disabled={loading}
                    >
                        {confirmLabel}
                    </Button>
                </div>
            </div>
        </div>
    );
}
