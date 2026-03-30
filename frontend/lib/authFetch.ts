'use client';

/**
 * Authenticated fetch utility.
 *
 * Access token is stored in module-level memory and injected as a
 * Bearer token on every request. On 401, attempts a silent refresh
 * then retries once. Falls back gracefully if no token is set.
 */

import { safeGetItem, safeRemoveItem, safeSetItem } from './safeLocalStorage';

export const AUTH_STATE_CLEARED_EVENT = 'sealrfq:auth-state-cleared';
export const ROLE_SWITCH_REQUIRED_EVENT = 'sealrfq:role-switch-required';

// ---------------------------------------------------------------------------
// Module-level token store
// ---------------------------------------------------------------------------

let _accessToken: string | null = null;

export class ApiError extends Error {
    code?: string;
    status?: number;

    constructor(message: string, options?: { code?: string; status?: number }) {
        super(message);
        this.name = 'ApiError';
        this.code = options?.code;
        this.status = options?.status;
    }
}

export function setAccessToken(token: string | null): void {
    _accessToken = token;
    if (token) {
        safeSetItem('accessToken', token);
    } else {
        safeRemoveItem('accessToken');
    }
}

export function getAccessToken(): string | null {
    if (!_accessToken) {
        _accessToken = safeGetItem('accessToken');
    }
    return _accessToken;
}

export function clearAccessToken(): void {
    _accessToken = null;
    safeRemoveItem('accessToken');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildHeaders(init?: RequestInit): HeadersInit {
    const base: Record<string, string> = {};
    // Copy existing headers from init
    if (init?.headers) {
        const existing = new Headers(init.headers as HeadersInit);
        existing.forEach((value, key) => {
            base[key] = value;
        });
    }
    if (!base['Content-Type'] && !base['content-type']) {
        base['Content-Type'] = 'application/json';
    }
    const accessToken = getAccessToken();
    if (accessToken) {
        base['Authorization'] = `Bearer ${accessToken}`;
    }
    return base;
}

function clearLocalUiState(): void {
    safeRemoveItem('walletAddress');
    safeRemoveItem('role');
    clearAccessToken();
    if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event(AUTH_STATE_CLEARED_EVENT));
    }
}

async function tryRefreshAccessToken(): Promise<boolean> {
    const response = await fetch('/api/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
        credentials: 'same-origin',
    });
    if (!response.ok) return false;
    try {
        const json = await response.json();
        const newToken = json?.data?.accessToken;
        if (newToken) setAccessToken(newToken);
    } catch {
        // refresh cookie path — token may be in cookie only
    }
    return true;
}

export async function authenticatedFetch(
    input: RequestInfo | URL,
    init?: RequestInit
): Promise<Response> {
    let response = await fetch(input, { ...init, headers: buildHeaders(init) });

    if (response.status === 403 && typeof window !== 'undefined') {
        try {
            const payload = await response.clone().json();
            if (payload?.error?.code === 'AUTH_ERROR') {
                const currentPath = `${window.location.pathname}${window.location.search}`;
                window.dispatchEvent(
                    new CustomEvent(ROLE_SWITCH_REQUIRED_EVENT, {
                        detail: { from: currentPath },
                    }),
                );
                window.location.assign(`/unauthorized?from=${encodeURIComponent(currentPath)}`);
            }
        } catch {
            // Ignore non-JSON responses.
        }
    }

    if (response.status !== 401) {
        return response;
    }

    // Access token expired — try a silent refresh.
    const refreshed = await tryRefreshAccessToken();
    if (!refreshed) {
        clearLocalUiState();
        return response;
    }

    // Retry with new token.
    response = await fetch(input, { ...init, headers: buildHeaders(init) });
    if (response.status === 401) {
        clearLocalUiState();
    }
    return response;
}

export async function authenticatedJson<T = any>(
    input: RequestInfo | URL,
    init?: RequestInit
): Promise<T> {
    const response = await authenticatedFetch(input, init);
    const payload = await response.json().catch(() => null);

    if (!response.ok || payload?.status === 'error') {
        throw new ApiError(
            payload?.error?.message || `Request failed with status ${response.status}`,
            {
                code: payload?.error?.code,
                status: response.status,
            },
        );
    }

    return (payload?.data ?? payload) as T;
}
