/**
 * Client-Side Role Guards
 * 
 * Gate 3: Role-based route and action guards (client-side)
 */

'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { authenticatedFetch } from './authFetch';
import { safeGetItem } from './safeLocalStorage';

export type UserRole = 'BUYER' | 'VENDOR' | 'AUDITOR' | 'NEW_USER' | null;

interface User {
    walletAddress: string;
    role: UserRole;
}

// Role-based route protection
export function useRoleGuard(allowedRoles: UserRole[]) {
    const router = useRouter();
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);
    const [authorized, setAuthorized] = useState(false);

    useEffect(() => {
        const checkAuth = async () => {
            try {
                const accessToken = safeGetItem('accessToken');

                if (!accessToken) {
                    router.push('/login');
                    return;
                }

                // Fetch user role from backend
                const response = await authenticatedFetch('/api/auth/me');

                if (!response.ok) {
                    router.push('/login');
                    return;
                }

                const data = await response.json();
                const userRole = data.data.role;

                setUser({ walletAddress: data.data.walletAddress, role: userRole });

                // Check if user has required role
                if (!allowedRoles.includes(userRole)) {
                    const attemptedPath =
                        typeof window !== 'undefined'
                            ? `${window.location.pathname}${window.location.search}`
                            : '/dashboard';
                    router.push(`/unauthorized?from=${encodeURIComponent(attemptedPath)}`);
                    return;
                }

                setAuthorized(true);
                setLoading(false);
            } catch (error) {
                router.push('/login');
            }
        };

        checkAuth();
    }, [allowedRoles, router]);

    return { user, loading, authorized };
}

// HOC for role-protected pages
export function withRoleGuard<P extends object>(
    Component: React.ComponentType<P>,
    allowedRoles: UserRole[]
) {
    return function ProtectedComponent(props: P) {
        const { user, loading, authorized } = useRoleGuard(allowedRoles);

        if (loading) {
            return <div className="loading">Checking authorization...</div>;
        }

        if (!authorized) {
            return null; // Will redirect
        }

        return <Component {...props} user={user} />;
    };
}

// Action-level guards
export function canPerformAction(
    userRole: UserRole,
    action: string,
    context?: any
): { allowed: boolean; reason?: string } {
    const actionRules: Record<string, UserRole[]> = {
        'create_rfq': ['BUYER', 'NEW_USER'],
        'select_winner': ['BUYER'],
        'cancel_rfq_post_deadline': ['BUYER', 'VENDOR', 'NEW_USER'],
        'fund_escrow': ['BUYER'],
        'release_partial_payment': ['BUYER'],
        'release_final_payment': ['BUYER'],
        'pay_invoice': ['BUYER'],
        'configure_platform': ['BUYER'],
        'import_auction_result': ['BUYER'],

        'submit_bid': ['VENDOR', 'NEW_USER'],
        'reveal_bid': ['VENDOR', 'NEW_USER'],
        'winner_respond': ['VENDOR', 'NEW_USER'],
        'refund_any_stake': ['VENDOR', 'NEW_USER'],

        'view_audit_trail': ['BUYER', 'VENDOR', 'AUDITOR'],
        'export_audit': ['AUDITOR'],
    };

    const allowedRoles = actionRules[action];

    if (!allowedRoles) {
        return { allowed: false, reason: 'Unknown action' };
    }

    if (!userRole) {
        return { allowed: false, reason: 'Not authenticated' };
    }

    if (!allowedRoles.includes(userRole)) {
        return {
            allowed: false,
            reason: `Action '${action}' requires role: ${allowedRoles.join(' or ')}. You have: ${userRole}`
        };
    }

    return { allowed: true };
}

// Role display component
export function RoleBadge({ role }: { role: UserRole }) {
    if (!role) return null;

    const badgeStyles: Record<string, string> = {
        BUYER: 'bg-blue-500 text-white',
        VENDOR: 'bg-green-500 text-white',
        AUDITOR: 'bg-sky-500 text-white',
        NEW_USER: 'bg-gray-500 text-white',
    };

    return (
        <span className={`role-badge ${badgeStyles[role] || ''}`}>
            {role}
        </span>
    );
}
