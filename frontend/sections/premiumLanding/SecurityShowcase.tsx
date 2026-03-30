'use client';

import { useEffect, useRef, useState } from 'react';
import { Award, BookOpen, History, type LucideIcon } from 'lucide-react';
import { securityShowcaseConfig } from '@/lib/premiumLandingConfig';

const iconMap: Record<string, LucideIcon> = {
    History,
    Award,
    BookOpen,
};

export function SecurityShowcase() {
    const [activeTab, setActiveTab] = useState(securityShowcaseConfig.tabs[0]?.id ?? '');
    const sectionRef = useRef<HTMLDivElement>(null);
    const activeTabData = securityShowcaseConfig.tabs.find((tab) => tab.id === activeTab) ?? securityShowcaseConfig.tabs[0];

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

    return (
        <section id="security" ref={sectionRef} className="section-padding relative overflow-hidden">
            <div className="absolute right-0 top-0 h-full w-1/3 bg-gradient-to-l from-emerald-500/5 to-transparent" />

            <div className="container-custom relative">
                <div className="grid gap-12 lg:grid-cols-2 lg:gap-20">
                    <div>
                        <div className="slide-in-left mb-10">
                            <span className="premium-script mb-2 block text-3xl text-emerald-300">{securityShowcaseConfig.scriptText}</span>
                            <span className="mb-4 block text-xs uppercase tracking-[0.2em] text-emerald-500">{securityShowcaseConfig.subtitle}</span>
                            <h2 className="premium-heading has-bar text-4xl text-white sm:text-5xl lg:text-6xl">{securityShowcaseConfig.mainTitle}</h2>
                        </div>

                        <p className="fade-up mb-10 leading-relaxed text-white/75" style={{ transitionDelay: '0.1s' }}>
                            {securityShowcaseConfig.introText}
                        </p>

                        <div className="fade-up mb-8 flex flex-wrap gap-2" style={{ transitionDelay: '0.15s' }}>
                            {securityShowcaseConfig.tabs.map((tab) => {
                                const Icon = iconMap[tab.icon];

                                return (
                                    <button
                                        key={tab.id}
                                        onClick={() => setActiveTab(tab.id)}
                                        aria-pressed={activeTab === tab.id}
                                        className={`flex items-center gap-2 rounded-sm px-4 py-2.5 text-sm transition-all duration-300 ${
                                            activeTab === tab.id
                                                ? 'bg-emerald-500 text-white'
                                                : 'border border-white/10 bg-white/5 text-white/70 hover:bg-white/10'
                                        }`}
                                    >
                                        {Icon ? <Icon className="h-4 w-4" /> : null}
                                        {tab.name}
                                    </button>
                                );
                            })}
                        </div>

                        <div className="fade-up" style={{ transitionDelay: '0.2s' }}>
                            <div className="rounded-lg border border-white/10 bg-white/5 p-6 transition-all duration-300">
                                <h3 className="premium-heading mb-4 text-2xl text-white sm:text-3xl">{activeTabData.content.title}</h3>
                                <p className="mb-4 leading-relaxed text-white/75">{activeTabData.content.description}</p>
                                <div className="flex items-center gap-3 text-emerald-500">
                                    <div className="h-px w-8 bg-emerald-500" />
                                    <span className="text-sm font-medium">{activeTabData.content.highlight}</span>
                                </div>
                            </div>
                        </div>

                        <div className="fade-up mt-8" style={{ transitionDelay: '0.25s' }}>
                            <div className="relative">
                                <div className="absolute left-0 right-0 top-3 h-px bg-emerald-500/30" />
                                <div className="flex w-full justify-between">
                                    {securityShowcaseConfig.timeline.map((event) => (
                                        <div key={event.year} className="relative flex flex-1 flex-col items-center px-2">
                                            <div className="z-10 h-2.5 w-2.5 rounded-full border-2 border-emerald-500 bg-[#141414]" />
                                            <span className="premium-heading mt-2 text-lg text-emerald-500">{event.year}</span>
                                            <span className="mt-1 text-center text-[11px] leading-relaxed text-white/60">{event.event}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>

                        <div className="fade-up mt-8 flex items-center gap-6" style={{ transitionDelay: '0.3s' }}>
                            <div className="h-24 w-24 shrink-0 overflow-hidden rounded-lg border-2 border-emerald-500/30 shadow-lg">
                                <img src={securityShowcaseConfig.brandImage} alt={securityShowcaseConfig.brandImageAlt} loading="lazy" className="h-full w-full object-cover" />
                            </div>
                            <div>
                                <p className="premium-script mb-1 text-2xl text-emerald-300">"{securityShowcaseConfig.quote.prefix}"</p>
                                <p className="text-sm italic text-white/70">"{securityShowcaseConfig.quote.text}"</p>
                                <p className="mt-2 text-xs text-emerald-500">- {securityShowcaseConfig.quote.attribution}</p>
                            </div>
                        </div>
                    </div>

                    <div className="slide-in-right relative" style={{ transitionDelay: '0.15s' }}>
                        <div className="relative aspect-[4/5] overflow-hidden rounded-lg">
                            {securityShowcaseConfig.tabs.map((tab) => (
                                <div
                                    key={tab.id}
                                    className={`absolute inset-0 transition-all duration-500 ${
                                        activeTab === tab.id ? 'scale-100 opacity-100' : 'scale-105 opacity-0'
                                    }`}
                                >
                                    <img src={tab.image} alt={tab.name} loading="lazy" className="h-full w-full object-cover" />
                                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-black/20" />
                                </div>
                            ))}

                            <div className="absolute right-6 top-6 flex h-24 w-24 items-center justify-center rounded-full border border-emerald-500/40 bg-black/40 backdrop-blur-sm">
                                <div className="text-center">
                                    <div className="premium-heading text-2xl text-emerald-300">{securityShowcaseConfig.yearBadge}</div>
                                    <div className="text-[10px] uppercase tracking-wider text-white/70">{securityShowcaseConfig.yearBadgeLabel}</div>
                                </div>
                            </div>

                            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-6">
                                <div>
                                    <p className="text-sm text-emerald-400">{securityShowcaseConfig.supportedAssetsLabel}</p>
                                    <p className="text-lg text-white">{securityShowcaseConfig.supportedAssets}</p>
                                </div>
                            </div>
                        </div>

                        <div className="mt-12 flex items-center justify-center opacity-80 transition-opacity hover:opacity-100 lg:mt-16">
                            <img
                                src={securityShowcaseConfig.brandImage}
                                alt="SealRFQ logo"
                                className="h-96 w-96 object-contain drop-shadow-[0_0_15px_rgba(16,185,129,0.35)] lg:h-[400px] lg:w-[400px]"
                            />
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
}
