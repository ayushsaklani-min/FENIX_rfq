import { handleRefresh } from '@/api/auth/routes';
import { NextRequest } from 'next/server';

export async function POST(request: NextRequest) {
    return handleRefresh(request);
}
