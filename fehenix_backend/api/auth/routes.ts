/**
 * Auth API Routes
 * 
 * POST /api/auth/challenge - Get nonce challenge
 * POST /api/auth/connect - Verify signature & create session
 * POST /api/auth/refresh - Refresh access token
 * POST /api/auth/logout - Revoke session
 * POST /api/auth/logout-all - Revoke all sessions
 */

import { NextRequest, NextResponse } from 'next/server';
import { AuthService, buildWalletAuthMessage } from '../../auth/service';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { requireAuth } from '../../auth/middleware';

const prisma = new PrismaClient();
const authService = new AuthService(prisma);
const isProductionEnv = process.env.NODE_ENV?.toString() === 'production';

// ============================================================================
// Request/Response Schemas
// ============================================================================

const evmAddress = z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Must be a valid EVM address');

const ChallengeRequestSchema = z.object({
    walletAddress: evmAddress,
});

const ConnectRequestSchema = z.object({
    walletAddress: evmAddress,
    nonce: z.string(),
    signature: z.string(),
});

const RefreshRequestSchema = z.object({
    refreshToken: z.string(),
});

const LogoutRequestSchema = z.object({
    sessionId: z.string(),
});

const LogoutAllRequestSchema = z.object({
    walletAddress: evmAddress,
});

const SwitchRoleSchema = z.object({
    role: z.enum(['BUYER', 'VENDOR']),
});

function clearAuthCookies(response: NextResponse): NextResponse {
    response.cookies.delete('refreshToken');
    response.cookies.delete('accessToken');
    return response;
}

// ============================================================================
// POST /api/auth/challenge
// ============================================================================

export async function handleChallenge(request: NextRequest): Promise<NextResponse> {
    try {
        const body = await request.json();
        const { walletAddress } = ChallengeRequestSchema.parse(body);

        const challenge = await authService.generateNonceChallenge(walletAddress);

        return NextResponse.json({
            status: 'success',
            data: {
                nonce: challenge.nonce,
                expiresAt: challenge.expiresAt.toISOString(),
                message: buildWalletAuthMessage(challenge.nonce),
            },
        });
    } catch (error: any) {
        return NextResponse.json(
            {
                status: 'error',
                error: {
                    code: 'VALIDATION_ERROR',
                    message: error.message || 'Invalid request',
                },
            },
            { status: 400 }
        );
    }
}

// ============================================================================
// POST /api/auth/connect
// ============================================================================

export async function handleConnect(request: NextRequest): Promise<NextResponse> {
    try {
        const body = await request.json();
        const { walletAddress, nonce, signature } = ConnectRequestSchema.parse(body);

        const session = await authService.verifyAndCreateSession(
            walletAddress,
            nonce,
            signature
        );

        // Set httpOnly cookie for refresh token
        const response = NextResponse.json({
            status: 'success',
            data: {
                accessToken: session.accessToken,
                role: session.role,
                walletAddress: session.walletAddress,
                expiresAt: session.accessTokenExpiresAt.toISOString(),
            },
        });

        response.cookies.set('refreshToken', session.refreshToken, {
            httpOnly: true,
            secure: isProductionEnv,
            sameSite: 'strict',
            maxAge: 7 * 24 * 60 * 60, // 7 days
            path: '/',
        });
        response.cookies.set('accessToken', session.accessToken, {
            httpOnly: true,
            secure: isProductionEnv,
            sameSite: 'strict',
            maxAge: 15 * 60, // 15 minutes
            path: '/',
        });

        return response;
    } catch (error: any) {
        return NextResponse.json(
            {
                status: 'error',
                error: {
                    code: 'AUTH_ERROR',
                    message: error.message || 'Authentication failed',
                },
            },
            { status: 401 }
        );
    }
}

// ============================================================================
// POST /api/auth/refresh
// ============================================================================

export async function handleRefresh(request: NextRequest): Promise<NextResponse> {
    try {
        // Try to get refresh token from cookie first
        let refreshToken = request.cookies.get('refreshToken')?.value;

        // Fallback to body
        if (!refreshToken) {
            const body = await request.json();
            const { refreshToken: tokenFromBody } = RefreshRequestSchema.parse(body);
            refreshToken = tokenFromBody;
        }

        if (!refreshToken) {
            throw new Error('Refresh token not found');
        }

        const session = await authService.refreshSession(refreshToken);

        // Set new httpOnly cookie with rotated refresh token
        const response = NextResponse.json({
            status: 'success',
            data: {
                accessToken: session.accessToken,
                role: session.role,
                walletAddress: session.walletAddress,
                expiresAt: session.accessTokenExpiresAt.toISOString(),
            },
        });

        response.cookies.set('refreshToken', session.refreshToken, {
            httpOnly: true,
            secure: isProductionEnv,
            sameSite: 'strict',
            maxAge: 7 * 24 * 60 * 60, // 7 days
            path: '/',
        });
        response.cookies.set('accessToken', session.accessToken, {
            httpOnly: true,
            secure: isProductionEnv,
            sameSite: 'strict',
            maxAge: 15 * 60, // 15 minutes
            path: '/',
        });

        return response;
    } catch (error: any) {
        return NextResponse.json(
            {
                status: 'error',
                error: {
                    code: 'AUTH_ERROR',
                    message: error.message || 'Token refresh failed',
                },
            },
            { status: 401 }
        );
    }
}

// ============================================================================
// POST /api/auth/logout
// ============================================================================

export async function handleLogout(request: NextRequest): Promise<NextResponse> {
    const authResult = await requireAuth(request);
    if (authResult instanceof NextResponse) {
        return authResult;
    }

    try {
        await authService.revokeSession(authResult.sessionId, authResult.walletAddress);

        return clearAuthCookies(NextResponse.json({
            status: 'success',
            data: { message: 'Logged out successfully' },
        }));
    } catch (error: any) {
        return NextResponse.json(
            {
                status: 'error',
                error: {
                    code: 'AUTH_ERROR',
                    message: error.message || 'Logout failed',
                },
            },
            { status: 400 }
        );
    }
}

// ============================================================================
// POST /api/auth/logout-all
// ============================================================================

export async function handleLogoutAll(request: NextRequest): Promise<NextResponse> {
    const authResult = await requireAuth(request);
    if (authResult instanceof NextResponse) {
        return authResult;
    }

    try {
        await authService.revokeAllSessions(authResult.walletAddress);

        return clearAuthCookies(NextResponse.json({
            status: 'success',
            data: { message: 'All sessions revoked successfully' },
        }));
    } catch (error: any) {
        return NextResponse.json(
            {
                status: 'error',
                error: {
                    code: 'AUTH_ERROR',
                    message: error.message || 'Logout all failed',
                },
            },
            { status: 400 }
        );
    }
}

// ============================================================================
// GET /api/auth/me
// ============================================================================

export async function handleMe(request: NextRequest): Promise<NextResponse> {
    const authResult = await requireAuth(request);
    if (authResult instanceof NextResponse) {
        return authResult;
    }

    return NextResponse.json({
        status: 'success',
        data: {
            walletAddress: authResult.walletAddress,
            role: authResult.role,
            sessionId: authResult.sessionId,
        },
    });
}

// ============================================================================
// POST /api/auth/dev/switch-role
// ============================================================================

export async function handleDevSwitchRole(request: NextRequest): Promise<NextResponse> {
    try {
        const authResult = await requireAuth(request);
        if (authResult instanceof NextResponse) {
            return authResult;
        }

        const body = await request.json();
        const { role } = SwitchRoleSchema.parse(body);

        const session = await authService.createRoleSession(
            authResult.walletAddress,
            role,
            authResult.sessionId
        );

        const response = NextResponse.json({
            status: 'success',
            data: {
                accessToken: session.accessToken,
                role: session.role,
                walletAddress: session.walletAddress,
                expiresAt: session.accessTokenExpiresAt.toISOString(),
            },
        });

        response.cookies.set('refreshToken', session.refreshToken, {
            httpOnly: true,
            secure: isProductionEnv,
            sameSite: 'strict',
            maxAge: 7 * 24 * 60 * 60,
            path: '/',
        });
        response.cookies.set('accessToken', session.accessToken, {
            httpOnly: true,
            secure: isProductionEnv,
            sameSite: 'strict',
            maxAge: 15 * 60,
            path: '/',
        });

        return response;
    } catch (error: any) {
        console.error('[switch-role] Error:', error);
        return NextResponse.json(
            { status: 'error', error: { code: 'SWITCH_ROLE_ERROR', message: error?.message ?? 'Unknown error' } },
            { status: 500 }
        );
    }
}
