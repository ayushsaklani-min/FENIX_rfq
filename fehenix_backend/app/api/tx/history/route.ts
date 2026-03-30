import { handleGetTxHistory } from '@/api/tx/routes';
import { NextRequest } from 'next/server';

export async function GET(request: NextRequest) {
    return handleGetTxHistory(request);
}
