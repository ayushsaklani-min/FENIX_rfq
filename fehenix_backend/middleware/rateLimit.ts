/**
 * Rate Limiting Middleware
 * Gate 2: Security Pass
 */

import { NextRequest, NextResponse } from 'next/server';
import { Redis } from 'ioredis';

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
    // Reconnect with exponential backoff (max 10s between attempts).
    retryStrategy(times: number) {
        if (times > 10) {
            // After 10 failed attempts stop retrying — fail open (rate limit skipped).
            return null;
        }
        return Math.min(times * 200, 10_000);
    },
    maxRetriesPerRequest: 1,      // Don't block a request more than one retry
    enableOfflineQueue: false,    // Reject commands immediately when disconnected
    lazyConnect: false,
    connectTimeout: 3000,
});

redis.on('error', (err) => {
    // Log but do not crash the process — rate limiting fails open.
    console.warn('[Redis] Connection error (rate limiting will be skipped):', err.message);
});

interface RateLimitConfig {
    windowMs: number;  // Time window in milliseconds
    maxRequests: number;  // Max requests per window
    skipSuccessfulRequests?: boolean;
}

const RATE_LIMITS: Record<string, RateLimitConfig> = {
    '/api/auth/*': { windowMs: 60000, maxRequests: 10 },  // 10/min
    '/api/fhenix/rfq/create': { windowMs: 60000, maxRequests: 5 },  // 5/min
    '/api/fhenix/rfq/*/bids': { windowMs: 60000, maxRequests: 10 },  // 10/min
    '/api/fhenix/rfq/*/release': { windowMs: 60000, maxRequests: 2 },  // 2/min
    '/api/audit/trail': { windowMs: 60000, maxRequests: 60 },  // 60/min
};

function getRateLimitKey(identifier: string, route: string): string {
    return `ratelimit:${route}:${identifier}`;
}

function getMatchingRoute(path: string): string | null {
    for (const route of Object.keys(RATE_LIMITS)) {
        // Simple wildcard matching
        const pattern = route.replace(/\*/g, '.*').replace(/\[.*?\]/g, '[^/]+');
        const regex = new RegExp(`^${pattern}$`);
        if (regex.test(path)) {
            return route;
        }
    }
    return null;
}

export async function rateLimitMiddleware(
    req: NextRequest,
    identifier: string  // IP address or user ID
): Promise<NextResponse | null> {
    const path = new URL(req.url).pathname;
    const matchedRoute = getMatchingRoute(path);

    if (!matchedRoute) {
        // No rate limit configured for this route
        return null;
    }

    const config = RATE_LIMITS[matchedRoute];
    const key = getRateLimitKey(identifier, matchedRoute);

    try {
        // Get current count
        const current = await redis.get(key);
        const count = current ? parseInt(current, 10) : 0;

        if (count >= config.maxRequests) {
            // Rate limit exceeded
            const ttl = await redis.ttl(key);
            const retryAfter = Math.max(1, ttl);

            return NextResponse.json(
                {
                    status: 'error',
                    error: {
                        code: 'RATE_LIMIT_EXCEEDED',
                        message: `Too many requests. Please try again in ${retryAfter} seconds.`,
                        retryAfter,
                    },
                },
                {
                    status: 429,
                    headers: {
                        'Retry-After': retryAfter.toString(),
                        'X-RateLimit-Limit': config.maxRequests.toString(),
                        'X-RateLimit-Remaining': '0',
                        'X-RateLimit-Reset': (Date.now() + ttl * 1000).toString(),
                    },
                }
            );
        }

        // Increment counter
        await redis.multi()
            .incr(key)
            .pexpire(key, config.windowMs)
            .exec();

        // Add rate limit headers to response
        const remaining = config.maxRequests - count - 1;
        const reset = Date.now() + config.windowMs;

        // Return null to allow request, but attach headers via response clone
        return null;  // Request allowed
    } catch (error) {
        console.error('Rate limit check failed:', error);
        // On error, allow request (fail open for availability)
        return null;
    }
}

/**
 * Usage in API route:
 * 
 * export async function POST(req: NextRequest) {
 *   const ip = req.headers.get('x-forwarded-for') || 'unknown';
 *   const rateLimitResult = await rateLimitMiddleware(req, ip);
 *   
 *   if (rateLimitResult) {
 *     return rateLimitResult;  // Rate limited
 *   }
 *   
 *   // Process request...
 * }
 */
