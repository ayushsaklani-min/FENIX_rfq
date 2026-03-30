import { NextRequest } from 'next/server';
import { handleVickreyCommitBid, handleVickreyListBids } from '../../../../../../../api/fhenix/auction/vickrey/routes';

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
    const { id } = await context.params;
    return handleVickreyListBids(request, id);
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
    const { id } = await context.params;
    return handleVickreyCommitBid(request, id);
}
