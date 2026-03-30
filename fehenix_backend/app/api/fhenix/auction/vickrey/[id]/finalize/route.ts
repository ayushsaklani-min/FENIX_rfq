import { NextRequest } from 'next/server';
import { handleVickreyFinalizeAuction } from '../../../../../../../api/fhenix/auction/vickrey/routes';

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
    const { id } = await context.params;
    return handleVickreyFinalizeAuction(request, id);
}
