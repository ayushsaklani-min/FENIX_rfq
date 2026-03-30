import { handleWithdrawToken1 } from '@/api/platform/routes';
import { withRateLimit } from '@/middleware/withRateLimit';
import { NextRequest } from 'next/server';

export const POST = withRateLimit(async (request: NextRequest) => {
    return handleWithdrawToken1(request);
});
