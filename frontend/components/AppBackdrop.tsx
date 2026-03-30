'use client';

import { usePathname } from 'next/navigation';

const HIDDEN_PATHS = new Set(['/', '/select-role']);

export default function AppBackdrop() {
    const pathname = usePathname();

    if (HIDDEN_PATHS.has(pathname)) {
        return null;
    }

    return (
        <div className="premium-shell premium-copy pointer-events-none fixed inset-0 z-0 overflow-hidden">
            <div className="premium-grid absolute inset-0 opacity-30" />
            <div className="premium-orb absolute left-[-10rem] top-16 h-80 w-80 rounded-full bg-emerald-500/10 blur-[140px]" />
            <div
                className="premium-orb absolute right-[-8rem] top-[20rem] h-96 w-96 rounded-full bg-amber-300/10 blur-[150px]"
                style={{ animationDelay: '-7s' }}
            />
        </div>
    );
}
