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
audit_events, and cf_links. Spec §D migration 006 (club_teams) becomes 010 here. Always check the
last applied migration before creating a new one.

### Cron schedule (Hostinger)
```
0 * * * *    node dist/jobs/refresh-codeforces-leaderboard.js
0 21 * * *   node dist/jobs/sync-solved-counts.js        # 02:30 IST
30 22 * * *  node dist/jobs/retain-leaderboard-history.js
45 22 * * *  node dist/jobs/cleanup-sessions-and-links.js
```
If Hostinger Cron can't run arbitrary node commands, use the HTTP trigger fallback:
`JOB_TRIGGER_SECRET` env var + a protected route (Phase 7 admin panel, §B3.4).

## Leaderboard read API (Phase 4)

### Cursor pagination design
Keyset cursor encoding: `base64url(JSON({rating, maxRating, solvedCount, handle}))`. Sort-specific
`WHERE` clause continues after the last row of the previous page. The cursor is opaque to clients.
`limit+1` rows are fetched to detect whether a next page exists without a separate COUNT query.

### ratingChange30d computation
Computed per-row via correlated subquery joining `codeforces_rating_daily` today vs the nearest
snapshot ≤ 30 days ago. Acceptable at ~1,000 users. If staging EXPLAIN shows full scan, consider
precomputing in the nightly job or caching in a `ratingChange30d` column on `leaderboard_entries`.
**Record the EXPLAIN output here once the staging load test is done.**

### Disabled / previewOnly logic
`leaderboard_enabled = 'false'` in the `settings` table → public callers get `{disabled: true}`;
admin callers get full data with `meta.previewOnly = true`. The setting is read on every request
(no cache) so toggling takes effect immediately. The 60-second in-process cache is only for the
active snapshot metadata (snapshotId, completedAt) — not for the enabled flag.

### ETag design
`"{snapshotId}:{sha1(queryParams)[0:12]}"`. Stable for the lifetime of a snapshot (~refresh
interval). Different filter/sort combos get different ETags. Set `Cache-Control: public, max-age=60`.

### Hide-user instant effect
`show_in_leaderboard = 0` is applied at **read time** via the SQL JOIN on `users` — no snapshot
republish needed. This satisfies §B3.1 "applied at snapshot READ time, so instant".

### Teams CRUD audit trail
Every admin mutation (team create/update/delete, member create/update/delete) calls `audit.record`
in the same transaction. Action codes: `team.create`, `team.update`, `team.delete`,
`team.member.create`, `team.member.update`, `team.member.delete`.

### Settings audit trail
`settings.update` audit event written on every PATCH, with `before` = full previous state and
`after` = the patch payload.

### Public profile — 404-not-403
`GET /api/v1/profiles/:handle` returns 404 for: unknown handle, hidden user
(`show_in_leaderboard = 0`), suspended user, no active snapshot. Never 403 — this prevents
enumeration of which users exist but are hidden (§G).

## Browser CF subsystem (Phase 5)

### CF API CORS status
**PENDING** — Spike 1 not yet run. Open `/spike/cf` in a browser before implementing Phase 6
dashboard. If CF does NOT send `Access-Control-Allow-Origin`, the personal-dashboard design in
§A1/§C must be revisited immediately (flag to owner).

### Codeforces subsystem architecture
```
coordinator.ts          ← Vue composables call this; holds per-handle Vue refs
  ├── client.ts         ← CF API fetch (fetchProfile / fetchRatingHistory / fetchSubmissionsPage)
  │     └── queue.ts    ← Serialized promise chain; navigator.locks cross-tab; rate-limit
  ├── cache.ts          ← Dexie IndexedDB; memory fallback; stale-while-revalidate
  ├── normalize.ts      ← Raw CF → stored shapes; problemKey deduplication
  └── analytics.ts      ← Pure computation; used inline (<500 subs) or via worker (>500 subs)
        └── analytics.worker.ts  ← Web Worker; Vite bundles as separate ES chunk
```

### Queue serialization
`queue.ts` uses a module-level `_chain` promise (same pattern as `shared/cf-client.ts` on the
server). All calls from any part of the client share one queue per tab. Cross-tab: `navigator.locks`
with `ifAvailable: true` — only the leader tab runs refreshes. Non-leader tabs skip network but
still serve from IndexedDB.

### Stale-while-revalidate windows
- Fresh: <15 min since last fetch → serve from cache, no network call
- Stale window: 15–30 min → serve cache immediately + trigger background revalidation
- Stale: >30 min → show stale label, trigger revalidation

### Incremental submissions algorithm
1. First visit: fetch pages of 500 up to 2,000-cap; `lastSubmissionId` recorded
2. Subsequent visits: fetch page 1 (newest); if any `id ≤ lastSubmissionId` → stop; upsert new rows
3. `INSERT IGNORE` semantics in `cache.ts.upsertSubmissions` (bulkPut — Dexie overwrites on key)
4. Cap enforced: keep newest 2,000 by submissionId; older submissions dropped

### Problem key format (deduplication)
```
standard contest:  "${contestId}-${index}"      e.g. "1234-A"
gym / problemset:  "ps:${setName}:${name}"      fallback when contestId absent
```
Same key for re-submissions of the same problem → `uniqueAccepted` counts problems, not submissions.

### Session store (Pinia)
`client/src/stores/session.ts` replaces `auth/useMe.ts` module-level refs. The old `useMe.ts`
file still exists but is no longer imported anywhere — safe to delete in Phase 6 cleanup.
The new store exposes `isAdmin`, `hasCfLink`, `cfHandle` computed properties for use in
route guards and components without additional fetching.

### TanStack Query usage
`@tanstack/vue-query` is used for server-state: `/settings/public`, `/leaderboard`, `/teams`,
`/profiles/:handle`. Personal CF data (profile, ratings, submissions) is managed by the
coordinator's own Vue refs + Dexie — NOT by TanStack Query, because it needs custom staleness
logic and cross-tab coordination that Query's model doesn't fit.

## Testing
```
npm test                   # unit — no DB needed; runs rollno/permissions/cf-client tests (~115 s)
npm run test:integration   # spins up / reuses bitlegion-test-mysql on :3307; all integration tests
# client unit tests — Vitest not yet configured (see DECISIONS.md); deferred to Phase 6
```
Unit test count: **32** (10 Phase 1/2 + 22 Phase 3 cf-client).
Integration test count: **83** expected (32 Phase 1/2 + 17 Phase 3 jobs + 34 Phase 4) — run via `.\tests\run-integration.ps1`.

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
