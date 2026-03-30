/**
 * Polling Optimization
 * Gate 1: Performance Pass - Reduce polling load
 */

import { useEffect, useRef, useState } from 'react';
import { safeGetItem } from '@/lib/safeLocalStorage';

export type TxStatus = 'PREPARED' | 'SUBMITTED' | 'CONFIRMED' | 'REJECTED' | 'EXPIRED';

interface UseTxStatusOptions {
    txId: string;
    onConfirmed?: () => void;
    onRejected?: () => void;
    onExpired?: () => void;
}

export function useTxStatusOptimized({
    txId,
    onConfirmed,
    onRejected,
    onExpired,
}: UseTxStatusOptions) {
    const [status, setStatus] = useState<TxStatus>('PREPARED');
    const [loading, setLoading] = useState(true);
    const intervalRef = useRef<NodeJS.Timeout | null>(null);
    const pollCountRef = useRef(0);

    useEffect(() => {
        if (!txId) return;

        const fetchStatus = async () => {
            try {
                const res = await fetch(`/api/tx/${txId}`, {
                    headers: {
                        Authorization: `Bearer ${localStorage.getItem('accessToken') || ''}`,
                    },
                });
                const data = await res.json();

                if (data.status === 'success') {
                    const newStatus = data.data.status;
                    setStatus(newStatus);
                    setLoading(false);

                    if (['CONFIRMED', 'REJECTED', 'EXPIRED'].includes(newStatus)) {
                        if (intervalRef.current) {
                            clearInterval(intervalRef.current);
                            intervalRef.current = null;
                        }

                        if (newStatus === 'CONFIRMED') onConfirmed?.();
                        if (newStatus === 'REJECTED') onRejected?.();
                        if (newStatus === 'EXPIRED') onExpired?.();
                    }
                }
            } catch (error) {
                console.error('Failed to fetch tx status:', error);
            }
        };

        fetchStatus();

        const getPollInterval = () => {
            pollCountRef.current += 1;

            if (['CONFIRMED', 'REJECTED', 'EXPIRED'].includes(status)) {
                return null;
            }

            if (status === 'SUBMITTED') {
                if (pollCountRef.current < 10) return 2000;
                if (pollCountRef.current < 30) return 5000;
                return 10000;
            }

            return 5000;
        };

        const startPolling = () => {
            const interval = getPollInterval();
            if (interval) {
                intervalRef.current = setInterval(fetchStatus, interval);
            }
        };

        startPolling();

        return () => {
            if (intervalRef.current) {
                clearInterval(intervalRef.current);
            }
        };
    }, [txId, status, onConfirmed, onRejected, onExpired]);

    return { status, loading };
}

export async function fetchBatchTxStatus(txIds: string[]) {
    const res = await fetch('/api/tx/batch-status', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${localStorage.getItem('accessToken') || ''}`,
        },
        body: JSON.stringify({ txIds }),
    });

    const data = await res.json();
    return data.data;
}
