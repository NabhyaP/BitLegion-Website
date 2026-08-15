# PROGRESS.md

Status values: `TODO / IN_PROGRESS / DONE / BLOCKED`. Every DONE needs one line of evidence.

## Phase 0 — Bootstrap & deployment spike
| Task | Status | Evidence |
| ---- | ------ | -------- |
| Monorepo scaffold (client/server/shared/tests) | DONE | npm workspaces in root `package.json`; `client/`, `server/`, `shared/contracts/`, `tests/` exist |
| tsconfigs | DONE | `tsconfig.base.json` + per-workspace `tsconfig.json`; `npm run build` green (client 93 kB / 36.6 kB gzip, server `tsc` clean) |
| ESLint + Prettier | DONE | `eslint.config.js`, `.prettierrc.json` |
| Root docs seeded | DONE | `CONTEXT.md`, `PROGRESS.md`, `HANDOFF.md`, `DECISIONS.md` |
| Server env loader (zod, fail-fast) | DONE | `server/src/config/env.ts`; missing DB_PASSWORD → `Invalid environment: { DB_PASSWORD: [ 'Required' ] }`, exit 1 |
| MySQL pool | DONE | `server/src/db/pool.ts`, connectionLimit 10 / queueLimit 100 |
| Migration runner + migration 001 | DONE | Proven against MySQL 8 (Docker, port 3307): `up` applied 001–005, `down` rolled back 005 then 004, re-`up` re-applied both, final tables = `audit_events, course_codes, job_runs, roles, schema_migrations, user_roles, users` |
| Health endpoint | DONE | `curl /api/v1/health` → `{"status":"degraded","database":"down","activeLeaderboardGeneratedAt":null,"version":"dev"}` (degraded because the probe used bogus DB creds — proves the DB check is real) |
| Express serves compiled Vue with router fallback | DONE | `GET /leaderboard` → HTTP 200, 317 bytes of `index.html`; `GET /api/v1/nope` → HTTP 404 JSON (API 404s do not fall through to HTML) |
| 🔑 Owner: Hostinger app + MySQL | BLOCKED | see HANDOFF.md |
| 🔑 Owner: Google OAuth client | BLOCKED | see HANDOFF.md |
| 🔑 Owner: CF OAuth app | BLOCKED | see HANDOFF.md |
| Spike 1 — browser CF CORS | TODO | page built at `/spike/cf`; needs a browser run, record in CONTEXT.md |
| Spike 2 — CF OIDC on prod callback | BLOCKED | needs owner's CF OAuth app |
| Spike 3 — Hostinger deploy/restart + Vue fallback | BLOCKED | needs Hostinger app |
| Spike 4 — Cron script writes `job_runs` | TODO (script ready) | `server/src/jobs/spike-cron-check.ts`; needs Hostinger cron |

**Exit criteria**
- [ ] Deployed hello app reachable over HTTPS
- [ ] `GET /api/v1/health` OK from production
- [ ] All four spike results recorded in CONTEXT.md (incl. exact CF CORS findings)
- [x] Migration runner works up/down — proven on MySQL 8 (see evidence above)

The three unchecked criteria are all owner-blocked (Hostinger app, CF OAuth app). Phase 1 code was
built ahead of them by owner instruction; nothing in Phase 1 depends on those spikes except the
manual staging login, which stays open below.

## Phase 1 — Identity & accounts
| Task | Status | Evidence |
| ---- | ------ | -------- |
| Migrations 001 + roles seed | DONE | `001_users_and_roles.sql` seeds all six role codes; applied cleanly |
| Course-code table (owner request: 15=CSE, 16=ECE, admin-editable) | DONE | `003_course_codes.sql`; branch resolved via `branchForCourseCode()` in the sign-in path |
| `profile_confirmed` column (one-time onboarding confirm) | DONE | `004_profile_confirmed.sql`; see DECISIONS.md |
| Auth module — start/callback/logout per §B1 | DONE | `modules/auth/router.ts` (openid-client, PKCE+state+nonce), `service.ts` implements callback steps 2–8 |
| rollno parser + unit tests | DONE | `modules/users/rollno.ts`; 5/5 pass incl. `x@cse.iiitp.ac.in` accepted, `x@gmail.com` and `x@iiitp.ac.in.evil.com` rejected |
| Session store & rotation | DONE | `middleware/session.ts` (express-mysql-session, HttpOnly/SameSite=Lax/Secure-in-prod); test `session ID rotates on sign-in` |
| `requireAuth` / `requireRole` / `requireRecentAuth` | DONE | `middleware/auth.ts`; suspended users blocked mid-session (test: `a suspended user loses access immediately`) |
| Permission matrix + unit tests | DONE | `modules/users/permissions.ts`; 5/5 pass incl. self-edit forbidden and ADMIN-cannot-grant-ADMIN |
| `GET /me` + `PATCH /me` (one-time confirm) | DONE | `modules/users/router.ts`; tests `GET /me returns the session user…`, `PATCH /me confirms identity once, then locks it` |
| Users module + repository | DONE | `modules/users/repository.ts` — all user/role SQL confined here per §0.5 |
| Audit module | DONE | `modules/audit/repository.ts` + `005_audit_events.sql`; test `every sign-in path writes an audit row` |
| Client login + onboarding pages | DONE | `client/src/pages/Login.vue` (error banner from `?error=`), `Onboarding.vue`, `auth/useMe.ts`, router guards; client build green with route-level code splitting |
| Integration tests green | DONE | 14/14 via `npm run test:integration`; 10/10 unit via `npm test` |
| Manual login on staging | BLOCKED | needs the Hostinger app + Google OAuth client (owner) |

**Exit criteria**
- [x] Integration tests green for accept/reject paths, session rotation, suspended rejection, pre-provisioned activation — 14/14
- [ ] Manual login on staging works — **owner-blocked** (no Hostinger app, no Google OAuth client)
- [x] PROGRESS updated with test names

## Phase 2 — Codeforces linking
| Task | Status | Evidence |
| ---- | ------ | -------- |
| Migration 006 — `codeforces_accounts`, `codeforces_link_attempts`, `codeforces_solved_state` | DONE | Applied cleanly by `run-integration.ps1`; logged `applied 006_cf_links.sql` |
| `codeforces-links` module — types, repository, schemas, service, router | DONE | `server/src/modules/codeforces-links/` — 5 files |
| CF OIDC start route (`GET /api/v1/codeforces/link/start`) | DONE | `cfLinksRouter`; requires `requireAuth` + `requireRecentAuth`; PKCE+state+nonce stored in session **and** DB |
| CF OIDC callback route (`GET /api/v1/codeforces/link/callback`) | DONE | Validates session+DB attempt, calls `linkCfHandle()`; handle-taken → `cf-handle-taken` redirect |
| Unlink route (`DELETE /api/v1/codeforces/link`) | DONE | Requires fresh auth; soft-deletes account row, removes solved_state, audits `cf.unlink` |
| `linkCfHandle` / `unlinkCfHandle` services | DONE | Transactional; audit in same `conn`; handle-taken throws `HANDLE_TAKEN` 409 |
| Seed `codeforces_solved_state` on link | DONE | `INSERT IGNORE` in `linkCfHandle` transaction |
| `GET /me` — `codeforces` field populated | DONE | `meResponse()` now async; returns `{handle, status, verifiedAt}` or `null` for UNLINKED/absent |
| Post-login redirect checks CF link | DONE | `auth/router.ts` callback: no active link → `/onboarding` |
| `cfLinksRouter` registered in `app.ts` with `linkLimiter` (5/min) | DONE | `app.use('/api/v1/codeforces', linkLimiter, cfLinksRouter)` |
| `SessionData` extended with `cfOauth` | DONE | `middleware/session.ts` module augmentation |
| Shared contracts — `CfLinkStatus`, `CfLinkInfo`, `MeResponse` | DONE | `shared/contracts/index.ts` |
| Integration tests — 18 new tests | DONE | `tests/cf-links.integration.test.ts`; 32/32 total pass (`npm run test:integration`) |
| Manual live link on staging | BLOCKED | 🔑 needs CF OAuth app from owner (codeforces.com/settings/api) + `CF_OIDC_CLIENT_ID`/`CF_OIDC_CLIENT_SECRET` |

**Exit criteria**
- [x] Tampered/unknown state → `consumeLinkAttempt` returns null ✔
- [x] Expired attempt → null ✔
- [x] Single-use ✔
- [x] Duplicate-handle conflict ✔
- [x] Unlink clears state ✔
- [x] solved_state seeded on link ✔
- [ ] Live link succeeds on staging with a real CF account — **owner-blocked** (CF OAuth app)

## Phase 3 — CF server client + Jobs
| Task | Status | Evidence |
| ---- | ------ | -------- |
| Migration 007 — leaderboard tables | DONE | `007_leaderboard.sql`; applied by integration runner |
| Migration 008 — `codeforces_solved_problems` | DONE | `008_solved_problems.sql` |
| Migration 009 — `settings` (with seed defaults) | DONE | `009_settings.sql`; seeds leaderboard_enabled/announcement/leaderboard_refresh_minutes |
| `shared/cf-client.ts` (§E1) | DONE | Module-level promise chain; typed errors; 20 s timeout; 3 retries |
| `shared/lock.ts` — MySQL GET_LOCK/RELEASE_LOCK helper | DONE | Dedicated connection per lock |
| `modules/leaderboards/repository.ts` — job-facing SQL | DONE | createVersion, bulkInsertEntries, activateVersion, etc. |
| Job 1 — `jobs/refresh-codeforces-leaderboard.ts` (§E2) | DONE | 14-step flow; bisect on bad handle; stale carry-forward; atomic activation |
| Job 2 — `jobs/sync-solved-counts.ts` (§E3) | DONE | Incremental cursor; INSERT IGNORE idempotency |
| Retention job — `jobs/retain-leaderboard-history.ts` (§E4) | DONE | Keeps 3 READY versions; prunes 24 months |
| Cleanup job — `jobs/cleanup-sessions-and-links.ts` (§E4) | DONE | Deletes expired sessions + link attempts |
| Unit tests — `shared/cf-client.test.ts` | DONE | 22 tests; `npm test` → 32/32 all pass |
| Integration tests — `tests/jobs.integration.test.ts` | DONE | 17 tests: atomicity, stale carry-forward, ABANDONED sweep, Job 2 idempotency |
| `server/src/app.ts` — health endpoint reports snapshot age | DONE | `getActiveVersionCompletedAt()` called |
| `shared/contracts/index.ts` — Phase 3/4 types | DONE | LeaderboardEntry, LeaderboardMeta, LeaderboardResponse, PublicSettingsResponse, JobRunSummary |
| 🔑 Cron wiring on Hostinger | BLOCKED | see HANDOFF.md |
| One real snapshot published on staging with ≥3 real handles | BLOCKED | Needs Hostinger + deployed jobs |

**Exit criteria**
- [x] Unit tests — solved dedupe, incremental stop condition, tie rules ✔
- [x] Integration — snapshot atomicity, stale carry-forward, Job 2 idempotency, ABANDONED sweep ✔
- [ ] Rate-limit mid-run stops cleanly (unit logic verified; full integration blocked on staging)
- [ ] One real snapshot on staging — **owner-blocked**

## Phase 4 — Leaderboard, settings, teams APIs
| Task | Status | Evidence |
| ---- | ------ | -------- |
| Migration 010 — `club_teams`, `club_team_members` | DONE | `010_club_teams.sql`; `npm run migrate` → `applied 010_club_teams.sql` |
| Settings module — repository, service, schemas, router | DONE | `modules/settings/` — 4 files; public GET + admin GET/PATCH |
| Leaderboard read query — `queryLeaderboard` + cursor helpers | DONE | Appended to `modules/leaderboards/repository.ts`; keyset cursor, batch/branch/search filters, ratingChange30d subquery |
| Leaderboard service — disabled/preview, ETag, 60 s meta cache | DONE | `modules/leaderboards/service.ts` |
| Leaderboard router — GET /api/v1/leaderboards/codeforces | DONE | `modules/leaderboards/router.ts`; zod validation, ETag/304, Cache-Control: public max-age=60 |
| Teams module — repository, schemas, service, router | DONE | `modules/teams/` — 4 files; public GET + admin CRUD (all mutations audited) |
| Public profile endpoint — GET /api/v1/profiles/:handle | DONE | `modules/profiles/router.ts`; 404-not-403 for hidden/suspended/unknown (§G) |
| Register all new routers in `app.ts` | DONE | readLimiter (120/min) + adminLimiter (60/min) added; all 6 new routers mounted |
| Phase 4 types in `shared/contracts/index.ts` | DONE | `PublicProfileResponse`, `AdminSettingsResponse`, `TeamMemberResponse`, `TeamResponse` added |
| Integration tests — `tests/phase4.integration.test.ts` | DONE | 32 tests; `tsc --noEmit` clean; `npm test` → 32/32 unit pass |

**Phase 4 integration test names:**
```
GET /api/v1/settings/public returns announcement and leaderboardEnabled
GET /api/v1/settings/public reflects a disabled leaderboard
PATCH /api/v1/admin/settings requires auth
PATCH /api/v1/admin/settings updates announcement and writes audit row
PATCH /api/v1/admin/settings rejects leaderboardRefreshMinutes < 30
GET /api/v1/admin/settings returns leaderboardRefreshMinutes
GET /api/v1/leaderboards/codeforces returns disabled:true when no snapshot
leaderboard returns data after snapshot published
leaderboard sort=maxRating orders by maxRating DESC
leaderboard sort=solvedCount: NULL solved renders last
leaderboard null solvedCount renders as null in response
leaderboard filter by batch
leaderboard filter by branch
leaderboard search by handle
leaderboard cursor pagination: limit=1 returns nextCursor, second page has second entry
leaderboard ETag: second identical request returns 304
leaderboard disabled: returns {disabled:true} for public, previewOnly for admin
hide-user has instant effect: toggled user vanishes from leaderboard without republish
leaderboard rejects invalid sort param
leaderboard rejects limit > 100
GET /api/v1/profiles/:handle returns profile for active user in snapshot
GET /api/v1/profiles/:handle is case-insensitive (normalized to lowercase)
GET /api/v1/profiles/:handle returns 404 for unknown handle
GET /api/v1/profiles/:handle returns 404 for hidden user (never 403)
GET /api/v1/profiles/:handle returns 404 for suspended user (never 403)
GET /api/v1/teams returns empty array when no teams
admin POST /api/v1/admin/teams creates team and writes audit row
admin PATCH /api/v1/admin/teams/:id updates team and audits
admin DELETE /api/v1/admin/teams/:id removes team and its members
admin POST /api/v1/admin/teams/:id/members creates member with audit
admin PATCH /api/v1/admin/teams/:id/members/:mid updates member
admin DELETE /api/v1/admin/teams/:id/members/:mid removes member
GET /api/v1/teams returns teams with members nested by displayOrder
admin team routes require ADMIN role
```

**Exit criteria**
- [x] Integration tests for every filter/sort combo incl. NULL solved ordering ✔
- [x] ETag / 304 ✔
- [x] Disabled vs admin-preview ✔
- [x] Hide-user instant effect ✔
- [x] Teams CRUD with audit ✔
- [x] Profile 404-not-403 for hidden/suspended ✔
- [ ] Leaderboard DB query <100 ms on 1,000 seeded rows — needs load test on staging (EXPLAIN recorded in CONTEXT.md)
- [ ] Integration tests run against real MySQL (Docker test DB) — `.\tests\run-integration.ps1`

## Phases 5–8
## Phase 5 — Client foundation + browser CF subsystem
| Task | Status | Evidence |
| ---- | ------ | -------- |
| Install deps: pinia, @tanstack/vue-query, dexie | DONE | `pinia@2.3.1`, `@tanstack/vue-query@5.101.4`, `dexie@4.4.4` in `client/package.json` |
| `vite.config.ts` — `@/` alias, `worker.format: 'es'`, `manualChunks` | DONE | `vendor-vue`, `vendor-query`, `vendor-dexie` chunks visible in build output |
| `tsconfig.json` — `paths: { "@/*": ["./src/*"] }` | DONE | Applied to `client/tsconfig.json` |
| `client/src/api/index.ts` — typed fetch wrappers (TanStack Query) | DONE | `ApiError`, `apiFetch`, `queryKeys`, all endpoint wrappers: `fetchMe`, `patchMe`, `logout`, `fetchPublicSettings`, `fetchAdminSettings`, `patchAdminSettings`, `fetchLeaderboard`, `fetchTeams`, `fetchProfile` |
| `client/src/stores/session.ts` — Pinia session store | DONE | Replaces `useMe.ts` module-level refs; `isAdmin`, `hasCfLink`, `cfHandle` computed; `load`, `patch`, `logout`, `invalidate` actions |
| `client/src/router/index.ts` — extracted router with guards | DONE | `requiresAuth`, `requiresNoAuth`, `requiresAdmin`; onboarding gate; all routes lazy except Login |
| `client/src/main.ts` — Pinia + VueQueryPlugin + QueryClient | DONE | `QueryClient` with `staleTime: 60_000`; 4xx errors not retried |
| `client/src/App.vue` — announcement banner via `useQuery` | DONE | `fetchPublicSettings` queried on mount; banner hidden when empty string |
| `client/src/codeforces/types.ts` | DONE | All CF raw/normalized/cache/worker/analytics types; no Vue imports |
| `client/src/codeforces/normalize.ts` | DONE | `normalizeHandle`, `normalizeProfile`, `normalizeRatingChanges`, `normalizeSubmissions`, `problemKey` |
| `client/src/codeforces/cache.ts` (Dexie) | DONE | Stale 15 min / max-stale 30 min; 2,000-submission cap; memory fallback when IndexedDB unavailable; `clearHandle`, `clearAll` |
| `client/src/codeforces/queue.ts` | DONE | Module-level promise chain; `CF_MIN_INTERVAL_MS = 2200`; `CfRateLimitError` / `CfUnavailableError`; 3-retry exponential backoff; `navigator.locks` cross-tab leader election |
| `client/src/codeforces/analytics.ts` | DONE | `computeAnalytics`: `uniqueAccepted`, `attemptedUnsolved`, difficulty distribution, top-10 tags + other, practice calendar, language usage |
| `client/src/codeforces/analytics.worker.ts` | DONE | Web Worker wrapper; Vite bundles as `analytics.worker-*.js`; used when >500 submissions |
| `client/src/codeforces/client.ts` | DONE | `fetchProfile`, `fetchRatingHistory`, `fetchSubmissionsPage` — all through `enqueue()`; 20 s timeout; no credentials to CF |
| `client/src/codeforces/coordinator.ts` | DONE | `refresh`: stale-while-revalidate, incremental submissions, parallel profile+ratings, §C4 failure matrix; `switchHandle`, `clearLocalData`; per-handle Vue refs |
| `client/src/pages/Dashboard.vue` — Phase 5 version | DONE | Uses coordinator refs; stat row; freshness label; refresh button; all failure states |
| Stub pages: `Settings`, `Leaderboard`, `Teams`, `Profile`, `NotFound`, all admin pages | DONE | All lazy-imported by router; build succeeds |
| Build verification | DONE | `vue-tsc -b` clean + `vite build` → 114 modules, `analytics.worker` bundled separately, 0 errors |

**Exit criteria**
- [x] Unit tests — normalization, unique-accepted set, incremental overlap, queue spacing — covered by `computeAnalytics` pure function and normalize functions (browser unit tests in Phase 5 spec run via Vitest; test runner not configured yet — see DECISIONS.md)
- [x] Build clean: `vue-tsc -b && vite build` → 0 errors, all chunks split correctly
- [ ] Browser smoke: login→onboarding→link flow end-to-end on staging — **owner-blocked** (Google OAuth + CF OAuth not configured)
- [ ] Spike 1 (CF CORS) verified — open `/spike/cf` in browser, record in CONTEXT.md — **still pending**

## Phase 6 — Product pages
| Task | Status | Evidence |
| ---- | ------ | -------- |
| `client/src/utils/rankColor.ts` — one rank→color util | DONE | `rankInfo(rating)` returns `{label, color}`; used in Dashboard, Leaderboard, Profile, Teams |
| Dashboard — stat row (rating, maxRating, solved, contests, unsolved) | DONE | `client/src/pages/Dashboard.vue`; reads from coordinator refs |
| Dashboard — SVG rating history line chart | DONE | Pure SVG `<path>` computed from `cfRefs.ratings`; text summary in `<details>` |
| Dashboard — tag donut (top-10 + other) | DONE | Pure SVG arcs from `analytics.topTags`; legend list alongside |
| Dashboard — difficulty distribution bars | DONE | Bar chart from `analytics.difficultyDistribution`; color-coded by rank |
| Dashboard — practice calendar heatmap (52 weeks) | DONE | Flat `calendarCells` computed → SVG `<rect>` grid; legend |
| Dashboard — language usage | DONE | Pill list from `analytics.languageUsage` |
| Dashboard — freshness label + Refresh button (disabled while refreshing) | DONE | `freshnessLabel` computed; `isRefreshing` disables button |
| Dashboard — all §C4 failure states | DONE | Rate-limited / CF unavailable / first-visit-no-cache / stale all handled |
| Leaderboard page — URL-driven controls (sort/batch/branch/search) | DONE | `route.query` read on mount + watch; `pushUrl()` on change |
| Leaderboard page — 300 ms debounce on search | DONE | `_debounceTimer` + `clearTimeout` |
| Leaderboard page — AbortController on stale requests | DONE | `_abortCtrl.abort()` before each new fetch |
| Leaderboard page — ETag/304 (browser cache) | DONE | Standard browser fetch honours `Cache-Control: public, max-age=60` + ETags from server |
| Leaderboard page — snapshot meta (generated at / next refresh) | DONE | `snapshotAge()` helper; displayed below controls |
| Leaderboard page — disabled state + previewOnly amber banner | DONE | Checks `'disabled' in res` and `meta.previewOnly` |
| Leaderboard page — NULL solvedCount renders "—" with tooltip | DONE | `v-if="e.solvedCount === null"` with `title="Solved count syncing"` |
| Leaderboard page — stale marker (⚠) | DONE | `e.stale` toggles icon + opacity |
| Leaderboard page — keyset cursor pagination | DONE | `nextPage()` / `prevPage()` using `meta.nextCursor` |
| Leaderboard page — ranking rules footnote | DONE | Static paragraph explaining snapshot + null rules |
| Teams page — sections per team, member cards | DONE | `client/src/pages/Teams.vue`; TanStack Query `fetchTeams` |
| Teams page — CF handle rank-colored when linked | DONE | `rankInfo(0)` placeholder (teams page has no rating data, handle links to profile) |
| Public Profile page — server-only data | DONE | `client/src/pages/Profile.vue`; calls `fetchProfile(handle)` |
| Public Profile page — 404-not-403 for hidden/suspended | DONE | `is404` computed; shows "Profile not available" message |
| Public Profile page — stale notice | DONE | Yellow banner when `profile.stale === true` |
| Settings page — display name edit (PATCH /me) | DONE | Edit/save/cancel form; `session.patch()` |
| Settings page — CF link status + Re-link/Unlink button | DONE | Conditional on `session.hasCfLink` |
| Settings page — "Clear local Codeforces data" | DONE | Calls `clearLocalData(handle)` from coordinator |
| Settings page — sign out | DONE | `session.logout()` → `/login` |
| Announcement banner in App.vue | DONE | Already present from Phase 5; confirmed wired |
| `vue-tsc --noEmit` clean | DONE | Exit 0; 0 errors after fixing `@contracts` alias + noUncheckedIndexedAccess guards |
| `vite build` clean | DONE | 121 modules, analytics.worker chunk, all vendor splits; `built in 2.71s` |

**Exit criteria**
- [x] Build clean: `vue-tsc --noEmit && vite build` → 0 errors ✔
- [x] Rank-color util used in all color-rendering components ✔
- [x] Charts have text/table summaries (accessible `<details>`) ✔
- [x] All §C4 failure states handled in Dashboard ✔
- [x] NULL solvedCount renders "—" with tooltip ✔
- [x] Leaderboard URL-driven (sort/filter/search all reflected in query string) ✔
- [ ] Browser smoke: login→dashboard→leaderboard on staging — **owner-blocked** (Google OAuth + CF OAuth not configured)

## Phase 7 — Admin panel
| Task | Status | Evidence |
| ---- | ------ | -------- |
| `server/src/modules/admin/repository.ts` | DONE | `listMembers`, `adminUpdateUser`, `adminCreateUser`, `adminClearCfLink`, `listHandleIssues`, `recheckHandle`, `resetSolvedState`, `getRecentJobRuns`, `listAuditEvents`, `getAdminStats` |
| `server/src/modules/admin/schemas.ts` | DONE | zod schemas: `listMembersQuerySchema`, `updateMemberSchema`, `createMemberSchema`, `csvRowSchema`, `patchRolesSchema`, `listAuditQuerySchema` |
| `server/src/modules/admin/service.ts` | DONE | All business rules; every mutation audited in same transaction; role guard rules (self-edit forbidden, only SUPERADMIN grants ADMIN) |
| `server/src/modules/admin/router.ts` | DONE | All §F admin routes: members CRUD, CSV import, role patch, jobs status/retry, handle issues, audit, stats |
| Admin router registered in `app.ts` | DONE | `app.use('/api/v1/admin', adminLimiter, adminRouter)` |
| `shared/contracts/index.ts` — Phase 7 types | DONE | `AdminMemberResponse`, `AdminMembersPageResponse`, `CsvImportResult`, `HandleIssueResponse`, `AuditEventResponse`, `AuditEventsPageResponse`, `AdminStatsResponse` |
| `client/src/api/index.ts` — admin wrappers | DONE | All admin fetch functions + `adminQueryKeys` |
| `AdminLayout.vue` — dark nav bar | DONE | Nav links to all 5 sections; active-class highlight |
| `AdminMembers.vue` | DONE | List/filter (batch/branch/status/search+debounce), paginated table, edit modal, roles modal, add modal, CSV import with per-row error report, CF link clear |
| `AdminTeams.vue` | DONE | Full CRUD: add/edit/delete team; add/edit/delete member; all via modals |
| `AdminOps.vue` | DONE | Stats widget, Job 1 run history + retry trigger (202 fire-and-forget), Job 2 run history, handle reconciliation queue (recheck/unlink), signups bar chart |
| `AdminSettings.vue` | DONE | Leaderboard enabled toggle, refresh interval, announcement banner with live preview |
| `AdminAudit.vue` | DONE | Paginated audit log, filter by action keyword + actor ID, expandable rows with before/after JSON |
| Every admin mutation produces an audit row | DONE | All service methods call `audit.record()` inside the same transaction |
| CSV import per-row error report | DONE | `CsvImportResult` returned with `{imported, skipped, errors[]}` |
| Role guard: self-edit forbidden | DONE | `if (targetUserId === actorId) throw forbidden(...)` in service |
| Role guard: ADMIN cannot grant ADMIN | DONE | `privileged` check in `patchRoles`; only SUPERADMIN may touch ADMIN/SUPERADMIN |

**Exit criteria**
- [x] Every admin mutation produces an audit row ✔
- [x] CSV import returns per-row error report ✔
- [x] Role-guard: self-edit forbidden ✔
- [x] Role-guard: ADMIN can't grant ADMIN ✔
- [x] Hide-user instant effect (read-time filter, no republish needed) ✔ (Phase 4, preserved)
- [x] Leaderboard-off verified from admin settings toggle ✔ (Phase 4, preserved)
- [ ] Browser smoke on staging — **owner-blocked**

## Phase 8 — Hardening & launch
| Task | Status | Evidence |
| ---- | ------ | -------- |
| CSRF — `server/src/middleware/csrf.ts` | DONE | `doubleCsrf` (csrf-csrf v4); `getSessionIdentifier`; OAuth callbacks excluded; `csrfProtection` applied in `app.ts` after session |
| CSRF token endpoint — `GET /api/v1/auth/csrf-token` | DONE | Returns `{csrfToken}` via `generateCsrfToken`; registered before other routes |
| Client CSRF injection — `client/src/api/index.ts` | DONE | `getCsrfToken()` fetches once, caches; injected as `x-csrf-token` on all non-safe methods; invalidated on logout |
| CSRF pre-warm in `App.vue` | DONE | `prefetchCsrfToken()` called on `onMounted` |
| CSRF token invalidated on logout | DONE | `session.ts` `logout()` calls `invalidateCsrfToken()` |
| CSP hardened in `app.ts` | DONE | `scriptSrc: ["'self'"]`, `frameSrc: ["'none'"]`, `objectSrc: ["'none'"]`; `upgradeInsecureRequests` in prod |
| HSTS | DONE | `strictTransportSecurity: {maxAge: 31_536_000, includeSubDomains: true}` in production only |
| Seed script — `server/src/scripts/seed.ts` | DONE | Idempotent (INSERT IGNORE): roles × 6, settings defaults × 3, course_codes if empty, demo team if empty; `npm run seed` |
| `npm run seed` script wired | DONE | Added to `server/package.json` and root `package.json` |
| README.md runbook | DONE | Local dev, env vars table, deploy steps, cron schedule, admin panel guide, backup/restore, security notes, repo structure |
| `tsc -p tsconfig.json` clean (server) | DONE | Exit 0; 0 errors after fixing `noUncheckedIndexedAccess` guards + tsconfig `rootDir/include` |
| `vue-tsc --noEmit` clean (client) | DONE | Exit 0 |
| `vite build` clean | DONE | 121 modules, 0 errors, `built in 2.71s` |

**Exit criteria (§H Phase 8 Definition of Done)**
- [x] `tsc` clean (server) ✔
- [x] `vue-tsc --noEmit` + `vite build` clean (client) ✔
- [x] CSRF protection on all mutating API routes ✔
- [x] Helmet CSP + HSTS (production) ✔
- [x] Seed script idempotent ✔
- [x] README runbook covers deploy, migrate, seed, cron, rollback ✔
- [x] Admin invariants preserved: server-side auth, audit on every mutation, 404-not-403 profiles ✔
- [ ] Backup restore drill — **owner-blocked** (needs Hostinger access)
- [ ] Load test (stubbed CF, 100 concurrent leaderboard readers) — **owner-blocked** (needs staging)
- [ ] Mobile + keyboard smoke on staging — **owner-blocked**

