'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Dashboard from '@/components/Dashboard';
import { useWallet } from '@/contexts/WalletContext';

export default function DashboardPage() {
    const router = useRouter();
    const { ready, sessionHydrating, walletAddress, role, switchingRole } = useWallet();

    useEffect(() => {
        if (!ready || sessionHydrating || switchingRole) return;
        if (!walletAddress) {
            router.replace('/');
            return;
        }
        if (!role || role === 'NEW_USER') {
            router.replace('/select-role');
        }
    }, [ready, sessionHydrating, switchingRole, router, walletAddress, role]);

    if (!ready || sessionHydrating || switchingRole || !walletAddress || !role || role === 'NEW_USER') {
        return <div className="min-h-screen" />;
    }

    return <Dashboard />;
}
