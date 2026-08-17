import { z } from 'zod';

export const courseCodeParamSchema = z.string().regex(/^\d{2}$/, 'Course code must be two digits.');

export const courseCodeBodySchema = z.object({
  code: courseCodeParamSchema,
  branch: z.string().trim().min(2).max(16).transform((value) => value.toUpperCase()),
  name: z.string().trim().min(2).max(100),
}).strict();

export const courseCodeUpdateSchema = courseCodeBodySchema.omit({ code: true });
