import { NextRequest } from 'next/server';
import { handleDutchConfirmAcceptance } from '../../../../../../../api/fhenix/auction/dutch/routes';

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
    const { id } = await context.params;
    return handleDutchConfirmAcceptance(request, id);
}
