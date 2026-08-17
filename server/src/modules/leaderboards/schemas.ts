import { z } from 'zod';

export const leaderboardQuerySchema = z
  .object({
    sort: z.enum(['rating', 'maxRating', 'solvedCount']).default('rating'),
    scope: z.enum(['all', 'batch', 'branch']).default('all'),
    batch: z
      .string()
      .regex(/^\d{4}$/, 'Must be a 4-digit year')
      .transform(Number)
      .optional(),
    branch: z.string().max(16).toUpperCase().optional(),
    q: z.string().max(100).optional(),
    limit: z
      .string()
      .regex(/^\d+$/)
      .transform(Number)
      .refine((n) => n >= 1 && n <= 100, 'limit must be 1–100')
      .default('50'),
    cursor: z.string().max(500).optional(),
  })
  .strict();

export const ratingTrendsQuerySchema = z.object({
  days: z
    .string()
    .regex(/^\d+$/)
    .transform(Number)
    .refine((days) => [30, 90, 180, 365, 730].includes(days), 'Unsupported trend range')
    .default('365'),
}).strict();
