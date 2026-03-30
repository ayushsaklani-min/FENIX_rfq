import { NextRequest } from 'next/server';
import { handleInvoiceGet } from '../../../../../api/fhenix/invoice/routes';

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
    const { id } = await context.params;
    return handleInvoiceGet(request, id);
}
