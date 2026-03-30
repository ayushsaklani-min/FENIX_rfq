import { NextRequest } from 'next/server';
import { handleVickreyGetAuction } from '../../../../../../api/fhenix/auction/vickrey/routes';

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
    const { id } = await context.params;
    return handleVickreyGetAuction(request, id);
}
