import { NextRequest } from 'next/server';
import { proxyToBackend } from '../../_lib/backendProxy';

function backendPath(parts: string[]): string {
    return `/api/tx/${parts.join('/')}`;
}

export async function GET(
    request: NextRequest,
    { params }: { params: { path: string[] } }
) {
    return proxyToBackend(request, backendPath(params.path), 'GET');
}

export async function POST(
    request: NextRequest,
    { params }: { params: { path: string[] } }
) {
    return proxyToBackend(request, backendPath(params.path), 'POST');
}

