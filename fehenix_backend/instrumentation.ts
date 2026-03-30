/**
 * Next.js instrumentation hook — runs once when the server starts.
 * https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */
export async function register() {
    if (process.env.NEXT_RUNTIME === 'nodejs') {
        // 1. Validate environment variables — fail fast on misconfiguration.
        const { validateEnv } = await import('./lib/validateEnv');
        validateEnv();

        // 2. Register graceful shutdown for Prisma.
        const { registerShutdownHandler } = await import('./lib/shutdown');
        const { PrismaClient } = await import('@prisma/client');

        const prisma = new PrismaClient();
        registerShutdownHandler('prisma', async () => {
            await prisma.$disconnect();
        });
    }
}
