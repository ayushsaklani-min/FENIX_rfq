import { NextRequest } from 'next/server';
import { handleDutchListAcceptances } from '../../../../../../../api/fhenix/auction/dutch/routes';

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
    const { id } = await context.params;
    return handleDutchListAcceptances(request, id);
}
