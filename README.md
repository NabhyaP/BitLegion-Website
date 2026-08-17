# BitLegion

College competitive-programming platform for IIIT Pune.
Spec: `bitlegion-phased-build-spec-v4.md`. **Agents: read `CONTEXT.md`, `PROGRESS.md`, `HANDOFF.md` before touching anything (§0.1).**

## Stack
Vue 3 + Vite + TypeScript (client) · Express + Node.js LTS + TypeScript (server) · MySQL 8.
One Express app, one database, no microservices.

---

## Local development

```bash
npm install
cp .env.example .env          # fill in DB_* and SESSION_SECRET at minimum
npm run migrate               # apply all migrations
npm run seed                  # seed roles, settings defaults, demo team
npm run dev                   # API on :3000 + Vite on :5173
```

To test the leaderboard with several live Codeforces profiles while using only
one Google login, seed local fixture members and publish a normal snapshot:

```bash
npm run leaderboard:demo       # add fixtures and refresh the leaderboard
npm run leaderboard:demo:clear # remove fixtures and refresh again
```

Both commands refuse to run outside development or against a non-local database.

### Run tests
```bash
npm test                      # unit tests (no DB required; ~115 s for retry tests)
npm run test:integration      # integration tests — requires Docker MySQL on :3307
                              # (see tests/run-integration.ps1)
```

---

## Environment variables

Copy `.env.example` to `.env` and fill in values. Values **never** go in the repo.
In production, set them in the Hostinger Node app environment panel.

| Variable | Required | Notes |
|---|---|---|
| `NODE_ENV` | yes | `development` / `production` |
| `PORT` | yes | Default `3000` |
| `APP_URL` | yes | Origin only, e.g. `https://bitlegion.iiitp.ac.in` (HTTPS required in production) |
| `DB_HOST` | yes | Hostinger managed MySQL host |
| `DB_PORT` | yes | Default `3306` |
| `DB_USER` | yes | Least-privilege MySQL user |
| `DB_PASSWORD` | yes | |
| `DB_NAME` | yes | |
| `SESSION_SECRET` | yes | ≥32 random bytes — never reuse across environments |
| `GOOGLE_CLIENT_ID` | yes | From Google Cloud Console |
| `GOOGLE_CLIENT_SECRET` | yes | |
| `CF_OIDC_CLIENT_ID` | yes | From codeforces.com/settings/api |
| `CF_OIDC_CLIENT_SECRET` | yes | |
| `ALLOWED_EMAIL_SUFFIX` | no | Default `iiitp.ac.in` |
| `SEED_SUPERADMIN_EMAILS` | no | Comma-separated emails to auto-grant SUPERADMIN on first login |
| `CF_MIN_INTERVAL_MS` | no | Default `2200` — spacing between CF API calls |
| `LEADERBOARD_BATCH_SIZE` | no | Default `75` |
| `SOLVED_SYNC_USERS_PER_RUN` | no | Default `350` |
| `SOLVED_SYNC_MAX_PAGES_PER_USER` | no | Default `20` |
| `JOB_TRIGGER_SECRET` | no | At least 32 characters; required only for the HTTP cron fallback |
| `GIT_SHA` | no | Injected at deploy time for the health endpoint `version` field |

---

## Production deploy (Hostinger)

### First deploy

```bash
# 1. Push the repo; Hostinger builds automatically, or:
npm run build           # client/dist + server/dist

# 2. Set all env vars in Hostinger panel

# 3. Apply migrations
node server/dist/server/src/db/migrate.js   # via Hostinger SSH or Node script runner

# 4. Seed defaults (run once)
node server/dist/server/src/scripts/seed.js

# 5. Start
npm start
```

### Routine redeploy

```bash
npm run build
# Any new migrations:
node server/dist/server/src/db/migrate.js
# Restart Node app in Hostinger panel
```

### Rollback

```bash
node server/dist/server/src/db/migrate.js down   # rolls back ONE migration
# Redeploy previous build
```

---

## Cron jobs (Hostinger Cron)

Configure in Hostinger → Hosting → Cron Jobs. All times are UTC.

| Schedule | Command | Description |
|---|---|---|
| `0 * * * *` | `node server/dist/server/src/jobs/refresh-codeforces-leaderboard.js` | Leaderboard snapshot (hourly) |
| `0 21 * * *` | `node server/dist/server/src/jobs/sync-solved-counts.js` | Solved counts (02:30 IST) |
| `30 22 * * *` | `node server/dist/server/src/jobs/retain-leaderboard-history.js` | Prune old snapshots |
| `45 22 * * *` | `node server/dist/server/src/jobs/cleanup-sessions-and-links.js` | Expire sessions + link attempts |

**If Hostinger Cron cannot run Node commands:** use the HTTP trigger fallback.
Set `JOB_TRIGGER_SECRET` in env, then POST to `/api/v1/admin/jobs/leaderboard/retry` with
header `x-job-secret: <value>` (or use the Admin → Operations → Trigger refresh button).
The endpoint returns `202` only after the background job process has started.

### Registration-week note

New members' solved counts are synced nightly. The leaderboard copy reads:
_"Solved counts update daily and may take a few days for new members."_
Ratings refresh hourly from Job 1. No manual intervention is needed.
Linking or unlinking a Codeforces account also triggers Job 1 immediately; its MySQL named lock
prevents overlap with the fixed cron run.

---

## Admin panel

Visit `/admin` (requires ADMIN or SUPERADMIN role).

| Section | What you can do |
|---|---|
| Settings | Toggle leaderboard on/off, set announcement banner, adjust refresh interval |
| Members | List/search/filter, edit profile fields, manage roles, CSV bulk import, clear CF links |
| Teams | Full CRUD for org chart teams and member cards |
| Operations | View job run history, trigger leaderboard refresh, handle reconciliation queue, stats |
| Audit | Browse all audited mutations with before/after JSON |

### Granting the first SUPERADMIN

Set `SEED_SUPERADMIN_EMAILS=youremail@cse.iiitp.ac.in` in env and sign in with that Google
account. The server auto-grants SUPERADMIN on login. Then use the admin panel to grant ADMIN
to other admins.

### Leaderboard on/off

Admin → Settings → uncheck "Leaderboard enabled". Takes effect immediately — no restart,
no republish. Admins still see the data with a "Preview mode" banner.

### Hide a user from the leaderboard

Admin → Members → Edit → uncheck "Show in leaderboard". Applies instantly at read time
without publishing a new snapshot.

---

## Database backup & restore

Hostinger provides daily automatic MySQL backups. Before any migration or major change:

1. Download a backup from Hostinger → Databases → Backups.
2. To restore: import the `.sql` dump via Hostinger phpMyAdmin or SSH + `mysql` CLI.
3. Re-run `node server/dist/server/src/db/migrate.js` to ensure migrations are current.

If a migration stops in `APPLYING` or `REVERTING`, the runner intentionally refuses further
changes. Inspect and restore that migration's schema manually, then clear only its marker with
`node server/dist/server/src/db/migrate.js repair <migration-file>` and run migrations again.

---

## Security notes (§G)

- All API mutations require a valid **CSRF token** (double-submit cookie pattern).
  The Vue client fetches the token at app init from `GET /api/v1/auth/csrf-token`
  and injects it as `x-csrf-token` on every POST/PATCH/DELETE.
- Sessions are `HttpOnly; Secure; SameSite=Lax`; rotated on sign-in.
- Role and CF-link changes require **recent auth** (within 30 minutes).
- Admin routes perform server-side role checks even if the button is hidden.
- Emails are never exposed in public API responses.
- Audit events are written in the same DB transaction as every mutation.
- `helmet` sets CSP, HSTS (production), and other security headers.
- Cross-origin state-changing requests are rejected against the configured `APP_URL` origin.
- Rate limits: auth 10/min, link 5/min, writes 30/min, admin 60/min, public reads 120/min.

---

## Repository structure

Personal dashboard analytics and upcoming contests are fetched directly from Codeforces by the
browser. The shared leaderboard, cohort trends, and personal college comparison read only from
published database snapshots maintained by the scheduled jobs.

```
bitlegion/
  client/src/
    api/           # typed fetch wrappers + CSRF injection
    codeforces/    # browser CF adapter (no Vue; IndexedDB cache; analytics worker)
    pages/         # route-level components (presentation only)
    stores/        # Pinia: session store
    utils/         # rankColor utility
  server/src/
    config/env.ts  # zod-validated env; crash on invalid
    db/            # pool, migrations, migrate.ts runner
    middleware/    # session, auth, csrf, requestId, errorHandler
    modules/       # auth, users, codeforces-links, leaderboards,
                   # settings, teams, profiles, admin
    jobs/          # 4 scheduled jobs (cron)
    scripts/       # seed.ts
    shared/        # cf-client, lock, errors, logger
  shared/contracts/  # shared TS types (client + server)
  tests/             # integration tests (Supertest + test MySQL)
```
