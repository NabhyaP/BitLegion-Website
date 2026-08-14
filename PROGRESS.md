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
- [x] Tampered/unknown state → `consumeLinkAttempt` returns null — `consumeLinkAttempt with an unknown state returns null (tampered state)` ✔
- [x] Expired attempt → null — `consumeLinkAttempt with an expired attempt returns null` ✔
- [x] Single-use — `consumeLinkAttempt is single-use: second call returns null` ✔
- [x] Duplicate-handle conflict — `linking a handle already owned by ANOTHER user throws HANDLE_TAKEN` ✔
- [x] Unlink clears state — `unlinkCfHandle sets status to UNLINKED and removes solved_state` ✔
- [x] solved_state seeded on link — `linkCfHandle seeds a codeforces_solved_state row with zeroed counters` ✔
- [ ] Live link succeeds on staging with a real CF account — **owner-blocked** (CF OAuth app)

## Phase 3 — CF server client + Jobs
| Task | Status | Evidence |
| ---- | ------ | -------- |
| Migration 007 — `leaderboard_versions`, `leaderboard_entries`, `leaderboard_active`, `codeforces_rating_daily` | DONE | `007_leaderboard.sql`; applied by integration runner |
| Migration 008 — `codeforces_solved_problems` | DONE | `008_solved_problems.sql`; `codeforces_solved_state` already existed in 006 |
| Migration 009 — `settings` (with seed defaults) | DONE | `009_settings.sql`; seeds leaderboard_enabled/announcement/leaderboard_refresh_minutes |
| `shared/cf-client.ts` (§E1) — serialized queue, typed errors, retries, timeout | DONE | Module-level promise chain; CfRateLimitError/CfHandleError/CfUnavailableError; 20 s timeout; 3 retries 5s/20s/60s+jitter; reads process.env directly (no env.ts import) |
| `shared/lock.ts` — MySQL GET_LOCK/RELEASE_LOCK helper | DONE | Dedicated connection per lock; `withLock(name, fn)` returns null if lock not acquired |
| `modules/leaderboards/repository.ts` — all leaderboard SQL | DONE | createVersion, bulkInsertEntries, activateVersion, getEntriesForVersion, upsertRatingDaily, pruneOldReadyVersions, pruneRatingDaily, etc. |
| Job 1 — `jobs/refresh-codeforces-leaderboard.ts` (§E2) | DONE | 14-step flow; bisect on bad handle; stale carry-forward; atomic activation in single transaction; daily rating upsert; job_runs record |
| Job 2 — `jobs/sync-solved-counts.ts` (§E3) | DONE | Incremental cursor; INSERT IGNORE idempotency; accurate delta via pre-count; rate-limit stops cleanly; job_runs record |
| Retention job — `jobs/retain-leaderboard-history.ts` (§E4) | DONE | Keeps 3 READY versions; prunes rating_daily 24 months; prunes audit_events 24 months; deletes expired link attempts |
| Cleanup job — `jobs/cleanup-sessions-and-links.ts` (§E4) | DONE | Deletes expired sessions + link attempts; job_runs record |
| Unit tests — `shared/cf-client.test.ts` | DONE | 22 new tests; `npm test` → 32/32 (10 prior + 22 new) all pass |
| Integration tests — `tests/jobs.integration.test.ts` | DONE | 17 tests: atomicity, stale carry-forward, ABANDONED sweep, retention pruning, Job 2 idempotency, bulk insert, daily rating upsert |
| `tests/helpers/db.ts` — resetDb extended | DONE | Phase 3 tables added: leaderboard_entries, leaderboard_active, leaderboard_versions, codeforces_rating_daily, codeforces_solved_problems |
| `server/src/app.ts` — health endpoint reports snapshot age | DONE | `getActiveVersionCompletedAt()` called; `activeLeaderboardGeneratedAt` now populated |
| `shared/contracts/index.ts` — Phase 3/4 types | DONE | LeaderboardEntry, LeaderboardMeta, LeaderboardResponse, PublicSettingsResponse, JobRunSummary |
| 🔑 Cron wiring on Hostinger | BLOCKED | see HANDOFF.md for exact cron schedule |
| One real snapshot published on staging with ≥3 real handles | BLOCKED | Needs Hostinger + deployed jobs |

**Phase 3 unit test names (for reference):**
```
cf-client — typed errors
  returns CfUserInfo array on a 200 OK envelope
  throws CfRateLimitError on HTTP 429 (never retried)
  throws CfRateLimitError when CF envelope says FAILED with "limit"
  throws CfHandleError when CF envelope says FAILED with "not found"
  CfHandleError is never retried
  throws CfUnavailableError on HTTP 503
  succeeds if 5xx recovers on the third attempt
  throws CfUnavailableError on non-retried 4xx (e.g. 400)
  userStatus attaches handle to CfHandleError
  userStatus returns CfSubmission array on success
cf-client — problem key format
  standard contest submission key is "contestId-index"
  resubmission of same problem has the same key (idempotency)
leaderboard sort — tie rules
  higher rating sorts first
  equal rating: higher max_rating sorts first
  equal rating + equal max_rating: alphabetical handle (case-insensitive) sorts first
  handle comparison is case-insensitive
  positions are 1-based after sort
Job 2 — incremental stop condition
  stops fetching when a submission id ≤ lastSubmissionId is encountered
  does not stop if the entire page has ids > lastSubmissionId
Job 2 — solved deduplification
  re-submitting the same problem produces the same key (INSERT IGNORE is idempotent)
  Set-based in-run deduplication removes duplicate keys
  nonstandard problem key uses ps: prefix
```

**Exit criteria**
- [x] Unit tests — solved dedupe (resubmissions, nonstandard keys) ✔
- [x] Unit tests — incremental stop condition ✔
- [x] Unit tests — tie rules (rating DESC, max_rating DESC, handle ASC) ✔
- [x] Integration — snapshot atomicity (readers always see a READY version) ✔
- [x] Integration — stale carry-forward with stale=1 ✔
- [x] Integration — Job 2 run-twice ⇒ identical counts ✔
- [x] Integration — ABANDONED sweep for stale RUNNING versions ✔
- [ ] Rate-limit mid-run stops cleanly (verified by unit logic; full integration with real CF blocked on staging) — **owner-blocked**
- [ ] One real snapshot published on staging with ≥3 real handles — **owner-blocked** (Hostinger + Cron)
- [ ] Runbook notes in CONTEXT.md — see CONTEXT.md §Phase 3 section below

## Phases 4–8
TODO.
