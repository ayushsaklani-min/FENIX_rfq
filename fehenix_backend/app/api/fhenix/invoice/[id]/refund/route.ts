import { NextRequest } from 'next/server';
import { handleInvoiceRefund } from '../../../../../../api/fhenix/invoice/routes';

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
    const { id } = await context.params;
    return handleInvoiceRefund(request, id);
}
