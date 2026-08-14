import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// Load .env from the monorepo root (two levels up from server/src/config/)
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../../../.env') });
import { z } from 'zod';

// ponytail: one flat schema, no per-module env slices. Split when a module needs isolation.
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  APP_URL: z.string().url(),

  DB_HOST: z.string().min(1),
  DB_PORT: z.coerce.number().int().positive().default(3306),
  DB_USER: z.string().min(1),
  DB_PASSWORD: z.string(),
  DB_NAME: z.string().min(1),

  SESSION_SECRET: z.string().min(16),

  // Phase 1/2 credentials — optional until those phases land.
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  CF_OIDC_CLIENT_ID: z.string().optional(),
  CF_OIDC_CLIENT_SECRET: z.string().optional(),

  ALLOWED_EMAIL_SUFFIX: z.string().default('iiitp.ac.in'),
  SEED_SUPERADMIN_EMAILS: z.string().default(''),

  CF_MIN_INTERVAL_MS: z.coerce.number().int().default(2200),
  LEADERBOARD_BATCH_SIZE: z.coerce.number().int().default(75),
  SOLVED_SYNC_USERS_PER_RUN: z.coerce.number().int().default(350),
  SOLVED_SYNC_MAX_PAGES_PER_USER: z.coerce.number().int().default(20),
  JOB_TRIGGER_SECRET: z.string().optional(),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export const superadminEmails = env.SEED_SUPERADMIN_EMAILS.split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);
