'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowRight, ChevronLeft, ChevronRight, Clock, ShieldCheck, Sparkles, type LucideIcon } from 'lucide-react';
import { auctionShowcaseConfig } from '@/lib/premiumLandingConfig';

const iconMap: Record<string, LucideIcon> = {
    Sparkles,
    Clock,
    ShieldCheck,
};

export function AuctionShowcase() {
    const [activeItem, setActiveItem] = useState(0);
    const sectionRef = useRef<HTMLDivElement>(null);
    const activeAuction = auctionShowcaseConfig.items[activeItem];

    useEffect(() => {
        const observer = new IntersectionObserver(
            (entries) => {
                entries.forEach((entry) => {
                    if (entry.isIntersecting) {
                        entry.target.classList.add('visible');
                    }
                });
            },
            { threshold: 0.1, rootMargin: '0px 0px -10% 0px' }
        );

        const elements = sectionRef.current?.querySelectorAll('.fade-up, .slide-in-left, .slide-in-right');
        elements?.forEach((element) => observer.observe(element));

        return () => observer.disconnect();
    }, []);

    const nextAuction = () => setActiveItem((prev) => (prev + 1) % auctionShowcaseConfig.items.length);
    const previousAuction = () => setActiveItem((prev) => (prev - 1 + auctionShowcaseConfig.items.length) % auctionShowcaseConfig.items.length);

    return (
        <section id="auctions" ref={sectionRef} className="section-padding relative overflow-hidden">
            <div className="absolute inset-0 opacity-5">
                <div
                    className="absolute inset-0"
                    style={{
                        backgroundImage: 'radial-gradient(circle at 2px 2px, rgba(16,185,129,0.9) 1px, transparent 0)',
                        backgroundSize: '40px 40px',
                    }}
                />
            </div>

            <div className="container-custom relative">
                <div className="fade-up mb-16 text-center">
                    <span className="premium-script mb-2 block text-3xl text-emerald-300">{auctionShowcaseConfig.scriptText}</span>
                    <span className="mb-4 block text-xs uppercase tracking-[0.2em] text-emerald-500">{auctionShowcaseConfig.subtitle}</span>
                    <h2 className="premium-heading text-4xl text-white sm:text-5xl lg:text-6xl">{auctionShowcaseConfig.mainTitle}</h2>
                </div>

                <div className="fade-up mb-16 flex flex-wrap justify-center gap-2" style={{ transitionDelay: '0.1s' }}>
                    {auctionShowcaseConfig.items.map((item, index) => (
                        <button
                            key={item.id}
                            onClick={() => setActiveItem(index)}
                            className={`rounded-sm px-6 py-3 text-sm transition-all duration-300 ${
                                index === activeItem
                                    ? 'bg-emerald-500 text-white'
                                    : 'border border-white/10 bg-white/5 text-white/70 hover:bg-white/10'
                            }`}
                        >
                            {item.name}
                        </button>
                    ))}
                </div>

                <div className="grid items-center gap-8 lg:grid-cols-5 lg:gap-12">
                    <div className="slide-in-left order-2 lg:order-1 lg:col-span-2">
                        <div className="mb-8">
                            <div className="mb-3 flex items-baseline gap-4">
                                <span className="premium-heading text-5xl leading-none text-emerald-500/30 sm:text-6xl lg:text-7xl">{activeAuction.year}</span>
                                <div>
                                    <h3 className="premium-heading text-3xl text-white sm:text-4xl">{activeAuction.name}</h3>
                                    <span className="premium-script text-xl text-emerald-300">{activeAuction.subtitle}</span>
                                </div>
                            </div>
                            <div className="mt-4 h-px w-16 bg-emerald-500" />
                        </div>

                        <p className="mb-4 leading-relaxed text-white/85">{activeAuction.description}</p>
                        <p className="mb-8 text-sm leading-relaxed text-white/65">{activeAuction.detail}</p>

                        <div className="mb-8 flex gap-6">
                            <MetricBlock label="Speed" value={activeAuction.statA} />
                            <div className="w-px bg-white/10" />
                            <MetricBlock label="Privacy" value={activeAuction.statB} />
                            <div className="w-px bg-white/10" />
                            <MetricBlock label="Settlement" value={activeAuction.statC} />
                        </div>

                        <button
                            onClick={() => {
                                const element = document.querySelector('#security');
                                if (element) {
                                    element.scrollIntoView({ behavior: 'smooth' });
                                }
                            }}
                            className="inline-flex items-center gap-2 rounded-sm bg-emerald-500 px-6 py-3 text-sm font-medium text-white transition-all duration-300 hover:bg-emerald-400"
                        >
                            {auctionShowcaseConfig.ctaButtonText}
                            <ArrowRight className="h-4 w-4" />
                        </button>
                    </div>

                    <div className="order-1 flex justify-center lg:order-2 lg:col-span-1">
                        <div className="relative" style={{ width: '220px', height: '520px' }}>
                            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                                <div className={`h-48 w-48 rounded-full blur-3xl transition-colors duration-700 ${activeAuction.glowClass}`} />
                            </div>

                            {auctionShowcaseConfig.items.map((item, index) => (
                                <img
                                    key={item.id}
                                    src={item.image}
                                    alt={`${item.name} illustration`}
                                    loading={index === 0 ? undefined : 'lazy'}
                                    style={item.filter ? { filter: item.filter } : undefined}
                                    className={`absolute inset-0 z-10 h-full w-full object-contain drop-shadow-2xl transition-all duration-700 ${
                                        index === activeItem
                                            ? 'translate-y-0 scale-100 opacity-100'
                                            : index < activeItem
                                              ? 'pointer-events-none -translate-y-6 scale-90 opacity-0'
                                              : 'pointer-events-none translate-y-6 scale-90 opacity-0'
                                    }`}
                                />
                            ))}

                            <div className="absolute -bottom-12 left-1/2 z-20 flex -translate-x-1/2 items-center gap-4">
                                <button
                                    onClick={previousAuction}
                                    className="flex h-9 w-9 items-center justify-center rounded-full border border-white/20 bg-white/10 text-white transition-all duration-300 hover:border-emerald-500 hover:bg-emerald-500"
                                    aria-label="Previous auction type"
                                >
                                    <ChevronLeft className="h-4 w-4" />
                                </button>
                                <span className="premium-heading whitespace-nowrap text-sm tabular-nums text-white/50">
                                    {activeItem + 1} / {auctionShowcaseConfig.items.length}
                                </span>
                                <button
                                    onClick={nextAuction}
                                    className="flex h-9 w-9 items-center justify-center rounded-full border border-white/20 bg-white/10 text-white transition-all duration-300 hover:border-emerald-500 hover:bg-emerald-500"
                                    aria-label="Next auction type"
                                >
                                    <ChevronRight className="h-4 w-4" />
                                </button>
                            </div>
                        </div>
                    </div>

                    <div className="slide-in-right order-3 lg:col-span-2">
                        <div className="space-y-6">
                            {auctionShowcaseConfig.features.map((feature) => {
                                const Icon = iconMap[feature.icon] ?? Sparkles;

                                return (
                                    <div key={feature.title} className="group flex items-start gap-4">
                                        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/5 transition-colors group-hover:border-emerald-500/30">
                                            <Icon className="h-5 w-5 text-emerald-500" />
                                        </div>
                                        <div>
                                            <h4 className="premium-heading mb-1 text-2xl text-white">{feature.title}</h4>
                                            <p className="text-sm leading-relaxed text-white/65">{feature.description}</p>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        <div className="mt-10 rounded-lg border-l-2 border-emerald-500/50 bg-white/[0.03] p-6">
                            <p className="premium-script mb-2 text-2xl text-emerald-300">{auctionShowcaseConfig.quote.prefix}</p>
                            <p className="text-sm italic leading-relaxed text-white/70">"{auctionShowcaseConfig.quote.text}"</p>
                            <p className="mt-3 text-xs text-emerald-500">- {auctionShowcaseConfig.quote.attribution}</p>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
}

function MetricBlock({ label, value }: { label: string; value: string }) {
    return (
        <div>
            <div className="premium-heading text-2xl text-emerald-500">{value}</div>
            <div className="mt-1 text-[11px] uppercase tracking-wider text-white/50">{label}</div>
        </div>
    );
}
