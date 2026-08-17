import { config } from 'dotenv';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const moduleDir = dirname(fileURLToPath(import.meta.url));
const envPath = [
  resolve(process.cwd(), '.env'),
  resolve(process.cwd(), '../.env'),
  resolve(moduleDir, '../../../.env'),
  resolve(moduleDir, '../../../../../.env'),
].find(existsSync);

// Integration tests provide an explicit, disposable environment. Never let a
// developer's local credentials leak into or change the behavior of test runs.
if (process.env.NODE_ENV !== 'test') {
  config(envPath ? { path: envPath } : undefined);
}

const optionalCredential = z.preprocess(
  (value) => value === '' ? undefined : value,
  z.string().min(1).optional(),
);

const optionalSecret = z.preprocess(
  (value) => value === '' ? undefined : value,
  z.string().min(32).optional(),
);

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  APP_URL: z.string().url(),

  DB_HOST: z.string().min(1),
  DB_PORT: z.coerce.number().int().positive().default(3306),
  DB_USER: z.string().min(1),
  DB_PASSWORD: z.string(),
  DB_NAME: z.string().min(1),

  SESSION_SECRET: z.string().min(32),

  GOOGLE_CLIENT_ID: optionalCredential,
  GOOGLE_CLIENT_SECRET: optionalCredential,
  CF_OIDC_CLIENT_ID: optionalCredential,
  CF_OIDC_CLIENT_SECRET: optionalCredential,

  ALLOWED_EMAIL_SUFFIX: z.string().min(1).default('iiitp.ac.in'),
  SEED_SUPERADMIN_EMAILS: z.string().default(''),

  CF_MIN_INTERVAL_MS: z.coerce.number().int().min(1000).max(60_000).default(2200),
  LEADERBOARD_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(75),
  SOLVED_SYNC_USERS_PER_RUN: z.coerce.number().int().min(1).max(5000).default(350),
  SOLVED_SYNC_MAX_PAGES_PER_USER: z.coerce.number().int().min(1).max(100).default(20),
  JOB_TRIGGER_SECRET: optionalSecret,
}).superRefine((value, ctx) => {
  const appUrl = new URL(value.APP_URL);
  if (appUrl.pathname !== '/' || appUrl.search || appUrl.hash || appUrl.username || appUrl.password) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['APP_URL'],
      message: 'Must be an origin only, without credentials, path, query, or fragment.',
    });
  }
  if (value.NODE_ENV === 'production' && appUrl.protocol !== 'https:') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['APP_URL'],
      message: 'Must use HTTPS in production.',
    });
  }

  if (value.NODE_ENV !== 'production') return;
  for (const key of [
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
    'CF_OIDC_CLIENT_ID',
    'CF_OIDC_CLIENT_SECRET',
  ] as const) {
    if (!value[key]) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [key],
        message: 'Required in production.',
      });
    }
  }
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export const superadminEmails = env.SEED_SUPERADMIN_EMAILS.split(',')
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);
