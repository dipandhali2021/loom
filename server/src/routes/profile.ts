import { Router } from 'express';
import { z } from 'zod';

import { currentUser } from '../auth.ts';
import { prisma } from '../db.ts';
import { toProfileDTO } from '../dto.ts';
import { parseBody } from '../http.ts';

export const profileRouter = Router();

const UpdateProfileBody = z
  .object({
    displayName: z.string().trim().min(1).max(80).optional(),
    tone: z.enum(['neutral', 'warm', 'direct', 'playful']).optional(),
    verbosity: z.enum(['concise', 'balanced', 'thorough']).optional(),
    customInstructions: z.string().max(4_000).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update.',
  });

// upsert rather than findUnique: a `users` row that predates this API may have no
// profile yet, and the read path should heal that instead of 404-ing.
profileRouter.get('/', async (req, res) => {
  const user = currentUser(req);
  const profile = await prisma.agentProfile.upsert({
    where: { userId: user.id },
    update: {},
    create: { userId: user.id },
  });
  res.json({ profile: toProfileDTO(profile) });
});

profileRouter.patch('/', async (req, res) => {
  const user = currentUser(req);
  const patch = parseBody(UpdateProfileBody, req.body);

  const profile = await prisma.agentProfile.upsert({
    where: { userId: user.id },
    // `updated_at` is a plain `default(now())` column in the existing schema, not
    // Prisma's `@updatedAt`, so every write has to set it explicitly.
    update: { ...patch, updatedAt: new Date() },
    create: { userId: user.id, ...patch },
  });

  res.json({ profile: toProfileDTO(profile) });
});
