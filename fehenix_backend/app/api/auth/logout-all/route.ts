import { handleLogoutAll } from '@/api/auth/routes';
import { NextRequest } from 'next/server';

export async function POST(request: NextRequest) {
    return handleLogoutAll(request);
}
