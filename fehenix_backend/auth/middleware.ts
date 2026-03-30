/**
 * Auth Middleware
 * 
 * Verifies JWT access token and extracts user info.
 */

import { NextRequest, NextResponse } from 'next/server';
import { AuthService } from './service';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const authService = new AuthService(prisma);

export interface AuthenticatedRequest extends NextRequest {
    auth: {
        walletAddress: string;
        role: 'BUYER' | 'VENDOR' | 'AUDITOR' | 'NEW_USER';
        sessionId: string;
    };
}

/**
 * Middleware to verify access token
 */
export async function requireAuth(
    request: NextRequest
): Promise<{ walletAddress: string; role: string; sessionId: string } | NextResponse> {
    // Prefer Authorization header, fallback to accessToken cookie.
    const authHeader = request.headers.get('authorization');
    const headerToken =
        authHeader && authHeader.startsWith('Bearer ')
            ? authHeader.substring(7)
            : null;
    const cookieToken = request.cookies.get('accessToken')?.value || null;
    const token = headerToken || cookieToken;

    if (!token) {
        return NextResponse.json(
            { status: 'error', error: { code: 'AUTH_ERROR', message: 'Missing or invalid authorization header' } },
            { status: 401 }
        );
    }

    try {
        const auth = await authService.verifyAccessToken(token);
        return auth;
    } catch (error) {
        return NextResponse.json(
            { status: 'error', error: { code: 'AUTH_ERROR', message: 'Invalid or expired token' } },
            { status: 401 }
        );
    }
}

export async function maybeAuth(
    request: NextRequest
): Promise<{ walletAddress: string; role: string; sessionId: string } | null> {
    const authHeader = request.headers.get('authorization');
    const headerToken =
        authHeader && authHeader.startsWith('Bearer ')
            ? authHeader.substring(7)
            : null;
    const cookieToken = request.cookies.get('accessToken')?.value || null;
    const token = headerToken || cookieToken;

    if (!token) {
        return null;
    }

    try {
        return await authService.verifyAccessToken(token);
    } catch {
        return null;
    }
}

/**
 * Middleware to require specific role
 */
export async function requireRole(
    request: NextRequest,
    allowedRoles: string[]
): Promise<{ walletAddress: string; role: string; sessionId: string } | NextResponse> {
    const authResult = await requireAuth(request);

    if (authResult instanceof NextResponse) {
        return authResult; // Auth failed
    }

    if (!allowedRoles.includes(authResult.role)) {
        return NextResponse.json(
            { status: 'error', error: { code: 'AUTH_ERROR', message: 'Insufficient permissions' } },
            { status: 403 }
        );
    }

    return authResult;
}
