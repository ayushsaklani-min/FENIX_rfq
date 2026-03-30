import { NextRequest } from 'next/server';
import { handleInvoiceWithdraw } from '../../../../../../api/fhenix/invoice/routes';

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
    const { id } = await context.params;
    return handleInvoiceWithdraw(request, id);
}
