import { getAuth } from '@clerk/express';
import type { NextFunction, Request, Response } from 'express';

import { prisma } from './db.ts';
import { unauthorized } from './http.ts';

export type AppUser = { id: string; clerkUserId: string };

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Clerk's subject id, set by requireAuth. */
      clerkUserId?: string;
      /** The local row for that Clerk user, set by withUser. */
      appUser?: AppUser;
    }
  }
}

/**
 * Rejects unauthenticated requests with a JSON 401.
 *
 * We do not use Clerk's own `requireAuth()`: it is deprecated, and it *redirects*
 * to a sign-in page, which is useless for a native client talking to a JSON API.
 * `clerkMiddleware()` has already verified the bearer token networklessly by the
 * time we get here, so this is just a presence check.
 */
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const { userId } = getAuth(req);
  if (!userId) {
    next(unauthorized());
    return;
  }
  req.clerkUserId = userId;
  next();
}

/**
 * Resolves the Clerk user to a local row, creating it on first sight.
 *
 * Just-in-time provisioning rather than a Clerk webhook: a brand new user's very
 * first authenticated request creates their row and a default agent profile, so
 * sign-up works without waiting on an out-of-band delivery. A webhook is still
 * the right way to handle *deletions* later.
 */
export async function withUser(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const clerkUserId = req.clerkUserId;
  if (!clerkUserId) {
    next(unauthorized());
    return;
  }

  req.appUser = await prisma.user.upsert({
    where: { clerkUserId },
    update: {},
    create: { clerkUserId, profile: { create: {} } },
    select: { id: true, clerkUserId: true },
  });

  next();
}

/** Narrows `req.appUser` for route handlers mounted behind requireAuth + withUser. */
export function currentUser(req: Request): AppUser {
  if (!req.appUser) throw unauthorized();
  return req.appUser;
}
