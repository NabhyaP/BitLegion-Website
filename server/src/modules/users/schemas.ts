import { z } from 'zod';

/** PATCH /me — displayName any time; rollNo/batch/branch only during the one-time confirm. */
export const patchMeSchema = z
  .object({
    displayName: z.string().trim().min(1).max(100).optional(),
    rollNo: z.string().trim().max(20).nullable().optional(),
    batchYear: z.number().int().min(1990).max(2100).nullable().optional(),
    branch: z.string().trim().max(16).nullable().optional(),
    confirmProfile: z.boolean().optional(),
  })
  .strict();

export type PatchMeInput = z.infer<typeof patchMeSchema>;
