import { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { proxyToBackend } from '../../../_lib/backendProxy';

const allowDevAuthRoutes =
    process.env.NODE_ENV === 'development' && process.env.ALLOW_DEV_AUTH_ROUTES === 'true';

export async function POST(request: NextRequest) {
    if (!allowDevAuthRoutes) {
        return NextResponse.json(
            {
                status: 'error',
                error: {
                    code: 'ROUTE_DISABLED',
                    message: 'The development role-switch route is disabled unless ALLOW_DEV_AUTH_ROUTES=true in local development.',
                },
            },
            { status: 404 },
        );
    }

    return proxyToBackend(request, '/api/auth/dev/switch-role', 'POST');
}
