'use client';

import { useEffect, useState } from 'react';
import { TxStatusView } from '@/components/TxStatus';
import { Notice, PageHeader, PageShell, Panel } from '@/components/protocol/ProtocolPrimitives';
import { authenticatedFetch } from '@/lib/authFetch';
import { useWallet } from '@/contexts/WalletContext';
import { walletFirstTx } from '@/lib/walletTx';

type PlatformConfig = {
    initialized: boolean;
    paused: boolean;
    feeBps: number;
    treasuryToken1: string;
    treasuryToken2: string;
    isAdmin: boolean;
    admin: string;
};

export default function AdminPage() {
    const { walletAddress } = useWallet();
    const [config, setConfig] = useState<PlatformConfig | null>(null);
    const [feeBps, setFeeBps] = useState('50');
    const [paused, setPaused] = useState(false);
    const [withdrawToken1, setWithdrawToken1] = useState('');
    const [withdrawToken2, setWithdrawToken2] = useState('');
    const [txKey, setTxKey] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [acting, setActing] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            try {
                const response = await authenticatedFetch('/api/platform/config');
                const payload = await response.json();
                if (!response.ok) {
                    throw new Error(payload?.error?.message || 'Failed to load platform config.');
                }
                if (!cancelled) {
                    setConfig(payload.data);
                    setFeeBps(String(payload.data.feeBps));
                    setPaused(Boolean(payload.data.paused));
                }
            } catch (caught: any) {
                if (!cancelled) {
                    setError(caught?.message || 'Failed to load platform config.');
                }
            } finally {
                if (!cancelled) {
                    setLoading(false);
                }
            }
        };

        load();
        const intervalId = window.setInterval(load, 15000);
        return () => {
            cancelled = true;
            window.clearInterval(intervalId);
        };
    }, []);

    const configurePlatform = async () => {
        setActing(true);
        setError(null);
        try {
            const feeValue = Number(feeBps);
            const result = await walletFirstTx(
                '/api/platform/config',
                { feeBps: feeValue, paused },
                (_prepareData, txHash) => ({ feeBps: feeValue, paused, txHash }),
            );
            if (!result.success) {
                setError(result.error || 'Failed to configure platform.');
            } else {
                setTxKey(result.idempotencyKey || null);
            }
        } catch (caught: any) {
            setError(caught?.message || 'Failed to configure platform.');
        } finally {
            setActing(false);
        }
    };

    const withdraw = async (kind: 'withdraw-token1' | 'withdraw-token2', amount: string) => {
        setActing(true);
        setError(null);
        try {
            const result = await walletFirstTx(
                `/api/platform/${kind}`,
                { amount },
                (_prepareData, txHash) => ({ amount, txHash }),
            );
            if (!result.success) {
                setError(result.error || 'Failed to withdraw fees.');
            } else {
                setTxKey(result.idempotencyKey || null);
            }
        } catch (caught: any) {
            setError(caught?.message || 'Failed to withdraw fees.');
        } finally {
            setActing(false);
        }
    };

    const canAccessAdmin = Boolean(
        walletAddress &&
        config?.admin &&
        walletAddress.toLowerCase() === config.admin.toLowerCase()
    ) || Boolean(config?.isAdmin);

    if (loading) {
        return (
            <PageShell>
                <Panel title="Loading admin dashboard">
                    <div className="text-sm text-slate-400">Fetching platform config and treasury balances.</div>
                </Panel>
            </PageShell>
        );
    }

    if (error && !config) {
        return (
            <PageShell>
                <Notice tone="danger">{error}</Notice>
            </PageShell>
        );
    }

    if (!canAccessAdmin) {
        return (
            <PageShell>
                <Notice tone="danger">Admin access required. Make sure you are signed in with the admin wallet address.</Notice>
            </PageShell>
        );
    }

    return (
        <PageShell className="space-y-8">
            <PageHeader
                eyebrow="Admin"
                title="Platform configuration"
                description="Configure the Sepolia RFQ contract and withdraw accrued token fees."
            />

            {error ? <Notice tone="danger">{error}</Notice> : null}
            {!config.initialized ? (
                <Notice tone="warning" title="Onboarding required">
                    The platform config is not readable from the Sepolia RFQ contract yet.
                </Notice>
            ) : null}

            <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
                <Panel title="Configure platform">
                    <div className="space-y-4">
                        <label className="space-y-2 text-sm text-[hsl(var(--muted-foreground))]">
                            <span>Fee basis points</span>
                            <input
                                type="number"
                                min="0"
                                max="10000"
                                className="w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--secondary))] px-4 py-3 text-white"
                                value={feeBps}
                                onChange={(event) => setFeeBps(event.target.value)}
                            />
                        </label>
                        <label className="flex items-center gap-3 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--secondary))] px-4 py-3 text-sm text-[hsl(var(--muted-foreground))]">
                            <input type="checkbox" checked={paused} onChange={(event) => setPaused(event.target.checked)} />
                            Pause new RFQ creation
                        </label>
                        <button
                            type="button"
                            disabled={acting}
                            onClick={configurePlatform}
                            className="rounded-lg bg-[hsl(var(--primary))] px-4 py-2 text-sm font-medium text-[hsl(var(--primary-foreground))] transition hover:opacity-90 disabled:opacity-50"
                        >
                            Configure platform
                        </button>
                    </div>
                </Panel>

                <Panel title="Treasury balances">
                    <div className="space-y-3 text-sm text-[hsl(var(--muted-foreground))]">
                        <div>Admin: <span className="font-medium text-white">{config.admin}</span></div>
                        <div>Token 1: <span className="font-medium text-white">{config.treasuryToken1}</span></div>
                        <div>Token 2: <span className="font-medium text-white">{config.treasuryToken2}</span></div>
                        <div>Paused: <span className="font-medium text-white">{config.paused ? 'Yes' : 'No'}</span></div>
                        <div>Fee bps: <span className="font-medium text-white">{config.feeBps}</span></div>
                    </div>

                    <div className="mt-5 space-y-4">
                        <div className="space-y-3">
                            <input
                                className="w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--secondary))] px-4 py-3 text-white"
                                value={withdrawToken1}
                                onChange={(event) => setWithdrawToken1(event.target.value)}
                                placeholder="Token 1 amount"
                            />
                            <button
                                type="button"
                                disabled={acting || !withdrawToken1}
                                onClick={() => withdraw('withdraw-token1', withdrawToken1)}
                                className="rounded-lg border border-[hsl(var(--border))] px-4 py-2 text-sm font-medium text-white transition hover:bg-[hsl(var(--secondary))] disabled:opacity-50"
                            >
                                Withdraw token 1 fees
                            </button>
                        </div>

                        <div className="space-y-3">
                            <input
                                className="w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--secondary))] px-4 py-3 text-white"
                                value={withdrawToken2}
                                onChange={(event) => setWithdrawToken2(event.target.value)}
                                placeholder="Token 2 amount"
                            />
                            <button
                                type="button"
                                disabled={acting || !withdrawToken2}
                                onClick={() => withdraw('withdraw-token2', withdrawToken2)}
                                className="rounded-lg border border-[hsl(var(--border))] px-4 py-2 text-sm font-medium text-white transition hover:bg-[hsl(var(--secondary))] disabled:opacity-50"
                            >
                                Withdraw token 2 fees
                            </button>
                        </div>
                    </div>
                </Panel>
            </div>

            {txKey ? (
                <Panel title="Latest transaction">
                    <TxStatusView idempotencyKey={txKey} compact={true} />
                </Panel>
            ) : null}
        </PageShell>
    );
}
