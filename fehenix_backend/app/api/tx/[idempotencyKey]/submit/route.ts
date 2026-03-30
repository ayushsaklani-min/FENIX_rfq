import { handleSubmitTx } from '@/api/tx/routes';
import { NextRequest } from 'next/server';

export async function POST(
    request: NextRequest,
    { params }: { params: { idempotencyKey: string } }
) {
    return handleSubmitTx(request, params.idempotencyKey);
}
