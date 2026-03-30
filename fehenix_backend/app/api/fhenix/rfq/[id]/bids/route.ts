import { handleFhenixListBids, handleFhenixSubmitBid } from '@/api/fhenix/rfq/routes';
import { withRateLimit } from '@/middleware/withRateLimit';
import { NextRequest } from 'next/server';

export const GET = withRateLimit(async (request: NextRequest, { params }: { params: { id: string } }) => {
    return handleFhenixListBids(request, params.id);
});

export const POST = withRateLimit(async (request: NextRequest, { params }: { params: { id: string } }) => {
    return handleFhenixSubmitBid(request, params.id);
});
