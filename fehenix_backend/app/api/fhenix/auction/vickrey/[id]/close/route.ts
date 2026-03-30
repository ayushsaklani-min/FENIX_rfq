import { NextRequest } from 'next/server';
import { handleVickreyCloseBidding } from '../../../../../../../api/fhenix/auction/vickrey/routes';

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
    const { id } = await context.params;
    return handleVickreyCloseBidding(request, id);
}
