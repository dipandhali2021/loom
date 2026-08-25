import { PrismaPg } from '@prisma/adapter-pg';

import { env } from './env.ts';
import { PrismaClient } from './generated/prisma/client.ts';

// Prisma 7 requires an explicit driver adapter. Runtime queries go through Neon's
// *pooled* endpoint so many short-lived connections stay cheap.
const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });

export const prisma = new PrismaClient({
  adapter,
  log: env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});
