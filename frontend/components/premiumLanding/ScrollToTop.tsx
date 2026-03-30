'use client';

import { useEffect, useState } from 'react';
import { ArrowUp } from 'lucide-react';
import { scrollToTopConfig } from '@/lib/premiumLandingConfig';

export function ScrollToTop() {
    const [isVisible, setIsVisible] = useState(false);

    useEffect(() => {
        const handleScroll = () => {
            setIsVisible(window.scrollY > 600);
        };

        window.addEventListener('scroll', handleScroll, { passive: true });
        return () => window.removeEventListener('scroll', handleScroll);
    }, []);

    return (
        <button
            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
            aria-label={scrollToTopConfig.ariaLabel}
            className={`fixed bottom-8 right-8 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/90 text-white shadow-lg shadow-emerald-500/20 backdrop-blur-sm transition-all duration-300 hover:scale-110 hover:bg-emerald-500 ${
                isVisible ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-4 opacity-0'
            }`}
        >
            <ArrowUp className="h-5 w-5" />
        </button>
    );
}
