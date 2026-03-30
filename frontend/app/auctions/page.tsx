import Link from 'next/link';
import { PageHeader, PageShell } from '@/components/protocol/ProtocolPrimitives';
import { ArrowRight, Gavel, TrendingDown } from 'lucide-react';

const cards = [
    {
        href: '/auctions/vickrey',
        title: 'Vickrey Auction',
        eyebrow: 'Sealed bid · Second price',
        description: 'Sealed bids. The lowest-price bidder wins but pays the second-lowest price — encouraging honest bidding.',
        detail: 'Best for sealed competition where price discovery matters before importing into an RFQ.',
        icon: Gavel,
        iconBg: 'bg-blue-400/15 border border-blue-300/25',
        iconColor: 'text-blue-200',
        gradientFrom: 'from-blue-500/10',
    },
    {
        href: '/auctions/dutch',
        title: 'Dutch Auction',
        eyebrow: 'Descending price · Fast fill',
        description: 'Price falls block by block until a bidder accepts. First to accept wins at that price.',
        detail: 'Best when speed of settlement matters more than hidden price discovery.',
        icon: TrendingDown,
        iconBg: 'bg-amber-400/15 border border-amber-300/25',
        iconColor: 'text-amber-200',
        gradientFrom: 'from-amber-500/10',
    },
];

export default function AuctionsPage() {
    return (
        <PageShell className="space-y-6">
            <PageHeader
                eyebrow="Auctions"
                title="Choose an auction type"
                description="Both auction types can be linked to an RFQ and imported back into the settlement flow once resolved."
            />

            <div className="grid gap-5 md:grid-cols-2">
                {cards.map((card) => (
                    <Link
                        key={card.title}
                        href={card.href}
                        className={`group relative overflow-hidden rounded-2xl border border-white/12 bg-gradient-to-br ${card.gradientFrom} to-transparent p-6 transition-all duration-300 hover:-translate-y-1 hover:border-white/25 hover:shadow-[0_16px_48px_rgba(0,0,0,0.4)]`}
                    >
                        <div className="absolute inset-0 bg-white/[0.03] opacity-0 transition-opacity group-hover:opacity-100" />
                        <div className="relative z-10 space-y-4">
                            <div className="flex items-start justify-between">
                                <div className={`flex h-12 w-12 items-center justify-center rounded-xl ${card.iconBg}`}>
                                    <card.icon className={`h-6 w-6 ${card.iconColor}`} />
                                </div>
                                <ArrowRight className="h-5 w-5 text-white/30 transition-all duration-300 group-hover:translate-x-1 group-hover:text-white/70" />
                            </div>
                            <div>
                                <div className="text-[10px] font-semibold uppercase tracking-[0.26em] text-white/50">{card.eyebrow}</div>
                                <h2 className="mt-1 text-xl font-bold text-white">{card.title}</h2>
                                <p className="mt-2 text-sm leading-6 text-white/70">{card.description}</p>
                            </div>
                            <p className="rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-xs leading-5 text-white/55">{card.detail}</p>
                            <div className="flex items-center gap-2 text-sm font-semibold text-white/80 transition-colors group-hover:text-white">
                                Open {card.title} <ArrowRight className="h-4 w-4" />
                            </div>
                        </div>
                    </Link>
                ))}
            </div>
        </PageShell>
    );
}
