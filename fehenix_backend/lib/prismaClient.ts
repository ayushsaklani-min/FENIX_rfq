import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as {
    __sealrfqPrisma?: PrismaClient;
};

export const prisma = globalForPrisma.__sealrfqPrisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
    globalForPrisma.__sealrfqPrisma = prisma;
}
