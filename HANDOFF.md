# HANDOFF.md — overwritten every session

**Session:** 2026-08-14 · Phase 3 (CF server client + Jobs)

## Done this session

### Migrations (007–009)
| File | What it creates |
|------|----------------|
| `007_leaderboard.sql` | `leaderboard_versions`, `leaderboard_entries`, `leaderboard_active`, `codeforces_rating_daily` |
| `008_solved_problems.sql` | `codeforces_solved_problems` (solved_state was already in 006) |
| `009_settings.sql` | `settings` table + seed: leaderboard_enabled=true, announcement='', leaderboard_refresh_minutes=60 |

### `server/src/shared/`
| File | What it does |
|------|-------------|
| `cf-client.ts` | Module-level promise chain serializes all CF API calls; `CF_MIN_INTERVAL_MS` spacing; 20 s timeout; `CfRateLimitError`/`CfHandleError`/`CfUnavailableError`; ≤3 retries (5s/20s/60s+jitter) on 5xx/network only; reads `process.env.CF_MIN_INTERVAL_MS` directly (no env.ts import so unit tests work without DB env vars); `_resetQueueForTests()` for test isolation |
| `lock.ts` | `withLock(name, fn)` — dedicated connection per invocation; `GET_LOCK(name, 0)` returns null immediately if lock is held; `RELEASE_LOCK` in finally |
| `cf-client.test.ts` | 22 unit tests; no DB needed; mocks `globalThis.fetch`; covers all typed errors, retry counts, rate-limit no-retry, handle error no-retry, tie-breaking sort, incremental stop, solved dedup |

### `server/src/modules/leaderboards/`
| File | What it does |
|------|-------------|
| `repository.ts` | All SQL for leaderboard tables: `createVersion`, `updateVersionStats`, `markVersionReady`, `markVersionFailed`, `abandonStaleRunningVersions`, `getActiveVersionId`, `getActiveVersionCompletedAt`, `activateVersion` (atomic READY + leaderboard_active upsert), `bulkInsertEntries` (chunks of 200), `getEntriesForVersion`, `upsertRatingDaily`, `pruneOldReadyVersions` (keep 3 READY), `pruneRatingDaily` (24 months) |

### `server/src/jobs/`
| File | Job code | Schedule |
|------|----------|---------|
| `refresh-codeforces-leaderboard.ts` | `lb-refresh` | `0 * * * *` (hourly) |
| `sync-solved-counts.ts` | `solved-sync` | `0 21 * * *` (02:30 IST) |
| `retain-leaderboard-history.ts` | `retain` | `30 22 * * *` |
| `cleanup-sessions-and-links.ts` | `cleanup` | `45 22 * * *` |

### Changes to existing files
- `server/src/app.ts` — health endpoint now calls `getActiveVersionCompletedAt()` so `activeLeaderboardGeneratedAt` is populated once a snapshot is published.
- `shared/contracts/index.ts` — added `LeaderboardEntry`, `LeaderboardMeta`, `LeaderboardResponse`, `PublicSettingsResponse`, `JobRunSummary`, `JobStatus` types.
- `tests/helpers/db.ts` — `resetDb()` extended with Phase 3 tables: `codeforces_rating_daily`, `leaderboard_entries`, `leaderboard_active`, `leaderboard_versions`, `codeforces_solved_problems`.
- `tests/jobs.integration.test.ts` — 17 new integration tests (see PROGRESS.md for full list).

## Verified this session
- `npm test` → **32/32 unit** (10 Phase 1/2 + 22 new Phase 3); all pass.
- Note: the two `5xx retry` tests each take ~25s and ~90s respectively due to real `setTimeout` delays in the retry logic. Total run ≈ 115s — expected, not flaky.
- Integration tests (`npm run test:integration`) require Docker + MySQL on :3307. **Not run this session** — Docker not confirmed available. Run them before declaring Phase 3 integration exit criteria met.

## Half-done / deliberate stubs
Nothing mid-edit.

One deliberate stub:
- `GET /api/v1/codeforces/link/start` and `/callback` still return HTTP 500 until `CF_OIDC_CLIENT_ID`/`CF_OIDC_CLIENT_SECRET` are set (carried from Phase 2).

## BLOCKED (owner action needed) 🔑
1. **Cron wiring on Hostinger** — add four cron entries:
   ```
   0 * * * *    node dist/jobs/refresh-codeforces-leaderboard.js
   0 21 * * *   node dist/jobs/sync-solved-counts.js
   30 22 * * *  node dist/jobs/retain-leaderboard-history.js
   45 22 * * *  node dist/jobs/cleanup-sessions-and-links.js
   ```
   → After wiring, trigger `lb-refresh` manually once and verify a row appears in `leaderboard_versions` with `status='READY'` and `leaderboard_active` is set.
2. **CF OAuth app** (carried from Phase 2) — set `CF_OIDC_CLIENT_ID` / `CF_OIDC_CLIENT_SECRET`.
3. **Hostinger + Google OAuth** (carried from Phase 1) — still needed for manual login test.
4. **Phase 0 spike 1** (CF CORS) — still unrun; open `/spike/cf` in a browser before Phase 5.

## Next 3 concrete steps
1. Owner deploys & wires cron → trigger `lb-refresh` manually → verify `leaderboard_active` has a READY version → tick the "one real snapshot" Phase 3 exit criterion.
2. Run `.\tests\run-integration.ps1` to verify all 49 integration tests pass (32 Phase 1/2 + 17 Phase 3 new). Fix any issues before moving to Phase 4.
3. Start Phase 4: leaderboard endpoint (`GET /api/v1/leaderboards/codeforces` — filters, sorts, cursor, ETag, disabled/preview), settings module (`/settings/public`), teams module, public profile endpoint. Migrations 006 (club_teams/club_team_members) already in the spec as §D migration 006 — that will be migration 010 here.

## Failing tests
None. 32/32 unit pass. Integration not run this session (Docker dependency).

## Uncommitted local state
Still **no git repository** — nothing is committed. `git init` + initial commit is overdue.
Docker container `bitlegion-test-mysql` may be running on port 3307 (disposable).
