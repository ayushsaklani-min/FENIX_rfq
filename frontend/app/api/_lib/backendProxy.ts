import { NextRequest, NextResponse } from 'next/server';

const BACKEND_API_URL = process.env.BACKEND_API_URL || 'http://localhost:3000';

const ROUTE_MAP: Record<string, string> = {
    '/api/fhenix': '/api/fhenix',
    '/api/auth': '/api/auth',
    '/api/platform': '/api/platform',
    '/api/tx': '/api/tx',
    '/api/audit': '/api/audit',
};

function mapToBackendPath(frontendPath: string): string {
    for (const [prefix, backendPrefix] of Object.entries(ROUTE_MAP)) {
        if (frontendPath.startsWith(prefix)) {
            return frontendPath.replace(prefix, backendPrefix);
        }
    }
    return frontendPath;
}

function extractSetCookies(headers: Headers): string[] {
    const getSetCookie = (headers as any).getSetCookie;
    if (typeof getSetCookie === 'function') {
        return getSetCookie.call(headers);
    }

    const raw = headers.get('set-cookie');
    if (!raw) {
        return [];
    }

    return raw
        .split(/,(?=\s*[^;,\s]+=)/)
        .map((cookie) => cookie.trim())
        .filter(Boolean);
}

export async function proxyToBackend(
    request: NextRequest,
    backendPath: string,
    method: 'GET' | 'POST'
) {
    try {
        const authHeader = request.headers.get('authorization');
        const body = method === 'POST' ? await request.text() : undefined;
        const incomingUrl = new URL(request.url);
        
        const mappedPath = mapToBackendPath(backendPath);
        const targetUrl = `${BACKEND_API_URL}${mappedPath}${incomingUrl.search}`;

        const upstream = await fetch(targetUrl, {
            method,
            headers: {
                ...(authHeader ? { Authorization: authHeader } : {}),
                ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
                cookie: request.headers.get('cookie') || '',
            },
            body,
            cache: 'no-store',
        });

        const text = await upstream.text();
        let payload: any = {
            status: 'error',
            error: { code: 'UPSTREAM_ERROR', message: text },
        };

        try {
            payload = JSON.parse(text);
        } catch {
            // Keep fallback payload.
        }

        const response = NextResponse.json(payload, { status: upstream.status });
        const setCookies = extractSetCookies(upstream.headers);
        for (const cookie of setCookies) {
            response.headers.append('set-cookie', cookie);
        }
        return response;
    } catch (error: any) {
        return NextResponse.json(
            {
                status: 'error',
                error: {
                    code: 'BACKEND_UNREACHABLE',
                    message: `Could not reach backend at ${BACKEND_API_URL}: ${error.message}`,
                },
            },
            { status: 503 }
        );
    }
}
