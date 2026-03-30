import { handleRetryTx } from '@/api/tx/routes';
import { NextRequest } from 'next/server';

export async function POST(request: NextRequest, { params }: { params: { idempotencyKey: string } }) {
    return handleRetryTx(request, params.idempotencyKey);
}
