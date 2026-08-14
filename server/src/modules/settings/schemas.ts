import { z } from 'zod';

export const patchSettingsSchema = z
  .object({
    announcement: z.string().max(500).optional(),
    leaderboardEnabled: z.boolean().optional(),
    leaderboardRefreshMinutes: z.number().int().min(30).optional(),
  })
  .strict();
