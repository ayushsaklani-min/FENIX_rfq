'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useWallet } from '@/contexts/WalletContext';

export default function Footer() {
    const pathname = usePathname();
    const { walletAddress } = useWallet();

    if (pathname === '/' || pathname === '/select-role') return null;
    if (!walletAddress && pathname === '/') return null;

    return (
        <footer className="mt-auto border-t border-[hsl(var(--border))]">
            <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-5 text-sm text-[hsl(var(--muted-foreground))] sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3">
                    <span className="font-medium text-white">Fhenix SEAL</span>
                    <span>Private procurement with FHE</span>
                </div>
                <div className="flex flex-wrap items-center gap-4">
                    <div className="flex items-center gap-2">
                        <span className="h-2 w-2 rounded-full bg-emerald-500" />
                        <span>Fhenix Testnet</span>
                    </div>
                    <Link href="/privacy" className="transition-colors hover:text-white">
                        Privacy
                    </Link>
                    <Link href="/terms" className="transition-colors hover:text-white">
                        Terms
                    </Link>
                </div>
            </div>
        </footer>
    );
}
