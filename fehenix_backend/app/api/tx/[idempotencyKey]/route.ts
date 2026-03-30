import { handleGetTxStatus } from '@/api/tx/routes';
import { NextRequest } from 'next/server';

export async function GET(request: NextRequest, { params }: { params: { idempotencyKey: string } }) {
    return handleGetTxStatus(request, params.idempotencyKey);
}
