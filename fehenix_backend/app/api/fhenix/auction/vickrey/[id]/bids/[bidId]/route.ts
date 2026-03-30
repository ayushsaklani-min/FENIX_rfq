import { NextRequest } from 'next/server';
import { handleVickreyGetBid } from '../../../../../../../../api/fhenix/auction/vickrey/routes';

export async function GET(request: NextRequest, context: { params: Promise<{ id: string; bidId: string }> }) {
    const { id, bidId } = await context.params;
    return handleVickreyGetBid(request, id, bidId);
}
