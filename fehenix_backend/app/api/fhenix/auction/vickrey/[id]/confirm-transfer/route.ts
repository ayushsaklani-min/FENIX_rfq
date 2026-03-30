import { handleVickreyConfirmTransfer } from '../../../../../../../api/fhenix/auction/vickrey/routes';
import { withRateLimit } from '@/middleware/withRateLimit';
import { NextRequest } from 'next/server';

export const POST = withRateLimit(async (request: NextRequest, { params }: { params: { id: string } }) => {
    return handleVickreyConfirmTransfer(request, params.id);
});
