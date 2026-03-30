/**
 * withRateLimit — wraps a Next.js route handler with rate limiting.
 *
 * Usage:
 *   export const POST = withRateLimit(async (req) => { ... });
 */

import { NextRequest, NextResponse } from 'next/server';
import { rateLimitMiddleware } from './rateLimit';

type RouteHandler = (req: NextRequest, ctx?: any) => Promise<NextResponse>;

function getIdentifier(req: NextRequest): string {
    // Prefer wallet address from auth cookie payload; fall back to IP.
    const forwarded = req.headers.get('x-forwarded-for');
    const ip = forwarded ? forwarded.split(',')[0].trim() : 'unknown';
    return ip;
}

export function withRateLimit(handler: RouteHandler): RouteHandler {
    return async (req: NextRequest, ctx?: any): Promise<NextResponse> => {
        const identifier = getIdentifier(req);
        const limited = await rateLimitMiddleware(req, identifier);
        if (limited) return limited;
        return handler(req, ctx);
    };
}
