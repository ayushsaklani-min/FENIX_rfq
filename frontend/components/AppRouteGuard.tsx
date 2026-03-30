'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useWallet } from '@/contexts/WalletContext';

const PUBLIC_PATHS = new Set(['/', '/privacy', '/terms', '/unauthorized', '/login']);
const ROLE_SELECTION_PATH = '/select-role';

export default function AppRouteGuard({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    const router = useRouter();
    const { ready, walletAddress, role } = useWallet();

    const isPublicPath = PUBLIC_PATHS.has(pathname);
    const isRoleSelectionPath = pathname === ROLE_SELECTION_PATH;

    useEffect(() => {
        if (!ready) return;

        if (!walletAddress) {
            if (!isPublicPath) {
                router.replace('/');
            }
            return;
        }

        if ((!role || role === 'NEW_USER') && !isPublicPath && !isRoleSelectionPath) {
            router.replace(ROLE_SELECTION_PATH);
            return;
        }

        if (walletAddress && role && role !== 'NEW_USER' && isRoleSelectionPath) {
            router.replace('/dashboard');
        }
    }, [isPublicPath, isRoleSelectionPath, ready, role, router, walletAddress]);

    if (!ready) {
        return isPublicPath ? <>{children}</> : <div className="min-h-screen" />;
    }

    if (!walletAddress) {
        return isPublicPath ? <>{children}</> : <div className="min-h-screen" />;
    }

    if ((!role || role === 'NEW_USER') && !isPublicPath && !isRoleSelectionPath) {
        return <div className="min-h-screen" />;
    }

    return <>{children}</>;
}
