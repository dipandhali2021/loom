import { clerkClient } from '@clerk/express';
import { Router } from 'express';

import { currentUser } from '../auth.ts';

export const meRouter = Router();

meRouter.get('/', async (req, res) => {
  const user = currentUser(req);

  // The email address lives in Clerk, not in our `users` table, so there is exactly
  // one source of truth for it and nothing to keep in sync.
  let email: string | null = null;
  try {
    const clerkUser = await clerkClient.users.getUser(user.clerkUserId);
    email =
      clerkUser.emailAddresses.find((address) => address.id === clerkUser.primaryEmailAddressId)
        ?.emailAddress ??
      clerkUser.emailAddresses[0]?.emailAddress ??
      null;
  } catch (error) {
    // A /me without the email beats a failed /me — the ids are the part callers need.
    console.warn('[me] could not read the Clerk profile', error);
  }

  res.json({ user: { id: user.id, clerkUserId: user.clerkUserId, email } });
});
