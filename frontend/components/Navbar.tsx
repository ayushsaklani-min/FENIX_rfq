'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useWallet } from '@/contexts/WalletContext';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Wallet, LogOut, Menu, X, ArrowLeftRight } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function Navbar() {
    const pathname = usePathname();
    const [isOpen, setIsOpen] = useState(false);
    const [isAdmin, setIsAdmin] = useState(false);
    const { walletAddress, role, connecting, switchRole, connectWallet, disconnectWallet, switchingRole } = useWallet();
    const [scrolled, setScrolled] = useState(false);
    const hideChrome = pathname === '/' || pathname === '/select-role';

    useEffect(() => {
        const handleScroll = () => {
            setScrolled(window.scrollY > 20);
        };
        window.addEventListener('scroll', handleScroll);
        return () => window.removeEventListener('scroll', handleScroll);
    }, []);

    useEffect(() => {
        let cancelled = false;

        if (!walletAddress) {
            setIsAdmin(false);
            return () => {
                cancelled = true;
            };
        }

        fetch('/api/platform/config', { cache: 'no-store' })
            .then((response) => response.json())
            .then((payload) => {
                if (!cancelled) {
                    const admin = String(payload?.data?.admin || '').toLowerCase();
                    const isAdminWallet = Boolean(admin && admin === walletAddress.toLowerCase());
                    setIsAdmin(isAdminWallet || Boolean(payload?.data?.isAdmin));
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setIsAdmin(false);
                }
            });

        return () => {
            cancelled = true;
        };
    }, [walletAddress]);

    const homeHref = walletAddress ? '/dashboard' : '/';

    const navLinks = walletAddress
        ? [
            { name: 'Dashboard', href: '/dashboard' },
            { name: 'Create RFQ', href: '/buyer/create-rfq' },
            ...(role === 'BUYER'
                ? [
                    { name: 'My RFQs', href: '/buyer/rfqs' },
                  ]
                : role === 'VENDOR'
                ? [
                    { name: 'Open RFQs', href: '/buyer/rfqs' },
                    { name: 'My Bids', href: '/vendor/my-bids' },
                  ]
                : []),
            { name: 'Auctions', href: '/auctions' },
            { name: 'Escrow', href: '/escrow' },
            ...(isAdmin ? [{ name: 'Admin', href: '/admin' }] : []),
          ]
        : [];

    const walletLabel = walletAddress
        ? `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`
        : 'Connect Wallet';

    if (hideChrome) {
        return null;
    }

    return (
        <nav
            className={cn(
                'fixed inset-x-0 top-0 z-50 transition-all duration-300',
                scrolled
                    ? 'border-b border-white/12 bg-[#141414]/85 py-3 shadow-[0_12px_40px_rgba(0,0,0,0.42)] backdrop-blur-xl'
                    : 'bg-[#141414]/55 py-4 backdrop-blur-lg',
            )}
        >
            <div className="mx-auto flex max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
                <Link href={homeHref} className="group flex items-center gap-3">
                    <div className="premium-panel premium-glow flex h-10 w-10 items-center justify-center rounded-full p-1.5">
                        <img src="/logo.png" alt="SealRFQ" className="h-full w-full rounded-full object-cover opacity-90" />
                    </div>
                    <div>
                        <div className="premium-script -mb-1 text-2xl text-amber-100">SealRFQ</div>
                        <div className="text-[9px] uppercase tracking-[0.34em] text-white/80">Private Procurement</div>
                    </div>
                </Link>

                <div className="hidden items-center gap-1.5 rounded-full border border-white/12 bg-white/[0.04] p-1.5 md:flex">
                    {navLinks.map((link) => {
                        const isActive = pathname === link.href || (link.href !== '/dashboard' && pathname.startsWith(link.href));
                        return (
                            <Link
                                key={link.name}
                                href={link.href}
                                className={cn(
                                    'rounded-full px-4 py-2 text-sm font-semibold transition-all duration-200',
                                    isActive
                                        ? 'border border-amber-200/35 bg-amber-200/18 text-white shadow-[0_8px_20px_rgba(0,0,0,0.25)]'
                                        : 'text-white/92 hover:bg-white/[0.1] hover:text-white',
                                )}
                            >
                                {link.name}
                            </Link>
                        );
                    })}
                </div>

                <div className="flex items-center gap-2 sm:gap-3">
                    {walletAddress && (role === 'BUYER' || role === 'VENDOR') ? (
                        <button
                            onClick={() => switchRole(role === 'BUYER' ? 'VENDOR' : 'BUYER')}
                            disabled={switchingRole}
                            className="hidden items-center gap-2 rounded-full border border-white/20 bg-white/[0.08] px-3.5 py-2 text-xs font-semibold text-white transition hover:border-amber-200/35 hover:bg-white/[0.14] disabled:opacity-50 sm:flex"
                        >
                            <ArrowLeftRight className="h-4 w-4 text-amber-200/90" />
                            {switchingRole ? 'Switching...' : role === 'BUYER' ? 'Switch to Seller' : 'Switch to Buyer'}
                        </button>
                    ) : null}

                    {walletAddress ? (
                        <div className="flex items-center gap-2">
                            <Badge
                                variant="outline"
                                className="hidden rounded-full border-emerald-300/30 bg-emerald-300/12 px-3 py-1 font-semibold text-emerald-100 sm:inline-flex"
                            >
                                {role === 'BUYER' ? 'Buyer' : role === 'VENDOR' ? 'Seller' : role}
                            </Badge>
                            <Button
                                variant="secondary"
                                size="sm"
                                onClick={disconnectWallet}
                                leftIcon={<LogOut className="h-4 w-4" />}
                                className="rounded-full border border-white/15 bg-white/[0.06] px-4 font-semibold text-white hover:bg-white/[0.12]"
                            >
                                {walletLabel}
                            </Button>
                        </div>
                    ) : (
                        <Button
                            size="sm"
                            onClick={connectWallet}
                            isLoading={connecting}
                            leftIcon={<Wallet className="h-4 w-4" />}
                            className="rounded-full bg-emerald-400 px-6 font-semibold text-[#113127] shadow-[0_10px_28px_rgba(16,185,129,0.35)] transition hover:-translate-y-0.5 hover:bg-emerald-300 hover:shadow-[0_14px_34px_rgba(16,185,129,0.45)]"
                        >
                            {walletLabel}
                        </Button>
                    )}

                    <button
                        onClick={() => setIsOpen((current) => !current)}
                        aria-label="Toggle navigation"
                        className="inline-flex items-center rounded-xl border border-white/15 bg-white/[0.06] p-2 text-white/80 transition hover:bg-white/[0.12] hover:text-white md:hidden"
                    >
                        {isOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
                    </button>
                </div>
            </div>

            {isOpen ? (
                <div className="absolute top-full w-full border-b border-t border-white/12 bg-[#141414]/95 px-4 py-4 backdrop-blur-xl md:hidden">
                    <div className="flex flex-col space-y-1.5">
                        {navLinks.map((link) => {
                            const isActive = pathname === link.href || (link.href !== '/dashboard' && pathname.startsWith(link.href));
                            return (
                                <Link
                                key={link.name}
                                href={link.href}
                                onClick={() => setIsOpen(false)}
                                    className={cn(
                                        'block rounded-xl px-4 py-3 text-base font-semibold transition-all',
                                        isActive
                                            ? 'border border-white/20 bg-white/[0.14] text-white'
                                            : 'text-white/75 hover:bg-white/[0.08] hover:text-white',
                                    )}
                                >
                                    {link.name}
                                </Link>
                            );
                        })}
                    </div>
                </div>
            ) : null}
        </nav>
    );
}
