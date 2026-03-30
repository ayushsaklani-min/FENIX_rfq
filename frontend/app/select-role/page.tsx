'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { ArrowRight, CheckCircle2, LogOut, ShoppingCart, Store, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useWallet } from '@/contexts/WalletContext';
import { cn } from '@/lib/utils';

type RoleOption = {
    id: 'BUYER' | 'VENDOR';
    eyebrow: string;
    title: string;
    description: string;
    image: string;
    features: string[];
    icon: LucideIcon;
};

const roleOptions: RoleOption[] = [
    {
        id: 'BUYER',
        eyebrow: 'Private Sourcing Workspace',
        title: "I'm Buying",
        description: 'Create procurement requests, review sealed vendor competition, select winners, and manage escrow-funded execution.',
        image: '/images/usecase-enterprise.jpg',
        features: ['Create RFQs and auctions', 'Review sealed bids privately', 'Select winners with protocol rules', 'Fund and release escrow'],
        icon: ShoppingCart,
    },
    {
        id: 'VENDOR',
        eyebrow: 'Competitive Bid Workspace',
        title: "I'm Selling",
        description: 'Browse open opportunities, submit shielded bids, reveal only when required, and receive settlements through the same wallet flow.',
        image: '/images/usecase-vendor.jpg',
        features: ['Browse available RFQs', 'Submit encrypted commitments', 'Reveal pricing when needed', 'Receive protocol-driven payouts'],
        icon: Store,
    },
];

export default function SelectRolePage() {
    const router = useRouter();
    const { ready, sessionHydrating, walletAddress, role, switchRole, switchingRole, disconnectWallet } = useWallet();
    const [selected, setSelected] = useState<'BUYER' | 'VENDOR' | null>(null);

    useEffect(() => {
        if (!ready || sessionHydrating) return;
        if (!walletAddress) {
            router.replace('/');
            return;
        }
        if (role && role !== 'NEW_USER') {
            router.replace('/dashboard');
        }
    }, [ready, sessionHydrating, walletAddress, role, router]);

    const handleSelect = (chosen: 'BUYER' | 'VENDOR') => {
        setSelected(chosen);
        router.push('/dashboard');
        switchRole(chosen).then((switched) => {
            if (!switched) setSelected(null);
        });
    };

    const walletLabel = walletAddress ? `${walletAddress.slice(0, 10)}...${walletAddress.slice(-8)}` : '';

    if (!ready || sessionHydrating || !walletAddress) {
        return <div className="min-h-screen bg-[#141414]" />;
    }

    return (
        <div className="premium-shell premium-copy relative -mt-16 min-h-screen overflow-hidden bg-[#141414] text-white">
            <div className="premium-grid pointer-events-none absolute inset-0 opacity-30" />
            <div className="premium-orb absolute left-[-9rem] top-16 h-72 w-72 rounded-full bg-emerald-500/10 blur-[120px]" />
            <div className="premium-orb absolute right-[-7rem] top-[18rem] h-80 w-80 rounded-full bg-amber-300/10 blur-[140px]" style={{ animationDelay: '-7s' }} />

            <header className="relative z-20 border-b border-white/10 bg-[#141414]/75 backdrop-blur-xl">
                <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-2">
                    <div className="flex items-center gap-3">
                        <div className="premium-panel premium-glow flex h-10 w-10 items-center justify-center rounded-full p-1.5">
                            <img src="/logo.png" alt="SealRFQ" className="h-full w-full rounded-full object-cover opacity-90" />
                        </div>
                        <div>
                            <div className="premium-script -mb-1 text-2xl text-amber-100">SealRFQ</div>
                            <div className="text-[9px] uppercase tracking-[0.35em] text-white/50">Wallet Connected</div>
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        <div className="hidden rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[10px] uppercase tracking-[0.26em] text-white/65 sm:block">
                            {walletLabel}
                        </div>
                        <Button
                            variant="secondary"
                            size="sm"
                            onClick={disconnectWallet}
                            leftIcon={<LogOut className="h-3.5 w-3.5" />}
                            className="h-8 rounded-full border border-white/10 bg-white/[0.04] px-4 text-[11px] text-white/80 hover:bg-white/[0.08]"
                        >
                            Disconnect
                        </Button>
                    </div>
                </div>
            </header>

            <main className="relative mx-auto grid max-w-7xl gap-8 px-6 py-4 lg:min-h-[calc(100vh-3.5rem)] lg:grid-cols-[1fr_1fr] lg:items-center">
                <motion.div
                    initial={{ opacity: 0, y: 24 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.55 }}
                    className="space-y-4"
                >
                    <div className="inline-flex items-center gap-2 rounded-full border border-amber-200/20 bg-white/5 px-3 py-1.5 text-[10px] uppercase tracking-[0.3em] text-amber-100/85">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                        Onboarding step
                    </div>

                    <div>
                        <div className="premium-script text-3xl text-amber-200 sm:text-4xl">Next Step</div>
                        <h1 className="premium-heading mt-2 text-3xl leading-tight text-white sm:text-4xl lg:text-3xl">
                            Choose how this wallet enters SealRFQ.
                        </h1>
                        <p className="mt-3 max-w-xl text-sm leading-relaxed text-white/70">
                            The wallet is authenticated. Now select the role that should receive the current session and dashboard routing.
                        </p>
                    </div>

                    <div className="premium-panel rounded-2xl p-4 sm:p-5">
                        <div className="text-[10px] uppercase tracking-[0.3em] text-emerald-200/70">Session Status</div>
                        <div className="mt-2 premium-heading text-lg text-white">Wallet challenge complete.</div>
                        <p className="mt-2 text-[13px] leading-relaxed text-white/65">
                            Selecting a role will call the same switch-role action and continue to the current dashboard flow.
                        </p>

                        <div className="mt-4 space-y-2">
                            <div className="flex items-start gap-2 text-[12px] text-white/70">
                                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-300" />
                                Switch roles later from the app chrome.
                            </div>
                            <div className="flex items-start gap-2 text-[12px] text-white/70">
                                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-300" />
                                Act as both buyer and vendor with same wallet.
                            </div>
                        </div>
                    </div>

                    <div className="premium-panel relative min-h-[10rem] overflow-hidden rounded-2xl">
                        <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: "url('/images/image.png')" }} />
                        <div className="absolute inset-0 bg-gradient-to-t from-[#141414] via-[#141414]/35 to-[#141414]/35" />
                        <div className="absolute inset-x-0 bottom-0 p-4">
                            <div className="rounded-xl border border-white/10 bg-black/30 p-4 backdrop-blur-md">
                                <div className="text-[10px] uppercase tracking-[0.3em] text-amber-100/70">Connected Wallet</div>
                                <div className="mt-1 break-all text-[12px] leading-relaxed text-white/70">{walletAddress}</div>
                            </div>
                        </div>
                    </div>
                </motion.div>

                <div className="space-y-4">
                    {roleOptions.map((option, index) => (
                        <RoleCard
                            key={option.id}
                            title={option.title}
                            eyebrow={option.eyebrow}
                            description={option.description}
                            image={option.image}
                            icon={option.icon}
                            features={option.features}
                            onClick={() => handleSelect(option.id)}
                            loading={switchingRole && selected === option.id}
                            disabled={switchingRole}
                            delay={0.1 + index * 0.1}
                        />
                    ))}
                </div>
            </main>
        </div>
    );
}

function RoleCard({
    eyebrow,
    title,
    description,
    icon,
    image,
    features,
    onClick,
    loading,
    disabled,
    delay = 0,
}: {
    eyebrow: string;
    title: string;
    description: string;
    icon: LucideIcon;
    image: string;
    features: string[];
    onClick: () => void;
    loading: boolean;
    disabled: boolean;
    delay?: number;
}) {
    const Icon = icon;

    return (
        <motion.button
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay, duration: 0.5 }}
            onClick={onClick}
            disabled={disabled}
            className={cn(
                'premium-panel group relative overflow-hidden rounded-2xl p-5 text-left transition-all duration-300',
                'cursor-pointer hover:-translate-y-1 hover:border-amber-200/30',
                'focus:outline-none focus:ring-2 focus:ring-amber-200/30',
                'disabled:opacity-50 disabled:cursor-wait',
            )}
        >
            <div className="absolute inset-0 bg-cover bg-center opacity-30 transition-transform duration-700 group-hover:scale-105" style={{ backgroundImage: `url('${image}')` }} />
            <div className="absolute inset-0 bg-gradient-to-r from-[#141414] via-[#141414]/92 to-[#141414]/70" />
            <div className="absolute inset-0 rounded-[2rem] bg-gradient-to-br from-amber-200/5 to-transparent opacity-0 transition-opacity duration-500 group-hover:opacity-100" />

            <div className="relative z-10 space-y-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-amber-200/20 bg-amber-100/10 text-amber-100 transition-all duration-300 group-hover:scale-105">
                    <Icon className="h-5 w-5" />
                </div>

                <div>
                    <div className="text-[10px] uppercase tracking-[0.28em] text-emerald-200/70">{eyebrow}</div>
                    <h2 className="premium-heading mt-1 text-xl text-white">{title}</h2>
                    <p className="mt-1 text-[12px] leading-relaxed text-white/65">{description}</p>
                </div>

                <ul className="grid grid-cols-2 gap-x-4 gap-y-1">
                    {features.map((feature) => (
                        <li key={feature} className="flex items-center gap-1.5 text-[11px] text-white/60">
                            <span className="h-1 w-1 rounded-full bg-emerald-300/50" />
                            {feature}
                        </li>
                    ))}
                </ul>

                <div className="flex items-center gap-2 pt-1 text-[13px] font-medium text-amber-100 transition-all duration-300 group-hover:gap-3">
                    {loading ? (
                        <span className="flex items-center gap-2">
                            <span className="h-3 w-3 rounded-full border-2 border-amber-100/20 border-t-amber-100 animate-spin" />
                            Configuring...
                        </span>
                    ) : (
                        <>
                            Get Started <ArrowRight className="h-4 w-4" />
                        </>
                    )}
                </div>
            </div>
        </motion.button>
    );
}
