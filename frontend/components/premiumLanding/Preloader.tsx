'use client';

import { useEffect, useState } from 'react';
import { Shield } from 'lucide-react';
import { preloaderConfig } from '@/lib/premiumLandingConfig';

export function Preloader({ onComplete }: { onComplete: () => void }) {
    const [phase, setPhase] = useState<'loading' | 'fading'>('loading');

    useEffect(() => {
        const fadeTimer = window.setTimeout(() => setPhase('fading'), 2200);
        const completeTimer = window.setTimeout(() => onComplete(), 2800);

        return () => {
            window.clearTimeout(fadeTimer);
            window.clearTimeout(completeTimer);
        };
    }, [onComplete]);

    return (
        <div
            className={`fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-[#0a0a0a] transition-opacity duration-600 ${
                phase === 'fading' ? 'opacity-0' : 'opacity-100'
            }`}
        >
            <div className="preloader-text mb-6">
                <Shield className="h-12 w-12 text-emerald-500" />
            </div>

            <div className="preloader-text text-center" style={{ animationDelay: '0.2s' }}>
                <h1 className="premium-heading mb-2 text-3xl tracking-wide text-white md:text-4xl">{preloaderConfig.brandName}</h1>
                <p className="premium-script text-2xl text-emerald-300">{preloaderConfig.brandSubname}</p>
            </div>

            <div className="mt-8 h-px w-48 overflow-hidden bg-white/10">
                <div className="preloader-line h-full bg-gradient-to-r from-emerald-500/50 via-emerald-500 to-emerald-500/50" />
            </div>

            <p className="preloader-text mt-4 text-xs uppercase tracking-[0.3em] text-white/40" style={{ animationDelay: '0.4s' }}>
                {preloaderConfig.yearText}
            </p>
        </div>
    );
}
