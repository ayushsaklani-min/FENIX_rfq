import { handleDutchConfirmTransfer } from '../../../../../../../api/fhenix/auction/dutch/routes';
import { withRateLimit } from '@/middleware/withRateLimit';
import { NextRequest } from 'next/server';

export const POST = withRateLimit(async (request: NextRequest, { params }: { params: { id: string } }) => {
    return handleDutchConfirmTransfer(request, params.id);
});
