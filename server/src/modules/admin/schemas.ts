import { z } from 'zod';
import { env } from '../../config/env.ts';
import { isCollegeEmail } from '../users/rollno.ts';

const collegeEmailSchema = z.string().email().max(190).refine(
  (email) => isCollegeEmail(email, env.ALLOWED_EMAIL_SUFFIX),
  `Email must belong to @${env.ALLOWED_EMAIL_SUFFIX}.`,
);

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
  avatarUrl: z.string().url().max(500).regex(/^https?:\/\//i, 'Avatar URL must use HTTP or HTTPS.').nullable().optional(),
  rollNo: z.string().max(20).nullable().optional(),
  batchYear: z.number().int().min(2000).max(2100).nullable().optional(),
  branch: z.string().max(16).nullable().optional(),
  status: z.enum(['ACTIVE', 'PENDING', 'SUSPENDED', 'ALUMNI']).optional(),
  showInLeaderboard: z.boolean().optional(),
}).strict().refine((d) => Object.keys(d).length > 0, { message: 'At least one field required.' });

export const createMemberSchema = z.object({
  collegeEmail: collegeEmailSchema,
  displayName: z.string().min(1).max(100),
  rollNo: z.string().max(20).nullable().optional(),
  batchYear: z.number().int().min(2000).max(2100).nullable().optional(),
  branch: z.string().max(16).nullable().optional(),
}).strict();

export const csvRowSchema = z.object({
  display_name: z.string().min(1).max(100),
  college_email: collegeEmailSchema,
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
