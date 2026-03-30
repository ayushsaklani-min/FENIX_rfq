import { handleGetCanonicalTx } from '@/api/tx/routes';
import { NextRequest } from 'next/server';

export async function GET(request: NextRequest, { params }: { params: { canonicalKey: string } }) {
    return handleGetCanonicalTx(request, params.canonicalKey);
}
