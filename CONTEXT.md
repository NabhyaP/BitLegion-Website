# CONTEXT.md — living project brain

Read this FULLY at session start. Update at session end with anything a stranger would need.

## What this is
BitLegion: college CP platform for IIIT Pune. Google sign-in restricted to `iiitp.ac.in`,
verified Codeforces handles via CF OIDC, personal dashboard (browser→CF direct, IndexedDB),
college leaderboard (server snapshot only), teams page, admin panel.
Authoritative spec: `bitlegion-phased-build-spec-v4.md` (treat as SPEC.md — read-only).

## Architecture in one paragraph
Modular monolith. One Express app serves `/api/v1/*` and the compiled Vue SPA (catch-all →
`index.html`). One MySQL 8 DB. Two data paths: (1) personal CF data never touches Express —
the browser calls public CF endpoints anonymously and caches in IndexedDB; (2) shared data
(accounts, teams, leaderboard snapshots) comes from MySQL. Cron jobs produce leaderboard
snapshots and solved counts; the public leaderboard NEVER calls CF during a request.

## Key decisions (see DECISIONS.md for the log)
- Node 24 LTS + `--experimental-strip-types` for dev; `tsc` build for production (`dist/`).
- Migration runner is filename-ordered `.sql` files with `-- up` / `-- down` sections plus a
  `schema_migrations` table. No migration framework (mysql2 only, no Prisma per §0.4.10).
- `job_runs` table pulled forward from spec migration 005 into `002_job_runs.sql` because the
  Phase 0 cron spike needs a write target. Phase 3 must NOT re-create it.

## Environment
All env var names are in `.env.example`. **Values live only in the Hostinger panel** and the
owner's vault — never in the repo. `server/src/config/env.ts` validates with zod and exits on
invalid config.

## Local setup that actually works
```
npm install
cp .env.example .env        # fill DB_* and SESSION_SECRET
npm run migrate --workspace=server          # up
npm run migrate --workspace=server -- down  # roll back last migration
npm run dev --workspace=server              # :3000
npm run dev --workspace=client              # :5173, proxies /api → :3000
npm run build && npm start                  # production shape: Express serves client/dist
```

## Spike results (Phase 0) — FILL THESE IN
| # | Spike | Status | Findings |
| - | ----- | ------ | -------- |
| 1 | Browser → CF `user.info` / `user.rating` / `user.status` under current CORS | PENDING | Run `/spike/cf` in a browser and paste exact results here, including whether CF sends `Access-Control-Allow-Origin`. If CORS is blocked, the personal-dashboard design in §A1/§C must be revisited before Phase 5 — flag to owner immediately. |
| 2 | CF OIDC against the production callback URL | PENDING (blocked on owner) | Needs the CF OAuth app from codeforces.com/settings/api. |
| 3 | Hostinger deploy/restart of pinned Node LTS serving the Vue fallback | PENDING (blocked on owner) | Record the pinned Node version and the exact start command. |
| 4 | Hostinger Cron Node script writes a `job_runs` row | PENDING (blocked on owner) | Cron entry: `node dist/jobs/spike-cron-check.js`. Verify the row appears. |

## Roll number layout (owner-confirmed 2026-08-14)
`112415119@cse.iiitp.ac.in` → `11 | 24 | 15 | 119`: prefix, batch year (2000+24 = 2024), course
code, serial. Course code → branch lives in the **admin-editable `course_codes` table**
(15=CSE, 16=ECE) — add new courses there, never in code. Parsing is isolated in
`server/src/modules/users/rollno.ts`; the branch falls back to the email subdomain when no course
code matches.

## CF OIDC linking module (Phase 2)

### Architecture decision: link attempts stored in both session AND DB
PKCE+state+nonce are written to `codeforces_link_attempts` (10-min TTL) at the same time as
the session. The DB copy survives a server restart between the start and callback requests;
the session copy is used as a fast consistency check. `consumeLinkAttempt` deletes the row
on first read regardless of outcome — single-use by construction.

### CF `sub` claim is the handle
CF OIDC uses the Codeforces handle as the `sub` claim. `router.ts` also checks for a
dedicated `handle` claim in case CF adds one, but falls back to `sub`. Handles are
normalised to lowercase (`normalizeHandle()`).

### Re-link path
`upsertAccount` uses `INSERT … ON DUPLICATE KEY UPDATE` on the `user_id` UNIQUE key.
`linkCfHandle` sets `wasRelink = true` when a previous non-UNLINKED row existed and includes
the old handle in the `before` field of the audit event.

### `codeforces_solved_state` seeded on link
`INSERT IGNORE` seeds a zero row so Job 2 (Phase 3) picks up the user in its next run.
On unlink the row is deleted; on re-link it is re-seeded (`INSERT IGNORE` is idempotent).

### `/me` codeforces field
`meResponse()` in `users/router.ts` is now `async`. It calls `cfRepo.findAccountByUserId`;
if the row is absent or `status = 'UNLINKED'` the field is `null`.

### Rate limit
`linkLimiter`: 5 req/min (process-local, per §F "link 5/min/user").

## CF server client + Jobs (Phase 3)

### cf-client.ts — serialization design
`server/src/shared/cf-client.ts` uses a module-level promise chain (`_chain`) so all CF API
calls in the process — across all jobs — share one queue and honour `CF_MIN_INTERVAL_MS` spacing.
The module reads `process.env.CF_MIN_INTERVAL_MS` directly (no import of `config/env.ts`) so unit
tests can import it without triggering the zod env validator.

### lock.ts — MySQL named locks
`server/src/shared/lock.ts` wraps `GET_LOCK(name, 0)` / `RELEASE_LOCK(name)` with a dedicated
pool connection per invocation (critical: `GET_LOCK` is session-scoped; reusing a pool connection
would steal the lock from an unrelated query). Returns `null` immediately if lock is held.

### Job 1 (lb-refresh) — snapshot atomicity
The critical section is: bulk-insert all entries → single connection transaction that updates
`leaderboard_versions.status='READY'` and upserts `leaderboard_active.version_id`. A crash before
that leaves the previous READY version live. A RUNNING version never becomes active.

### Job 1 — bisect on bad handle
When `cf.userInfo(batch)` throws `CfHandleError`, `bisectBadHandles()` binary-searches the batch
to isolate the bad handle(s), marks each `NOT_FOUND` in `codeforces_accounts`, and returns
the good results. One bad handle never fails others.

### Job 2 (solved-sync) — idempotency
`INSERT IGNORE codeforces_solved_problems` is the idempotency gate. Delta is computed by
counting pre-existing keys before the bulk insert, so `solved_count` only grows by actually-new
problems. Running the job twice on the same submissions produces identical counts.

### Migrations renumbering
Spec §D calls the leaderboard tables "003", solved_problems "004", settings "005". In this repo
those become 007, 008, 009 because 003–006 were already used for course_codes, profile_confirmed,
audit_events, and cf_links. Always check the last applied migration before creating a new one.

### Cron schedule (Hostinger)
```
0 * * * *    node dist/jobs/refresh-codeforces-leaderboard.js
0 21 * * *   node dist/jobs/sync-solved-counts.js        # 02:30 IST
30 22 * * *  node dist/jobs/retain-leaderboard-history.js
45 22 * * *  node dist/jobs/cleanup-sessions-and-links.js
```
If Hostinger Cron can't run arbitrary node commands, use the HTTP trigger fallback:
`JOB_TRIGGER_SECRET` env var + a protected route (Phase 7 admin panel, §B3.4).

## Testing
```
npm test                  # unit — no DB needed; runs rollno/permissions/cf-client tests (~115 s due to real retry delays)
npm run test:integration   # spins up / reuses bitlegion-test-mysql on :3307; 49 tests total
```
Unit test count: **32** (10 Phase 1/2 + 22 Phase 3 cf-client).
Integration test count: **49** expected (32 Phase 1/2 + 17 Phase 3 jobs) — run via `.\tests\run-integration.ps1`.

Note: `npm test` takes ~115 s because two retry tests use real `setTimeout` (5 s + 20 s + 60 s delays).
This is correct — the retry logic is real, not faked with fake timers.

### Phase 2 test names (for PROGRESS.md reference)
```
linkCfHandle creates an ACTIVE codeforces_accounts row
linkCfHandle is case-insensitive: Tourist and TOURIST both normalize to tourist
linkCfHandle seeds a codeforces_solved_state row with zeroed counters
linkCfHandle writes a cf.link audit row
linking a handle already owned by ANOTHER user throws HANDLE_TAKEN
linking the same handle for the SAME user (re-link) succeeds and updates the row
re-link writes a second cf.link audit row referencing the previous handle
unlinkCfHandle sets status to UNLINKED and removes solved_state
unlinkCfHandle writes a cf.unlink audit row
unlinkCfHandle throws FORBIDDEN when there is no active link
unlinkCfHandle throws FORBIDDEN when the account is already UNLINKED
GET /me returns codeforces: null when no link exists
GET /me returns codeforces handle after linking
GET /me returns codeforces: null after unlinking
consumeLinkAttempt with an unknown state returns null (tampered state)
consumeLinkAttempt with an expired attempt returns null
consumeLinkAttempt is single-use: second call returns null
a pre-provisioned user who activates on login can then link a CF handle
```

## Gotchas discovered
- Node's `--experimental-strip-types` rejects TS **parameter properties**
  (`constructor(readonly x: T)`). Use plain field assignments in server code.
- Integration tests MUST run with `--test-concurrency=1`. Node runs test files in parallel
  processes; sharing one MySQL caused 5 spurious failures via `resetDb()` races.
- Also need `--test-force-exit`: `express-mysql-session` keeps a connection and reap timer open,
  so the runner hangs after the last assertion.
- The client tsconfig sets `allowImportingTsExtensions` (Vite bundles, nothing is emitted); the
  server instead uses `rewriteRelativeImportExtensions` so `tsc` turns `.ts` imports into `.js`.
- `shared/cf-client.ts` does NOT import `config/env.ts` — it reads `process.env.CF_MIN_INTERVAL_MS`
  directly with a numeric fallback. This keeps unit tests runnable without DB env var setup.
  Jobs that call cf-client always run after env.ts has already validated at process startup.
- MySQL named locks (`GET_LOCK`) are session-scoped. `lock.ts` always uses a dedicated
  connection (not a pool connection) so the lock is never accidentally shared or released early.
- `pruneOldReadyVersions` uses a subquery with an alias (`keep_ids`) to work around MySQL's
  restriction on deleting from a table while selecting from it in the same query.
