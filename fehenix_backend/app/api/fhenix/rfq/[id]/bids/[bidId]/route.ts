import { handleFhenixGetBid } from '@/api/fhenix/rfq/routes';
import { withRateLimit } from '@/middleware/withRateLimit';
import { NextRequest } from 'next/server';

export const GET = withRateLimit(
    async (
        request: NextRequest,
        { params }: { params: { id: string; bidId: string } },
    ) => handleFhenixGetBid(request, params.id, params.bidId),
);
