import { handleFhenixGetRFQ } from '@/api/fhenix/rfq/routes';
import { NextRequest } from 'next/server';

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
    return handleFhenixGetRFQ(request, params.id);
}
