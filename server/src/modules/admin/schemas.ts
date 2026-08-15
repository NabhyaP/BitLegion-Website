import { z } from 'zod';

export const listMembersQuerySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  branch: z.string().max(16).optional(),
  status: z.enum(['ACTIVE', 'PENDING', 'SUSPENDED', 'ALUMNI']).optional(),
  q: z.string().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(25),
}).strict();

export const updateMemberSchema = z.object({
  displayName: z.string().min(1).max(100).optional(),
  rollNo: z.string().max(20).nullable().optional(),
  batchYear: z.number().int().min(2000).max(2100).nullable().optional(),
  branch: z.string().max(16).nullable().optional(),
  status: z.enum(['ACTIVE', 'PENDING', 'SUSPENDED', 'ALUMNI']).optional(),
  showInLeaderboard: z.boolean().optional(),
}).strict().refine((d) => Object.keys(d).length > 0, { message: 'At least one field required.' });

export const createMemberSchema = z.object({
  collegeEmail: z.string().email().max(190),
  displayName: z.string().min(1).max(100),
  rollNo: z.string().max(20).nullable().optional(),
  batchYear: z.number().int().min(2000).max(2100).nullable().optional(),
  branch: z.string().max(16).nullable().optional(),
}).strict();

export const csvRowSchema = z.object({
  display_name: z.string().min(1).max(100),
  college_email: z.string().email().max(190),
  batch_year: z.coerce.number().int().min(2000).max(2100),
  branch: z.string().max(16),
});

export const patchRolesSchema = z.object({
  grant: z.array(z.enum(['MEMBER', 'MENTOR', 'EDITOR', 'MODERATOR', 'ADMIN', 'SUPERADMIN'])).default([]),
  revoke: z.array(z.enum(['MEMBER', 'MENTOR', 'EDITOR', 'MODERATOR', 'ADMIN', 'SUPERADMIN'])).default([]),
}).strict();

export const listAuditQuerySchema = z.object({
  actor: z.coerce.number().int().positive().optional(),
  action: z.string().max(80).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(25),
}).strict();
