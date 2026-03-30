import { handleLogout } from '@/api/auth/routes';
import { NextRequest } from 'next/server';

export async function POST(request: NextRequest) {
    return handleLogout(request);
}
