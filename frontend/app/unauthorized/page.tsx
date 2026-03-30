'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ArrowLeftRight, BriefcaseBusiness, ShoppingBag } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useWallet } from '@/contexts/WalletContext';
import { safeGetItem } from '@/lib/safeLocalStorage';

function roleLabel(role: string | null) {
    if (role === 'BUYER') return 'Buyer';
    if (role === 'VENDOR') return 'Seller';
    if (role === 'AUDITOR') return 'Auditor';
    return 'Unknown';
}

function resolveDestination(from: string | null) {
    if (!from || from === '/unauthorized') return '/dashboard';
    return from;
}

export default function UnauthorizedPage() {
    const router = useRouter();
    const { walletAddress, role, switchRole, switchingRole } = useWallet();
    const [targetRole, setTargetRole] = useState<string | null>(null);
    const [from, setFrom] = useState<string | null>(null);
    const destination = resolveDestination(from);

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        setFrom(params.get('from'));
    }, []);

    const handleRoleSwitch = async (nextRole: 'BUYER' | 'VENDOR') => {
        if (!walletAddress) {
            router.push('/');
            return;
        }

        if (role === nextRole) {
            router.replace(destination);
            return;
        }

        setTargetRole(nextRole);
        await switchRole(nextRole);

        const storedRole = typeof window !== 'undefined' ? safeGetItem('role') : null;
        if (storedRole === nextRole) {
            router.replace(destination);
        }
        setTargetRole(null);
    };

    return (
        <div className="mx-auto flex min-h-[70vh] w-full max-w-4xl items-center px-4 py-16 sm:px-6 lg:px-8">
            <div className="w-full rounded-2xl border border-white/12 bg-white/[0.04] p-8 backdrop-blur-sm sm:p-10">
                <div className="inline-flex items-center gap-2 rounded-full border border-amber-200/25 bg-amber-400/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-amber-200">
                    <ArrowLeftRight className="h-3.5 w-3.5" />
                    Role Switch Required
                </div>

                <div className="mt-5 max-w-2xl">
                    <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">Switch workspace to continue</h1>
                    <p className="mt-3 text-sm leading-7 text-white/60">
                        This route belongs to a different side of the product. Instead of stopping on an insufficient-permission error,
                        continue as Buyer or Seller and jump back into the correct workflow.
                    </p>
                </div>

                <div className="mt-6 flex flex-wrap items-center gap-3 text-sm">
                    <div className="rounded-full border border-white/15 bg-white/[0.06] px-3 py-1.5 text-white/70">
                        Current session role: <span className="font-semibold text-white">{roleLabel(role)}</span>
                    </div>
                    {from ? (
                        <div className="rounded-full border border-white/15 bg-white/[0.06] px-3 py-1.5 text-white/70">
                            Requested page: <span className="font-medium text-white">{from}</span>
                        </div>
                    ) : null}
                </div>

                <div className="mt-8 grid gap-4 md:grid-cols-2">
                    <div className="rounded-2xl border border-blue-300/20 bg-blue-400/[0.07] p-5">
                        <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-blue-300/25 bg-blue-400/15 text-blue-200">
                                <ShoppingBag className="h-5 w-5" />
                            </div>
                            <div>
                                <div className="text-base font-semibold text-white">Buyer workspace</div>
                                <div className="text-sm text-white/55">Create RFQs, import auction results, and manage escrow.</div>
                            </div>
                        </div>
                        <Button
                            className="mt-5 w-full"
                            variant={role === 'BUYER' ? 'secondary' : 'primary'}
                            isLoading={switchingRole && targetRole === 'BUYER'}
                            onClick={() => handleRoleSwitch('BUYER')}
                        >
                            {role === 'BUYER' ? 'Continue as Buyer' : 'Switch to Buyer'}
                        </Button>
                    </div>

                    <div className="rounded-2xl border border-emerald-300/20 bg-emerald-400/[0.07] p-5">
                        <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-emerald-300/25 bg-emerald-400/15 text-emerald-200">
                                <BriefcaseBusiness className="h-5 w-5" />
                            </div>
                            <div>
                                <div className="text-base font-semibold text-white">Seller workspace</div>
                                <div className="text-sm text-white/55">Commit bids, reveal offers, respond as winner, and claim funds.</div>
                            </div>
                        </div>
                        <Button
                            className="mt-5 w-full"
                            variant={role === 'VENDOR' ? 'secondary' : 'primary'}
                            isLoading={switchingRole && targetRole === 'VENDOR'}
                            onClick={() => handleRoleSwitch('VENDOR')}
                        >
                            {role === 'VENDOR' ? 'Continue as Seller' : 'Switch to Seller'}
                        </Button>
                    </div>
                </div>

                <div className="mt-6 flex flex-wrap items-center gap-3">
                    <Link href="/dashboard">
                        <Button variant="secondary">Go to dashboard</Button>
                    </Link>
                    <Link href="/">
                        <Button variant="ghost">Back to home</Button>
                    </Link>
                </div>
            </div>
        </div>
    );
}
