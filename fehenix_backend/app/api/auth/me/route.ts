import { handleMe } from '@/api/auth/routes';
import { NextRequest } from 'next/server';

export async function GET(request: NextRequest) {
    return handleMe(request);
}
