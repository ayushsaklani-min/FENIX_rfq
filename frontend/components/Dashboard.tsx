'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useWallet } from '@/contexts/WalletContext';
import { Notice, PageHeader, PageShell, Panel, CardSkeleton } from '@/components/protocol/ProtocolPrimitives';
import { Plus, FileText, Gavel, ShieldCheck, ArrowRight, Activity, CheckCircle2, AlertCircle } from 'lucide-react';

type PlatformSummary = {
    feeBps: number;
    paused: boolean;
    initialized: boolean;
    isAdmin: boolean;
    admin: string;
};

const buyerActions = [
    { title: 'Create RFQ', href: '/buyer/create-rfq', description: 'Start a new sealed-bid procurement request.', icon: Plus, accent: 'bg-emerald-400/15 border-emerald-300/25 text-emerald-200' },
    { title: 'My RFQs', href: '/buyer/rfqs', description: 'Manage your active and past requests.', icon: FileText, accent: 'bg-blue-400/15 border-blue-300/25 text-blue-200' },
    { title: 'Auctions', href: '/auctions', description: 'Run Vickrey or Dutch price-discovery auctions.', icon: Gavel, accent: 'bg-amber-400/15 border-amber-300/25 text-amber-200' },
];

const vendorActions = [
    { title: 'Create RFQ', href: '/buyer/create-rfq', description: 'Switch to the buyer workspace and start a new sealed RFQ.', icon: Plus, accent: 'bg-emerald-400/15 border-emerald-300/25 text-emerald-200' },
    { title: 'Browse RFQs', href: '/buyer/rfqs', description: 'Find open requests and submit sealed bids.', icon: FileText, accent: 'bg-blue-400/15 border-blue-300/25 text-blue-200' },
    { title: 'My Bids', href: '/vendor/my-bids', description: 'Track your bids, reveals, and awards.', icon: ShieldCheck, accent: 'bg-emerald-400/15 border-emerald-300/25 text-emerald-200' },
    { title: 'Auctions', href: '/auctions', description: 'Participate in live price-discovery auctions.', icon: Gavel, accent: 'bg-amber-400/15 border-amber-300/25 text-amber-200' },
];

const buyerCopy = {
    eyebrow: 'Private Sourcing Workspace',
    title: "I'm Buying",
    description:
        'Create procurement requests, review sealed vendor competition, select winners, and manage escrow-funded execution.',
};

const vendorCopy = {
    eyebrow: 'Competitive Bid Workspace',
    title: "I'm Selling",
    description:
        'Browse open opportunities, submit shielded bids, reveal only when required, and receive settlements through the same wallet flow.',
};

export default function Dashboard() {
    const router = useRouter();
    const { role, walletAddress, switchRole, switchingRole } = useWallet();
    const [platform, setPlatform] = useState<PlatformSummary | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;
        fetch('/api/platform/config', { cache: 'no-store' })
            .then((res) => res.json())
            .then((payload) => { if (!cancelled && payload?.data) setPlatform(payload.data); })
            .catch(() => {})
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, []);

    const actions = role === 'VENDOR' ? vendorActions : buyerActions;
    const copy = role === 'VENDOR' ? vendorCopy : buyerCopy;
    const canAccessAdmin = Boolean(
        walletAddress &&
        platform?.admin &&
        walletAddress.toLowerCase() === platform.admin.toLowerCase()
    ) || Boolean(platform?.isAdmin);
    const handleActionClick = async (href: string) => {
        if (href === '/buyer/create-rfq' && role === 'VENDOR') {
            const switched = await switchRole('BUYER');
            if (!switched) return;
        }
        router.push(href);
    };

    return (
        <PageShell className="space-y-6">
            <PageHeader
                eyebrow={copy.eyebrow}
                title={copy.title}
                description={copy.description}
                actions={canAccessAdmin ? (
                    <Link href="/admin" className="inline-flex items-center gap-1.5 rounded-xl border border-white/20 bg-white/[0.08] px-3 py-2 text-sm font-medium text-white transition hover:bg-white/[0.14]">
                        Admin Panel
                    </Link>
                ) : undefined}
            />

            {!loading && platform?.initialized === false ? (
                <Notice tone="warning" title="Platform not initialized">
                    The admin needs to configure the platform before RFQs can be created.
                </Notice>
            ) : null}

            {platform?.paused ? (
                <Notice tone="warning" title="Platform paused">
                    New RFQ creation is paused. Existing settlements remain available.
                </Notice>
            ) : null}

            {loading ? (
                <div className="grid gap-4 md:grid-cols-3"><CardSkeleton /><CardSkeleton /><CardSkeleton /></div>
            ) : (
                <div className="space-y-2">
                    <div className="text-xs font-semibold uppercase tracking-[0.22em] text-white/50 px-1">Quick actions</div>
                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                        {actions.map((action) => (
                            <button
                                key={action.title}
                                type="button"
                                disabled={switchingRole && action.href === '/buyer/create-rfq'}
                                onClick={() => handleActionClick(action.href)}
                                className="group relative overflow-hidden rounded-2xl border border-white/12 bg-white/[0.04] p-5 text-left transition-all duration-200 hover:-translate-y-1 hover:border-white/22 hover:bg-white/[0.07] hover:shadow-[0_12px_40px_rgba(0,0,0,0.4)] disabled:opacity-60"
                            >
                                <div className="flex items-start justify-between">
                                    <div className={`flex h-11 w-11 items-center justify-center rounded-xl border ${action.accent}`}>
                                        <action.icon className="h-5 w-5" />
                                    </div>
                                    <ArrowRight className="h-4 w-4 text-white/30 transition-all duration-200 group-hover:translate-x-0.5 group-hover:text-white/70" />
                                </div>
                                <h3 className="mt-4 text-base font-bold text-white">{action.title}</h3>
                                <p className="mt-1 text-sm leading-6 text-white/60">{action.description}</p>
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {!loading && platform ? (
                <div className="space-y-2">
                    <div className="text-xs font-semibold uppercase tracking-[0.22em] text-white/50 px-1">Platform status</div>
                    <div className="grid gap-3 sm:grid-cols-3">
                        {[
                            {
                                label: 'Network',
                                value: platform.initialized ? 'Active' : 'Not initialized',
                                icon: Activity,
                                color: platform.initialized ? 'text-emerald-300' : 'text-amber-300',
                                bg: platform.initialized ? 'bg-emerald-400/10 border-emerald-300/20' : 'bg-amber-400/10 border-amber-300/20',
                            },
                            {
                                label: 'Operations',
                                value: platform.paused ? 'Paused' : 'Running',
                                icon: platform.paused ? AlertCircle : CheckCircle2,
                                color: platform.paused ? 'text-amber-300' : 'text-emerald-300',
                                bg: platform.paused ? 'bg-amber-400/10 border-amber-300/20' : 'bg-emerald-400/10 border-emerald-300/20',
                            },
                            {
                                label: 'Platform fee',
                                value: `${(platform.feeBps / 100).toFixed(2)}%`,
                                icon: Activity,
                                color: 'text-blue-300',
                                bg: 'bg-blue-400/10 border-blue-300/20',
                            },
                        ].map((item) => (
                            <div key={item.label} className={`rounded-xl border ${item.bg} p-4`}>
                                <div className="flex items-center gap-2">
                                    <item.icon className={`h-4 w-4 ${item.color}`} />
                                    <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/50">{item.label}</div>
                                </div>
                                <div className={`mt-2 text-lg font-bold ${item.color}`}>{item.value}</div>
                            </div>
                        ))}
                    </div>
                </div>
            ) : null}
        </PageShell>
    );
}
