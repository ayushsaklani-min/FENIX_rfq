import { handleFhenixPublishLowestBid } from '@/api/fhenix/rfq/routes';
import { withRateLimit } from '@/middleware/withRateLimit';
import { NextRequest } from 'next/server';

export const POST = withRateLimit(async (request: NextRequest, { params }: { params: { id: string } }) => {
    return handleFhenixPublishLowestBid(request, params.id);
});
