import { NextRequest } from 'next/server';
import { handleDutchGetAcceptance } from '../../../../../../../../api/fhenix/auction/dutch/routes';

export async function GET(request: NextRequest, context: { params: Promise<{ id: string; acceptanceId: string }> }) {
    const { id, acceptanceId } = await context.params;
    return handleDutchGetAcceptance(request, id, acceptanceId);
}
