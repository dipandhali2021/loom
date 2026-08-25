import { clerkMiddleware } from '@clerk/express';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';

import { prisma } from './db.ts';
import { authorizedParties, corsOrigins, env } from './env.ts';
import { errorHandler, routeNotFoundHandler } from './http.ts';
import { apiRouter } from './routes/index.ts';

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  // Neon/most hosts sit behind one proxy; needed for correct req.ip and protocol.
  app.set('trust proxy', 1);

  app.use(helmet());
  app.use(
    cors({
      origin: corsOrigins,
      // Bearer tokens, not cookies — there is no cross-site credential to forward.
      credentials: false,
      methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Authorization', 'Content-Type'],
    }),
  );
  app.use(express.json({ limit: '1mb' }));

  /**
   * Verifies the `Authorization: Bearer <session token>` header against Clerk's
   * cached JWKS — no network round-trip per request, and no hand-rolled
   * jsonwebtoken verification. It attaches auth to the request and never rejects on
   * its own; the requireAuth guard in src/auth.ts decides what a missing session means.
   */
  app.use(clerkMiddleware(authorizedParties.length > 0 ? { authorizedParties } : {}));

  /** Liveness: is the process up. Deliberately does not touch the database. */
  app.get('/healthz', (_req, res) => {
    res.json({ ok: true, env: env.NODE_ENV });
  });

  /** Readiness: can we actually reach Neon. */
  app.get('/readyz', async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ ok: true, database: 'up' });
    } catch (error) {
      console.error('[readyz] database unreachable', error);
      res.status(503).json({ ok: false, database: 'down' });
    }
  });

  app.use('/api/v1', apiRouter);

  app.use(routeNotFoundHandler);
  app.use(errorHandler);

  return app;
}
