import { NextRequest } from 'next/server';
import { handleDutchGetResult } from '../../../../../../../api/fhenix/auction/dutch/routes';

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
    const { id } = await context.params;
    return handleDutchGetResult(request, id);
}
