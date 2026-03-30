/**
 * Authentication Service
 * 
 * CONSTRAINTS:
 * 1. Nonce-challenge auth (no static message)
 * 2. JWT short-lived access + rotating refresh token
 * 3. Role resolution from backend only
 * 4. Session revocation support
 */

import { PrismaClient } from '@prisma/client';
import * as jose from 'jose';
import crypto from 'crypto';
import { verifyEvmWalletSignature } from './evmVerifier';

// ============================================================================
// Types
// ============================================================================

export type UserRole = 'BUYER' | 'VENDOR' | 'AUDITOR' | 'NEW_USER';
export type SelectableUserRole = 'BUYER' | 'VENDOR';

export interface AuthSession {
    id: string;
    walletAddress: string;
    role: UserRole;
    accessToken: string;
    refreshToken: string;
    accessTokenExpiresAt: Date;
    refreshTokenExpiresAt: Date;
}

export interface NonceChallenge {
    nonce: string;
    expiresAt: Date;
    walletAddress: string;
}

export function buildWalletAuthMessage(nonce: string): string {
    return `Sign this nonce to authenticate: ${nonce}`;
}

// ============================================================================
// Configuration
// ============================================================================

const JWT_SECRET = new TextEncoder().encode(
    process.env.JWT_SECRET || 'development-secret-change-in-production'
);

const ACCESS_TOKEN_TTL = 15 * 60; // 15 minutes
const REFRESH_TOKEN_TTL = 7 * 24 * 60 * 60; // 7 days
const NONCE_TTL = 5 * 60 * 1000; // 5 minutes

// ============================================================================
// Auth Service
// ============================================================================

export class AuthService {
    constructor(private prisma: PrismaClient) { }

    /**
     * STEP 1: Generate nonce challenge for wallet to sign
     */
    async generateNonceChallenge(walletAddress: string): Promise<NonceChallenge> {
        // Generate cryptographically secure random nonce
        const nonce = crypto.randomBytes(32).toString('hex');
        const expiresAt = new Date(Date.now() + NONCE_TTL);

        // Store nonce in database (with expiration)
        await this.prisma.authNonce.create({
            data: {
                nonce,
                walletAddress,
                expiresAt,
            },
        });

        return { nonce, expiresAt, walletAddress };
    }

    /**
     * STEP 2: Verify signature and create session
     */
    async verifyAndCreateSession(
        walletAddress: string,
        nonce: string,
        signature: string
    ): Promise<AuthSession> {
        // 1. Verify nonce exists and not expired
        const nonceRecord = await this.prisma.authNonce.findFirst({
            where: {
                nonce,
                walletAddress,
                expiresAt: { gte: new Date() },
                used: false,
            },
        });

        if (!nonceRecord) {
            throw new Error('Invalid or expired nonce');
        }

        // 2. Verify wallet signature
        const isValidSignature = await this.verifyWalletSignature(
            walletAddress,
            nonce,
            signature
        );

        if (!isValidSignature) {
            throw new Error('Invalid signature');
        }

        // 3. Resolve user role (SERVER-SIDE ONLY)
        const role = await this.resolveUserRole(walletAddress);

        // 4. Generate tokens
        const sessionId = crypto.randomUUID();
        const accessToken = await this.generateAccessToken(walletAddress, role, sessionId);
        const refreshToken = await this.generateRefreshToken(walletAddress, sessionId);

        const accessTokenExpiresAt = new Date(Date.now() + ACCESS_TOKEN_TTL * 1000);
        const refreshTokenExpiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL * 1000);

        // 5. Consume nonce and store session atomically to avoid replay races.
        await this.prisma.$transaction([
            this.prisma.authNonce.update({
                where: { id: nonceRecord.id },
                data: { used: true },
            }),
            this.prisma.authSession.create({
                data: {
                    id: sessionId,
                    walletAddress,
                    role,
                    refreshToken,
                    refreshTokenExpiresAt,
                    isRevoked: false,
                },
            }),
        ]);

        return {
            id: sessionId,
            walletAddress,
            role,
            accessToken,
            refreshToken,
            accessTokenExpiresAt,
            refreshTokenExpiresAt,
        };
    }

    /**
     * STEP 3: Refresh access token using refresh token
     */
    async refreshSession(refreshToken: string): Promise<AuthSession> {
        // 1. Verify refresh token
        let payload: any;
        try {
            const { payload: p } = await jose.jwtVerify(refreshToken, JWT_SECRET);
            payload = p;
        } catch (error) {
            throw new Error('Invalid refresh token');
        }

        const { walletAddress, sessionId } = payload as { walletAddress: string; sessionId: string };

        // 2. Check session exists and not revoked
        const session = await this.prisma.authSession.findUnique({
            where: { id: sessionId },
        });

        if (!session || session.isRevoked || session.refreshToken !== refreshToken) {
            throw new Error('Session not found or revoked');
        }

        // 3. Check refresh token not expired
        if (session.refreshTokenExpiresAt < new Date()) {
            throw new Error('Refresh token expired');
        }

        // Preserve explicitly selected buyer/vendor mode across token refreshes.
        const derivedRole = await this.resolveUserRole(walletAddress);
        const role = this.resolveRefreshedRole(session.role as UserRole, derivedRole);

        // 5. Generate new tokens (rotate refresh token)
        const newSessionId = crypto.randomUUID();
        const accessToken = await this.generateAccessToken(walletAddress, role, newSessionId);
        const newRefreshToken = await this.generateRefreshToken(walletAddress, newSessionId);

        const accessTokenExpiresAt = new Date(Date.now() + ACCESS_TOKEN_TTL * 1000);
        const refreshTokenExpiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL * 1000);

        // 6. Revoke old session + create new one (token rotation)
        await this.prisma.$transaction([
            this.prisma.authSession.update({
                where: { id: sessionId },
                data: { isRevoked: true },
            }),
            this.prisma.authSession.create({
                data: {
                    id: newSessionId,
                    walletAddress,
                    role,
                    refreshToken: newRefreshToken,
                    refreshTokenExpiresAt,
                    isRevoked: false,
                },
            }),
        ]);

        return {
            id: newSessionId,
            walletAddress,
            role,
            accessToken,
            refreshToken: newRefreshToken,
            accessTokenExpiresAt,
            refreshTokenExpiresAt,
        };
    }

    /**
     * Verify access token
     */
    async verifyAccessToken(token: string): Promise<{ walletAddress: string; role: UserRole; sessionId: string }> {
        try {
            const { payload } = await jose.jwtVerify(token, JWT_SECRET);

            const { walletAddress, role, sessionId } = payload as {
                walletAddress: string;
                role: UserRole;
                sessionId: string;
            };

            // Check session not revoked
            const session = await this.prisma.authSession.findUnique({
                where: { id: sessionId },
            });

            if (
                !session ||
                session.isRevoked ||
                session.walletAddress !== walletAddress ||
                session.refreshTokenExpiresAt < new Date()
            ) {
                throw new Error('Session revoked');
            }

            return { walletAddress, role, sessionId };
        } catch (error) {
            throw new Error('Invalid or expired access token');
        }
    }

    /**
     * STEP 4: Revoke session (logout)
     */
    async revokeSession(sessionId: string, walletAddress?: string): Promise<void> {
        const result = await this.prisma.authSession.updateMany({
            where: {
                id: sessionId,
                ...(walletAddress ? { walletAddress } : {}),
                isRevoked: false,
            },
            data: { isRevoked: true },
        });

        if (result.count === 0) {
            throw new Error('Session not found or already revoked');
        }
    }

    /**
     * Revoke all sessions for a wallet (logout-all)
     */
    async revokeAllSessions(walletAddress: string): Promise<void> {
        await this.prisma.authSession.updateMany({
            where: { walletAddress },
            data: { isRevoked: true },
        });
    }

    /**
     * Create a new session with an explicitly selected buyer/vendor mode.
     */
    async createRoleSession(
        walletAddress: string,
        role: SelectableUserRole,
        currentSessionId: string
    ): Promise<AuthSession> {
        // Revoke current session first.
        const revokeResult = await this.prisma.authSession.updateMany({
            where: { id: currentSessionId, walletAddress, isRevoked: false },
            data: { isRevoked: true },
        });

        if (revokeResult.count === 0) {
            throw new Error('Session not found or already revoked');
        }

        const sessionId = crypto.randomUUID();
        const accessToken = await this.generateAccessToken(walletAddress, role, sessionId);
        const refreshToken = await this.generateRefreshToken(walletAddress, sessionId);
        const accessTokenExpiresAt = new Date(Date.now() + ACCESS_TOKEN_TTL * 1000);
        const refreshTokenExpiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL * 1000);

        await this.prisma.authSession.create({
            data: {
                id: sessionId,
                walletAddress,
                role,
                refreshToken,
                refreshTokenExpiresAt,
                isRevoked: false,
            },
        });

        return {
            id: sessionId,
            walletAddress,
            role,
            accessToken,
            refreshToken,
            accessTokenExpiresAt,
            refreshTokenExpiresAt,
        };
    }

    /**
     * Role resolution (SERVER-SIDE ONLY)
     * 
     * Rules:
     * - AUDITOR: Whitelisted in env
     * - BUYER: Has created ≥1 RFQ
     * - VENDOR: Has submitted ≥1 bid
     * - NEW_USER: Default
     */
    private async resolveUserRole(walletAddress: string): Promise<UserRole> {
        // 1. Check auditor whitelist
        const auditors = (process.env.AUDITOR_WHITELIST || '').split(',').map(a => a.trim());
        if (auditors.includes(walletAddress)) {
            return 'AUDITOR';
        }

        // 2. Check if buyer (created RFQ)
        const rfqs = await this.prisma.rFQ.findMany({
            where: { buyer: walletAddress },
            select: { createdTxId: true },
        });
        if ((await this.countConfirmedBusinessRows(rfqs.map((rfq) => rfq.createdTxId))) > 0) {
            return 'BUYER';
        }

        // 3. Check if vendor (submitted bid)
        const bids = await this.prisma.bid.findMany({
            where: { vendor: walletAddress },
            select: { createdTxId: true },
        });
        if ((await this.countConfirmedBusinessRows(bids.map((bid) => bid.createdTxId))) > 0) {
            return 'VENDOR';
        }

        // 4. Default: new user
        return 'NEW_USER';
    }

    private resolveRefreshedRole(currentRole: UserRole, derivedRole: UserRole): UserRole {
        if (currentRole === 'BUYER' || currentRole === 'VENDOR') {
            return currentRole;
        }

        if (currentRole === 'AUDITOR') {
            return derivedRole === 'AUDITOR' ? 'AUDITOR' : 'NEW_USER';
        }

        return derivedRole;
    }

    /**
     * Generate access token (short-lived, 15 minutes)
     */
    private async generateAccessToken(
        walletAddress: string,
        role: UserRole,
        sessionId: string
    ): Promise<string> {
        return await new jose.SignJWT({ walletAddress, role, sessionId })
            .setProtectedHeader({ alg: 'HS256' })
            .setIssuedAt()
            .setExpirationTime(`${ACCESS_TOKEN_TTL}s`)
            .sign(JWT_SECRET);
    }

    /**
     * Generate refresh token (long-lived, 7 days)
     */
    private async generateRefreshToken(
        walletAddress: string,
        sessionId: string
    ): Promise<string> {
        return await new jose.SignJWT({ walletAddress, sessionId })
            .setProtectedHeader({ alg: 'HS256' })
            .setIssuedAt()
            .setExpirationTime(`${REFRESH_TOKEN_TTL}s`)
            .sign(JWT_SECRET);
    }

    /**
     * Verify wallet signature using the EVM signer recovered from the auth message.
     */
    private async verifyWalletSignature(
        walletAddress: string,
        nonce: string,
        signature: string
    ): Promise<boolean> {
        const authMessage = buildWalletAuthMessage(nonce);
        try {
            return await verifyEvmWalletSignature(walletAddress, authMessage, signature);
        } catch (error: any) {
            throw new Error(error?.message || 'Failed to verify wallet signature');
        }
    }

    private async countConfirmedBusinessRows(txIds: string[]): Promise<number> {
        if (txIds.length === 0) {
            return 0;
        }

        const pendingKeys = txIds
            .filter((txId) => txId.startsWith('pending_'))
            .map((txId) => txId.substring('pending_'.length));
        const confirmedRows =
            pendingKeys.length > 0
                ? await this.prisma.transaction.findMany({
                      where: {
                          idempotencyKey: { in: pendingKeys },
                          status: 'CONFIRMED',
                      },
                      select: { idempotencyKey: true },
                  })
                : [];
        const confirmedKeySet = new Set(confirmedRows.map((row) => row.idempotencyKey));

        return txIds.filter((txId) => {
            if (!txId.startsWith('pending_')) {
                return true;
            }
            const key = txId.substring('pending_'.length);
            return confirmedKeySet.has(key);
        }).length;
    }

    /**
     * Clean up expired nonces (background job)
     */
    async cleanupExpiredNonces(): Promise<number> {
        const result = await this.prisma.authNonce.deleteMany({
            where: {
                expiresAt: { lt: new Date() },
            },
        });
        return result.count;
    }

    /**
     * Clean up expired sessions (background job)
     */
    async cleanupExpiredSessions(): Promise<number> {
        const result = await this.prisma.authSession.deleteMany({
            where: {
                refreshTokenExpiresAt: { lt: new Date() },
            },
        });
        return result.count;
    }
}
