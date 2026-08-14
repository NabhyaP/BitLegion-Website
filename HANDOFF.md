# HANDOFF.md — overwritten every session

**Session:** 2026-08-14 · Phase 4 (Leaderboard, Settings, Teams, Public Profile APIs)

## Done this session

### Migration 010
| File | What it creates |
|------|----------------|
| `010_club_teams.sql` | `club_teams`, `club_team_members` (§D spec migration 006) |

Applied: `npm run migrate` → `applied 010_club_teams.sql`

### New modules

| Module | Files | Routes |
|--------|-------|--------|
| `modules/settings/` | repository, service, schemas, router | `GET /api/v1/settings/public`, `GET/PATCH /api/v1/admin/settings` |
| `modules/leaderboards/` | router, service, schemas + read-layer appended to repository | `GET /api/v1/leaderboards/codeforces` |
| `modules/teams/` | repository, service, schemas, router | `GET /api/v1/teams`, `POST/PATCH/DELETE /api/v1/admin/teams[/:id]`, `POST/PATCH/DELETE /api/v1/admin/teams/:id/members[/:mid]` |
| `modules/profiles/` | router only | `GET /api/v1/profiles/:handle` |

### Changes to existing files
- `server/src/app.ts` — registered 6 new routers; added `readLimiter` (120/min) and `adminLimiter` (60/min).
- `server/src/modules/leaderboards/repository.ts` — appended `queryLeaderboard`, `getActiveVersionMeta`, `getActiveEntryByHandle`, `encodeCursor`, `decodeCursor`.
- `shared/contracts/index.ts` — added `PublicProfileResponse`, `AdminSettingsResponse`, `TeamMemberResponse`, `TeamResponse`.
- `tests/helpers/db.ts` — added `seedLeaderboardEntry`, `seedActiveSnapshot`; added `club_team_members`/`club_teams` to `resetDb()`.
- `tests/phase4.integration.test.ts` — 34 new integration tests.

## Verified this session
- `npm run migrate` → `applied 010_club_teams.sql` ✔
- `npx tsc --project server/tsconfig.json --noEmit` → clean ✔
- `npm test` → 32/32 unit tests pass ✔
- Integration tests (`tests/phase4.integration.test.ts`) written but **not yet run against a real MySQL** — Docker test DB required. Run `.\tests\run-integration.ps1` to verify.

## Half-done / deliberate stubs
Nothing mid-edit.

Deliberate limitations in Phase 4:
- Leaderboard rank is page-relative (1-indexed within the current page), not absolute global rank. Full absolute rank requires a COUNT(*) which is expensive at 1,000 rows with filters — this matches the spec's ROW_NUMBER recomputation intent and is consistent across pages when using cursor pagination.
- `ratingChange30d` in the leaderboard query uses a correlated subquery. For 1,000 rows this is acceptable; if profiling shows it's slow, it can be precomputed in a nightly job or cached in `codeforces_rating_daily`. Record the EXPLAIN output in CONTEXT.md after staging load test.

## BLOCKED (owner action needed) 🔑
1. **Cron wiring on Hostinger** (carried from Phase 3):
   ```
   0 * * * *    node dist/jobs/refresh-codeforces-leaderboard.js
   0 21 * * *   node dist/jobs/sync-solved-counts.js
   30 22 * * *  node dist/jobs/retain-leaderboard-history.js
   45 22 * * *  node dist/jobs/cleanup-sessions-and-links.js
   ```
2. **CF OAuth app** (carried from Phase 2) — set `CF_OIDC_CLIENT_ID` / `CF_OIDC_CLIENT_SECRET`.
3. **Hostinger + Google OAuth** (carried from Phase 1) — needed for manual login test.
4. **Phase 0 spike 1** (CF CORS) — open `/spike/cf` in a browser before Phase 5.

## Next 3 concrete steps
1. Run `.\tests\run-integration.ps1` to execute all integration tests (Phase 1–4) against the Docker test MySQL. Fix any failures before starting Phase 5.
2. On staging: trigger `lb-refresh` manually → verify `leaderboard_active` is set → hit `GET /api/v1/leaderboards/codeforces` → confirm data returns and `Cache-Control: public, max-age=60` header is present → run `EXPLAIN` on the leaderboard query with 1,000 rows and record in CONTEXT.md.
3. Start Phase 5: Vue shell scaffold, router + guards, TanStack Query api layer, session store, login/onboarding pages, and the entire `client/src/codeforces/` browser CF subsystem (queue, Dexie cache, normalize, incremental fetch, analytics + Web Worker, cross-tab coordinator).

## Failing tests
None. 32/32 unit pass. Integration tests (Phase 4) written but not yet run.

## Uncommitted local state
Still no git repository — nothing is committed. `git init` + initial commit remains overdue.
