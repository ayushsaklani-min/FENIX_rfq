import { handleInvoiceConfirmTransfer } from '../../../../../../api/fhenix/invoice/routes';
import { withRateLimit } from '@/middleware/withRateLimit';
import { NextRequest } from 'next/server';

export const POST = withRateLimit(async (request: NextRequest, { params }: { params: { id: string } }) => {
    return handleInvoiceConfirmTransfer(request, params.id);
});
