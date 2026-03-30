'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { heroConfig } from '@/lib/premiumLandingConfig';

function useCountUp(target: number, duration = 2000, start = false) {
    const [count, setCount] = useState(0);
    const hasRun = useRef(false);

    useEffect(() => {
        if (!start || hasRun.current) return;
        hasRun.current = true;

        const startTime = performance.now();
        const step = (now: number) => {
            const elapsed = now - startTime;
            const progress = Math.min(elapsed / duration, 1);
            const eased = 1 - Math.pow(1 - progress, 3);
            setCount(Math.floor(eased * target));

            if (progress < 1) {
                requestAnimationFrame(step);
            }
        };

        requestAnimationFrame(step);
    }, [duration, start, target]);

    return count;
}

export function Hero({
    isReady,
    onConnect,
    connecting = false,
}: {
    isReady: boolean;
    onConnect: () => void | Promise<void>;
    connecting?: boolean;
}) {
    const [phase, setPhase] = useState(0);
    const titleLines = heroConfig.mainTitle.split('\n');
    const counts = [
        useCountUp(heroConfig.stats[0]?.value ?? 0, 2000, phase >= 4),
        useCountUp(heroConfig.stats[1]?.value ?? 0, 2200, phase >= 4),
        useCountUp(heroConfig.stats[2]?.value ?? 0, 1800, phase >= 4),
    ];

    useEffect(() => {
        if (!isReady) return;

        const timers = [
            window.setTimeout(() => setPhase(1), 100),
            window.setTimeout(() => setPhase(2), 800),
            window.setTimeout(() => setPhase(3), 1400),
            window.setTimeout(() => setPhase(4), 2000),
        ];

        return () => {
            timers.forEach((timer) => window.clearTimeout(timer));
        };
    }, [isReady]);

    const scrollToAuctions = () => {
        const element = document.querySelector('#auctions');
        if (element) {
            element.scrollIntoView({ behavior: 'smooth' });
        }
    };

    return (
        <section id="hero" className="relative flex min-h-screen flex-col justify-center overflow-hidden pb-32 pt-20 md:pt-24">
            <div className={`absolute inset-0 transition-opacity duration-[1500ms] ease-out ${phase >= 1 ? 'opacity-100' : 'opacity-0'}`}>
                <div className="hero-kenburns absolute inset-0">
                    <img src={heroConfig.backgroundImage} alt="SealRFQ landing background" className="h-full w-full scale-105 object-cover" />
                </div>
                <div className="absolute inset-0 bg-gradient-to-b from-black/50 via-black/30 to-black/70" />
            </div>

            <div className="container-custom relative z-10 flex flex-col items-center text-center">
                <div className={`mb-4 transition-all duration-1000 ease-out ${phase >= 2 ? 'translate-y-0 opacity-100' : 'translate-y-6 opacity-0'}`}>
                    <img
                        src={heroConfig.brandImage}
                        alt="SealRFQ brand mark"
                        className="h-28 w-28 object-contain drop-shadow-[0_0_15px_rgba(16,185,129,0.35)] md:h-36 md:w-36 lg:h-44 lg:w-44"
                    />
                </div>

                <div className={`transition-all duration-1000 ease-out ${phase >= 2 ? 'translate-y-0 opacity-100' : 'translate-y-6 opacity-0'}`}>
                    <span className="premium-script text-5xl text-emerald-300 md:text-6xl lg:text-7xl">{heroConfig.scriptText}</span>
                </div>

                <div
                    className={`mx-auto my-4 h-px bg-emerald-500/50 transition-all duration-1000 ease-out ${phase >= 2 ? 'w-24 opacity-100' : 'w-0 opacity-0'}`}
                    style={{ transitionDelay: '0.2s' }}
                />

                <h1
                    className={`premium-heading text-4xl leading-[1.05] text-white transition-all duration-1000 ease-out sm:text-5xl lg:text-6xl xl:text-7xl ${phase >= 2 ? 'translate-y-0 opacity-100' : 'translate-y-8 opacity-0'}`}
                    style={{ transitionDelay: '0.3s' }}
                >
                    {titleLines.map((line) => (
                        <span key={line} className="block">
                            {line}
                        </span>
                    ))}
                </h1>

                <div className={`mt-6 transition-all duration-700 ease-out ${phase >= 3 ? 'translate-y-0 opacity-100' : 'translate-y-6 opacity-0'}`}>
                    <Button
                        size="lg"
                        onClick={() => {
                            void onConnect();
                        }}
                        isLoading={connecting}
                        rightIcon={<ArrowRight className="h-4 w-4" />}
                        className="rounded-sm border border-emerald-400/30 bg-emerald-500 px-8 text-white shadow-[0_18px_50px_rgba(16,185,129,0.22)] hover:bg-emerald-400"
                    >
                        {heroConfig.ctaButtonText}
                    </Button>
                </div>

                <div className={`mt-10 w-full transition-all duration-1000 ease-out lg:mt-14 ${phase >= 4 ? 'translate-y-0 opacity-100' : 'translate-y-6 opacity-0'}`}>
                    <div className="mx-auto grid max-w-2xl gap-4 md:grid-cols-3">
                        {heroConfig.stats.map((stat, index) => (
                            <div key={stat.label} className={`text-center px-4 ${index > 0 ? 'md:border-l md:border-white/15' : ''}`}>
                                <div className="premium-heading mb-1 text-3xl tabular-nums text-emerald-400">
                                    {counts[index]}{stat.suffix}
                                </div>
                                <div className="text-[10px] uppercase tracking-widest text-white/60 leading-tight">{stat.label}</div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            <div className={`absolute bottom-8 left-1/2 z-20 -translate-x-1/2 transition-all delay-700 duration-1000 ease-out md:bottom-12 ${phase >= 4 ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'}`}>
                <button onClick={scrollToAuctions} className="group flex cursor-pointer flex-col items-center gap-2" aria-label="Scroll down to auction types">
                    <span className="text-[10px] uppercase tracking-[0.3em] text-white/40 transition-colors duration-300 group-hover:text-emerald-300">
                        Scroll To Explore
                    </span>
                    <div className="flex h-10 w-6 justify-center rounded-full border border-white/20 p-1.5 transition-colors duration-300 group-hover:border-emerald-400/50">
                        <div className="h-3 w-1 animate-bounce rounded-full bg-emerald-400" />
                    </div>
                </button>
            </div>

            <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-[#141414] to-transparent" />

            <div className={`absolute left-8 top-1/2 hidden -translate-y-1/2 flex-col items-center gap-4 transition-opacity duration-1000 lg:flex ${phase >= 3 ? 'opacity-100' : 'opacity-0'}`}>
                <div className="h-20 w-px bg-gradient-to-b from-transparent via-emerald-500/50 to-transparent" />
                <span className="text-xs tracking-widest text-emerald-500" style={{ writingMode: 'vertical-lr' }}>
                    {heroConfig.decorativeText}
                </span>
                <div className="h-20 w-px bg-gradient-to-b from-transparent via-emerald-500/50 to-transparent" />
            </div>
        </section>
    );
}
