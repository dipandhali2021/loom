import { Router } from 'express';

import { requireAuth, withUser } from '../auth.ts';
import { conversationsRouter } from './conversations.ts';
import { executeRouter } from './execute.ts';
import { meRouter } from './me.ts';
import { profileRouter } from './profile.ts';
import { temporaryRouter } from './temporary.ts';

export const apiRouter = Router();

// Everything under /api/v1 requires a valid Clerk session token and is resolved to
// a local user row before any handler runs.
apiRouter.use(requireAuth, withUser);

apiRouter.use('/me', meRouter);
apiRouter.use('/profile', profileRouter);
apiRouter.use('/conversations', conversationsRouter);
apiRouter.use('/execute', executeRouter);
/*
 * Temporary chats. Same auth as everything else -- what makes them temporary is
 * that the handler writes no rows, not that it asks for less.
 */
apiRouter.use('/temporary', temporaryRouter);
