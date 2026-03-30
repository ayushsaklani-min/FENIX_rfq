'use client';

import { useWallet } from '@/contexts/WalletContext';
import { Button } from '@/components/ui/Button';
import { AlertTriangle, WifiOff, XCircle, X, ExternalLink } from 'lucide-react';

const METAMASK_URL = 'https://metamask.io/download/';

export default function WalletErrorModal() {
    const { connectionError, clearConnectionError, connectWallet, connecting } = useWallet();

    const handleRetry = async () => {
        clearConnectionError();
        await connectWallet();
    };

    if (!connectionError) return null;

    const type = connectionError.type;

    const icon = {
        NOT_INSTALLED: <WifiOff className="w-6 h-6 text-amber-400" />,
        LOCKED: <AlertTriangle className="w-6 h-6 text-amber-400" />,
        REJECTED: <XCircle className="w-6 h-6 text-red-400" />,
        UNKNOWN: <AlertTriangle className="w-6 h-6 text-red-400" />,
    } as const;

    return (
        <div
            className="fixed inset-0 z-[100] flex items-center justify-center px-4 bg-black/70 backdrop-blur-sm"
            onClick={clearConnectionError}
        >
            <div
                onClick={(e) => e.stopPropagation()}
                className="relative w-full max-w-md rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 shadow-2xl"
            >
                <button onClick={clearConnectionError} className="absolute top-3 right-3 text-[hsl(var(--muted-foreground))] hover:text-white transition-colors">
                    <X className="w-5 h-5" />
                </button>

                <div className="flex flex-col items-center text-center gap-3 mb-5">
                    <div className="w-12 h-12 rounded-full flex items-center justify-center bg-[hsl(var(--secondary))]">
                        {icon[type]}
                    </div>
                    <h2 className="text-lg font-semibold text-white">{connectionError.title}</h2>
                    <p className="text-sm text-[hsl(var(--muted-foreground))]">{connectionError.hint}</p>
                </div>

                {(type === 'LOCKED' || type === 'NOT_INSTALLED') && (
                    <div className="mb-5 rounded-lg bg-[hsl(var(--secondary))] p-3 space-y-2 text-sm text-[hsl(var(--muted-foreground))]">
                        <p className="font-medium text-white text-xs">Quick fix:</p>
                        {type === 'LOCKED' ? (
                            <>
                                <Step n={1} text="Click the MetaMask icon in your browser toolbar" />
                                <Step n={2} text="Enter your password to unlock" />
                                <Step n={3} text='Click "Try Again" below' />
                            </>
                        ) : (
                            <>
                                <Step n={1} text="Install MetaMask wallet extension" />
                                <Step n={2} text="Create or import your wallet" />
                                <Step n={3} text="Reload this page and connect" />
                            </>
                        )}
                    </div>
                )}

                <div className="flex flex-col gap-2">
                    {type === 'NOT_INSTALLED' ? (
                        <a
                            href={METAMASK_URL}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center justify-center gap-2 w-full h-10 rounded-lg bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] text-sm font-medium hover:opacity-90 transition"
                        >
                            Install MetaMask <ExternalLink className="w-4 h-4" />
                        </a>
                    ) : (
                        <Button size="md" onClick={handleRetry} isLoading={connecting} className="w-full">
                            Try Again
                        </Button>
                    )}
                    <Button variant="secondary" size="md" onClick={clearConnectionError} className="w-full">
                        Dismiss
                    </Button>
                </div>
            </div>
        </div>
    );
}

function Step({ n, text }: { n: number; text: string }) {
    return (
        <div className="flex items-start gap-2">
            <span className="shrink-0 w-5 h-5 rounded-full bg-white/10 text-xs flex items-center justify-center font-medium mt-0.5">{n}</span>
            <span>{text}</span>
        </div>
    );
}
