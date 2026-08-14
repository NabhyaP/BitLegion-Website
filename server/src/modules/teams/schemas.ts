import { z } from 'zod';

export const createTeamSchema = z
  .object({
    name: z.string().min(1).max(100),
    displayOrder: z.number().int().default(0),
  })
  .strict();

export const updateTeamSchema = z
  .object({
    name: z.string().min(1).max(100),
    displayOrder: z.number().int().default(0),
  })
  .strict();

export const createMemberSchema = z
  .object({
    userId: z.number().int().positive().nullable().default(null),
    name: z.string().min(1).max(100),
    roleTitle: z.string().min(1).max(100),
    cfHandle: z.string().max(64).nullable().default(null),
    photoUrl: z.string().url().max(500).nullable().default(null),
    displayOrder: z.number().int().default(0),
  })
  .strict();

export const updateMemberSchema = z
  .object({
    userId: z.number().int().positive().nullable().optional(),
    name: z.string().min(1).max(100).optional(),
    roleTitle: z.string().min(1).max(100).optional(),
    cfHandle: z.string().max(64).nullable().optional(),
    photoUrl: z.string().url().max(500).nullable().optional(),
    displayOrder: z.number().int().optional(),
  })
  .strict();
