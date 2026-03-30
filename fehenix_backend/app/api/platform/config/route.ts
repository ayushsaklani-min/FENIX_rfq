import { handleConfigurePlatform, handleGetPlatformConfig } from '@/api/platform/routes';
import { withRateLimit } from '@/middleware/withRateLimit';
import { NextRequest } from 'next/server';

export async function GET(request: NextRequest) {
    return handleGetPlatformConfig(request);
}

export const POST = withRateLimit(async (request: NextRequest) => {
    return handleConfigurePlatform(request);
});
