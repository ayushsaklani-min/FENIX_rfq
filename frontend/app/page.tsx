'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useWallet } from '@/contexts/WalletContext';
import { Hero } from '@/sections/premiumLanding/Hero';
import { AuctionShowcase } from '@/sections/premiumLanding/AuctionShowcase';
import { HowItWorksCarousel } from '@/sections/premiumLanding/HowItWorksCarousel';
import { SecurityShowcase } from '@/sections/premiumLanding/SecurityShowcase';
import { Preloader } from '@/components/premiumLanding/Preloader';
import { ScrollToTop } from '@/components/premiumLanding/ScrollToTop';

export default function HomePage() {
    const router = useRouter();
    const { ready, sessionHydrating, walletAddress, role, connectWallet, connecting } = useWallet();
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        if (!ready || sessionHydrating || !walletAddress) return;

        if (!role || role === 'NEW_USER') {
            router.replace('/select-role');
            return;
        }

        router.replace('/dashboard');
    }, [ready, sessionHydrating, walletAddress, role, router]);

    const handlePreloaderComplete = useCallback(() => {
        setIsLoading(false);
    }, []);

    const handleConnect = useCallback(async () => {
        const connected = await connectWallet();
        if (connected) {
            router.push('/select-role');
        }
    }, [connectWallet, router]);

    if (!ready || sessionHydrating) {
        return <div className="-mt-16 min-h-screen bg-[#141414]" />;
    }

    if (walletAddress) {
        return <div className="-mt-16 min-h-screen bg-[#141414]" />;
    }

    const isReady = !isLoading;

    return (
        <>
            {isLoading && <Preloader onComplete={handlePreloaderComplete} />}

            <div className={`premium-copy relative -mt-16 min-h-screen overflow-hidden bg-[#141414] text-white ${isLoading ? 'max-h-screen overflow-hidden' : ''}`}>
                {isReady && (
                    <main className="fade-in relative z-10 min-h-screen w-full overflow-hidden">
                        <Hero isReady={isReady} onConnect={handleConnect} connecting={connecting} />
                        <AuctionShowcase />
                        <HowItWorksCarousel />
                        <SecurityShowcase />
                    </main>
                )}
                <ScrollToTop />
            </div>
        </>
    );
}
