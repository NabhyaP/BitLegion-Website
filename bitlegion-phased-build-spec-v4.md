# BitLegion Platform — Phased Build Specification (v4, CORE SCOPE)

**Document status:** FINAL build instruction for AI coding agents working in **Antigravity**, executed **phase by phase across multiple agent sessions/accounts**.
**Supersedes:** v3 one-shot spec. Scope is CUT to the core product (see §0.2). Architecture is unchanged from "BitLegion Architecture v2.1".
**Deployment target:** Hostinger managed Node.js hosting — 4 CPU cores, 4 GB RAM, 100 GB NVMe, managed MySQL, Hostinger Cron.
**Core stack:** Vue 3 + Vite + TypeScript (client) · Express.js + Node.js LTS + TypeScript (server) · MySQL 8.
**Scale:** ~1,000 college users; 700–1,000 verified CF handles; normal 20–80 concurrent, peaks 150–300 (plan headroom 300–400); ~1,000 registrations in the first days.

---

# §0. READ THIS FIRST (every session, every agent)

## 0.1 Multi-session context protocol — MANDATORY

This project is built by MANY separate Antigravity sessions, possibly on different accounts. **No agent has memory of previous sessions.** The repository itself is the only shared memory. Therefore these files exist at repo root and are LAW:

| File | Purpose | Rules |
| --- | --- | --- |
| `SPEC.md` | This document, committed verbatim | Read-only. Never edit except via explicit owner instruction. |
| `CONTEXT.md` | Living project brain: architecture summary, key decisions + reasons, gotchas discovered, env/setup steps that actually worked, external accounts & where credentials live (names only, NEVER values) | **Read FULLY at session start. Update at session end** with anything a stranger would need. |
| `PROGRESS.md` | Phase/task checklist with status (`TODO / IN_PROGRESS / DONE / BLOCKED`), one line of evidence per DONE item (test name, command output summary) | Update after every completed task, not just at session end. Mark the exact task you stopped mid-way. |
| `HANDOFF.md` | Written at the END of every session: what was done, what is half-done (file + function + what's missing), next 3 concrete steps, any failing tests, any uncommitted local state | Overwritten each session; previous handoffs are summarized into CONTEXT.md if still relevant. |
| `DECISIONS.md` | Append-only log: `YYYY-MM-DD | decision | why | alternatives rejected` | Append whenever you deviate from SPEC.md ambiguity or choose between options. |

**Session start ritual (do in order, no exceptions):**
1. Read `CONTEXT.md`, `PROGRESS.md`, `HANDOFF.md`, then the SPEC section for the current phase.
2. Run the project (server + client + tests) to verify the previous session's claims. If reality disagrees with PROGRESS.md, fix PROGRESS.md first and note it in HANDOFF.md.
3. Continue from the first non-DONE task of the lowest incomplete phase. **Do not skip phases. Do not start a phase whose predecessor's exit criteria are unmet.**

**Session end ritual:** all code committed (small commits, conventional messages `feat(module): ...`, `fix:`, `chore:`); tests for the session's work passing; `PROGRESS.md`, `HANDOFF.md`, `CONTEXT.md`, `DECISIONS.md` updated; nothing important exists only in the chat.

**Hard rules for agents:**
- Never store secret VALUES in any repo file — only the env var NAME and where the value lives (Hostinger panel, owner's vault).
- Never "refactor everything" outside your phase's file scope. Cross-phase changes require a DECISIONS.md entry.
- If blocked on something only the owner can do (create OAuth app, DNS, Hostinger settings), write it under a `BLOCKED (owner action needed)` heading in HANDOFF.md and continue with the next unblocked task.

## 0.2 Scope — what to build and what NOT to build

**IN SCOPE (core product):**
1. College accounts via **Google sign-in restricted to `iiitp.ac.in`** email suffix.
2. **Verified Codeforces link** via Codeforces OpenID Connect (server-side).
3. **Personal dashboard** — browser-owned CF analytics (rating, max rating, rating graph, contests, solved count, **solved-by-tag donut**, difficulty distribution, practice calendar) from IndexedDB-cached public CF data.
4. **College leaderboard** — server snapshot; **search (name/handle)**, **batch-year filter**, branch filter, **sort by current rating / max rating / solved count**; paginated.
5. **Teams page** — club org chart: member cards with photo, name, role title, CF handle.
6. **Admin panel** — §B3 in full.
7. Site-wide `announcement` banner (a Settings string — NOT the posts system).

**OUT OF SCOPE — do NOT build, do NOT create tables, do NOT scaffold routes** (future phases, owner will re-scope later): curated practice sheets · Problem of the Day · posts/blog/editorials workflow · notes & bookmarks · discussions/comments · events · resources library · points ledger & claims · mentoring · team finder · badges · search · service worker · file uploads. If any of these leak into generated code, delete them.

## 0.3 UI policy — minimal on purpose
Club designers restyle later. Semantic HTML; plain Tailwind utilities or one plain CSS file per feature; no component libraries, themes, animations, custom fonts. Every page functional, readable, keyboard-navigable, mobile-usable — nothing more. STRICT separation: all data fetching/caching/computation in composables/stores/adapters; `.vue` templates are presentation-only and replaceable without touching logic.

## 0.4 Non-negotiable invariants
1. The browser never contains a Codeforces API secret. Personal dashboard uses only anonymous public CF endpoints.
2. Personal Codeforces requests do not pass through Express — browser → Codeforces directly, cached in IndexedDB.
3. The public leaderboard NEVER fetches Codeforces during a page request; it serves the active snapshot from MySQL.
4. A partially built snapshot is never publicly active — publication is an atomic version-pointer swap.
5. Client-computed data never becomes official rank/points.
6. Every administrative change is authorized server-side and written to `audit_events`.
7. Every external call has a timeout and bounded retry.
8. Every list endpoint has a maximum page size.
9. The system stays useful with last-successful data during any Codeforces outage.
10. Modular monolith: one Express app, one Vue app, one MySQL DB. No microservices, Redis, websockets, external queues, Prisma (use mysql2/promise), or SSR frameworks.
11. ALL server-side CF API traffic goes through one serialized client with ≥2,200 ms spacing between call starts.
12. Scheduled work is coordinated with a MySQL named lock (`GET_LOCK`) or lease row — never an in-process timer alone.

## 0.5 Code organization law
Each backend module: `router.ts`, `controller.ts`, `service.ts`, `repository.ts`, `schemas.ts` (zod), `types.ts`, tests. Controllers validate & delegate; services hold business rules; repositories hold ALL SQL. No SQL elsewhere. No business logic in routers/controllers. Shared request/response types in `/shared/contracts`.

---

# §A. ARCHITECTURE (unchanged backbone)

## A1. Two data paths

1. **Personal CF data:** student's browser calls public Codeforces API directly (`user.info`, `user.rating`, `user.status`), normalizes, caches in IndexedDB, computes analytics locally (Web Worker for heavy work). Personal, never official.
2. **Shared/authoritative data:** browser calls Express `/api/v1/*`; Express reads accounts, teams, settings, and precomputed leaderboard snapshots from MySQL. Job 1 batches all verified handles through `user.info` and publishes atomic snapshots. Job 2 maintains compact server-sourced **solved counts** so the leaderboard can sort by problems solved.

~~~mermaid
flowchart TD
    U["Student browser"] --> V["Vue 3 app"]
    V -->|"Personal profile & submissions"| C["Public Codeforces API"]
    V -->|"Accounts, teams, leaderboard"| E["Express.js API"]
    E --> M["MySQL"]
    J1["Job: leaderboard snapshot"] -->|"Batched user.info"| C
    J1 -->|"Atomic snapshot"| M
    J2["Job: rolling solved-count sync"] -->|"Incremental user.status"| C
    J2 -->|"Compact solved state"| M
~~~

| Concern | Browser | Express | MySQL | Codeforces |
| --- | --- | --- | --- | --- |
| Render pages & charts | Yes | No | No | No |
| Personal profile/rating/submissions | Yes | No | No | Source |
| Local personal cache | IndexedDB | No | No | No |
| Account & roles | No | Yes | Source of truth | No |
| Handle verification (OIDC) | Starts flow | Completes & stores | Source of truth | Identity provider |
| Leaderboard refresh | No | Scheduled job | Stores snapshot | Batched source |
| Leaderboard page | Requests API | Serves snapshot | Reads snapshot | Not contacted |
| Solved counts | No | Rolling job | Compact state | user.status source |
| Teams page & settings | Renders | Serves/administers | Source of truth | — |

One Hostinger Node web app: Express serves compiled Vue assets; `/api/v1/*` → Express routes; other paths fall back to Vue `index.html`. No CORS config needed.

## A2. Repository layout

~~~text
bitlegion/
  SPEC.md  CONTEXT.md  PROGRESS.md  HANDOFF.md  DECISIONS.md  README.md
  client/
    index.html  vite.config.ts
    src/
      main.ts
      api/                      # typed fetch wrappers (TanStack Query)
      auth/                     # session composable, route guards
      codeforces/               # BROWSER CF adapter (no Vue imports)
        client.ts  queue.ts  cache.ts  normalize.ts
        analytics.ts  analytics.worker.ts  coordinator.ts  types.ts
      components/               # dumb, presentation-only
      features/
        dashboard/  leaderboard/  teams/  onboarding/  admin/
      router/index.ts
      stores/                   # Pinia: session + tiny UI state only
  server/
    src/
      app.ts  server.ts
      config/env.ts             # zod-validated env; crash on invalid
      db/pool.ts  db/migrations/  db/migrate.ts
      middleware/               # session, requireAuth, requireRole, csrf,
                                # rateLimit, requestId, validate, errorHandler
      modules/
        auth/  users/  codeforces-links/  leaderboards/
        teams/  settings/  admin/  audit/
      jobs/
        refresh-codeforces-leaderboard.ts
        sync-solved-counts.ts
        retain-leaderboard-history.ts
        cleanup-sessions-and-links.ts
      shared/cf-client.ts  shared/logger.ts  shared/errors.ts  shared/lock.ts
  shared/contracts/
  tests/
~~~

## A3. Environment (`config/env.ts`, zod, fail-fast; values live in Hostinger panel)

~~~text
NODE_ENV  PORT  APP_URL
DB_HOST  DB_PORT  DB_USER  DB_PASSWORD  DB_NAME
SESSION_SECRET
GOOGLE_CLIENT_ID  GOOGLE_CLIENT_SECRET
CF_OIDC_CLIENT_ID  CF_OIDC_CLIENT_SECRET
ALLOWED_EMAIL_SUFFIX=iiitp.ac.in
SEED_SUPERADMIN_EMAILS=a@cse.iiitp.ac.in,b@cse.iiitp.ac.in
CF_MIN_INTERVAL_MS=2200
LEADERBOARD_BATCH_SIZE=75
SOLVED_SYNC_USERS_PER_RUN=350
SOLVED_SYNC_MAX_PAGES_PER_USER=20
JOB_TRIGGER_SECRET=            # only if Cron must use HTTP trigger fallback
~~~

---

# §B. FEATURE SPECIFICATIONS

## B1. Identity — Google sign-in (college restriction)

Server-side OIDC (Authorization Code + PKCE) via `openid-client`. Routes: `GET /api/v1/auth/google/start`, `GET /api/v1/auth/google/callback`, `POST /api/v1/auth/logout`.

Callback (exact order):
~~~text
1. Validate state/nonce/PKCE; verify ID token (issuer, audience, signature, expiry).
2. Reject unless email_verified === true.
3. email = claims.email.toLowerCase()
4. Reject unless email.endsWith(env.ALLOWED_EMAIL_SUFFIX)     // 'iiitp.ac.in'
   // Suffix check IS the enforcement. Dept subdomains (cse., ece., ...) make the
   // Google `hd` claim unreliable; it may be sent only as a login hint.
5. Lookup by google_sub; else by college_email (pre-provisioned CSV rows):
   attach google_sub; PENDING → ACTIVE.
6. Else create user; rollno.ts parses local-part:
   rollNo = digits; batch_year = 2000 + int(rollNo[2..4])     // '112415119' → '24' → 2024
   // TODO(spec): confirm digit positions with owner; parser isolated in one file.
   branch = subdomain before suffix, uppercased ('CSE').
7. status == 'SUSPENDED' → reject 'account-suspended'.
8. Regenerate session; store userId; email ∈ SEED_SUPERADMIN_EMAILS → ensure SUPERADMIN.
9. Redirect: no CF link → /onboarding, else /dashboard.
Errors land on /login?error= not-college-email | account-suspended | oauth-failure.
~~~
No password auth. Sessions: `express-session` + `express-mysql-session`; cookie HttpOnly, Secure (prod), SameSite=Lax, Path=/; rotated on sign-in & privilege change; no tokens in localStorage.

**Roles** (seeded): MEMBER, MENTOR, EDITOR, MODERATOR, ADMIN, SUPERADMIN. Everyone gets MEMBER. MENTOR/EDITOR/MODERATOR exist in the enum for future phases; only MEMBER/ADMIN/SUPERADMIN have behavior now. Rules: nobody edits their own roles; only SUPERADMIN grants/removes ADMIN; role/link changes require recent auth (<30 min). `requireAuth` / `requireRole` middleware + re-checks in services.

## B2. Codeforces linking (server-completed OIDC)

- `GET /api/v1/codeforces/link/start` (auth): create state/nonce/PKCE, persist in `codeforces_link_attempts` (10-min expiry), redirect to CF authorize endpoint from discovery `https://codeforces.com/.well-known/openid-configuration` (OAuth app registered at codeforces.com/settings/api — **owner action**).
- `GET /api/v1/codeforces/link/callback`: validate issuer/audience/signature/state/nonce/expiry; extract handle claim; normalize lowercase.
  - Handle already owned → `handle-taken` error.
  - Upsert `codeforces_accounts` (one active link per user; one owner per handle — DB unique constraints).
  - Seed `codeforces_solved_state` zeros (Job 2 picks the user up); next hourly snapshot adds them to the leaderboard.
  - Audit `cf.link`. Browser receives no CF secret. Redirect `/dashboard?linked=1` → client starts its IndexedDB fetch cycle.
- `DELETE /api/v1/codeforces/link` (fresh auth): status UNLINKED, clear solved-state rows, audit `cf.unlink`; client clears IndexedDB for that handle.
- Relink = unlink + link, both handles shown, fresh authentication, audited; historical leaderboard entries keep the handle used at that time.

## B3. Admin panel (REQUIRED, complete)

Vue `/admin/**`, API `/api/v1/admin/*`. Every mutation → `audit_events` in the same transaction.

**B3.1 Leaderboard controls** — master `leaderboard_enabled` toggle (off: public GET returns `{disabled:true}`; admins get data + `previewOnly:true` and an amber banner). Per-user `show_in_leaderboard` toggle — applied at snapshot READ time, so instant. Setting `leaderboard_refresh_minutes` (60 default, 30 min minimum) — informational for cron config.

**B3.2 Member management** — list with filters (batch year, branch, status, search name/email/handle; paginated). Edit: display name, roll no, batch year, branch, status (`ACTIVE|PENDING|SUSPENDED|ALUMNI`), show_in_leaderboard; clear CF link. **Add year-wise:** single form + **CSV import** (`display_name,college_email,batch_year,branch`; ≤2 MB, ≤2,000 rows; per-row validation report) creating pre-provisioned rows (`google_sub` NULL, PENDING) that activate on first matching Google login. Role assignment per B1 rules.

**B3.3 Teams management** — CRUD teams and member cards (link to user or free text for alumni); `display_order` integers for ordering.

**B3.4 Operations dashboard** — Job 1: last success/failure, snapshot age, handles requested/updated/stale/invalid, CF calls, rate-limit events, duration; **Retry** (authorizes ONE run under the same MySQL lock; returns immediately — never holds the HTTP connection during the refresh). Job 2: last run, users synced, oldest last_synced_at, errors; per-user **force resync**. Handle reconciliation queue (`NOT_FOUND | RENAMED_OR_MISMATCHED | TEMPORARY_ERROR`) with recheck/unlink actions. Health: DB reachable, app version (git SHA).

**B3.5 Settings** — `announcement` banner text (empty = hidden), plus B3.1 keys.

**B3.6 Audit viewer** — newest first; filter actor/action/date; shows actor, action, target, before/after summary, requestId, timestamp.

## B4. Frontend pages (minimal UI per §0.3)

Global: route-level code splitting; lazy chart lib & admin; TanStack Query for server state; announcement banner everywhere; "updated at" labels on all CF-derived data; consistent empty/loading/stale/error states; charts have text/table summaries; color never the only cue; rating colors always with rank text; one rank→color util (newbie<1200 … legendary≥3000).

- `/login` — Google button; error banner from `?error=`.
- `/onboarding` — until CF linked: confirm parsed rollNo/batch/branch (editable once), "Link Codeforces", "Skip for now".
- `/dashboard` (auth) — stat row (rating, max rating, solved, contests), rating line chart, **tag donut**, difficulty bars, practice calendar, manual Refresh (disabled during refresh), freshness label, per-widget failure states (§C4).
- `/leaderboard` — table: rank, name, handle, rating, maxRating, solvedCount, ratingChange30d, stale marker. Controls: search (300 ms debounce → `q`), batch `<select>`, branch `<select>`, sort `<select>`. URL-driven state; abort stale requests; "snapshot generated at / next refresh" line; published ranking rules; disabled state per B3.1. NULL solvedCount renders "—" (tooltip "syncing — updates daily").
- `/profile/:handle` (public) — server data only (leaderboard-entry fields + batch/branch); no CF calls; 404 (never 403) for hidden/suspended users.
- `/teams` — sections per team; card: photo, name, role_title, cf_handle (rank-colored when linked).
- `/settings` — display name, link status, unlink, "Clear local Codeforces data".
- `/admin/**` — plain tables/forms for all of B3; guarded by roles from `/me`; server re-checks everything.

---

# §C. BROWSER CODEFORCES SUBSYSTEM (client-owned)

All in `client/src/codeforces/`, no Vue imports.

**C1. Hard rules:** public methods only (`user.info`, `user.rating`, `user.status`); anonymous; no cookies/credentials to CF; never request/store a student's CF password or API key; the handle is identity, not a credential.

**C2. Queue:** one serialized queue per tab, ≥2,200 ms between call starts; exponential backoff + jitter after limit errors; bounded attempts; cross-tab coordination via `navigator.locks` (fallback BroadcastChannel) so one tab refreshes a handle at a time; refresh button disabled while active.

**C3. Cache (Dexie):** per handle: profile, rating history, normalized submissions, meta `{handle, schemaVersion, profileFetchedAt, ratingsFetchedAt, submissionsFetchedAt, lastSubmissionId, coverage:{complete, retainedSubmissionCount}}`. Serve cached instantly with freshness label; revalidate if >15 min (stale-while-revalidate; 10–30 min band). Invalidate fully on handle change. "Clear local Codeforces data" action. IndexedDB unavailable → memory-only + notice.

**Incremental submissions:** first visit pages of 500 up to 2,000-cap (explain limited coverage); later visits fetch newest page, stop at overlap with `lastSubmissionId`, upsert, dedupe by `submissionId`. Normalized fields: `submissionId, createdAt, contestId, problemIndex, problemName, rating, tags, verdict, language`; identity = `contestId+problemIndex` (careful fallback for nonstandard sets).

**Analytics** (pure `analytics.ts`; worker when >500 subs): current/max rating; contest rating changes; unique accepted set; attempted-unsolved; difficulty distribution; **topic totals → donut (top 10 + "other")**; language usage; practice calendar; recent activity.

**C4. Failure behavior (all rows):**
| Failure | UI |
| --- | --- |
| CF unavailable | Cached data + stale timestamp |
| Rate limit | Stop queue, keep cache, manual retry later, shared-campus-network notice |
| First visit, no cache | Compact error; rest of site fully usable |
| One method fails | Keep successful widgets, mark failed ones |
| Handle changed | Clear old cache first |
| Storage unavailable | Memory-only + notice |

Personal dashboard must never block the rest of BitLegion.

---

# §D. DATABASE — complete DDL (build ONLY these tables)

InnoDB, utf8mb4; snake_case in DB, camelCase in JSON; FKs with intentional delete behavior. Pool: mysql2/promise, single pool at boot, `connectionLimit:10`, `queueLimit:100`, release in `finally`, short transactions.

~~~sql
-- 001 users & roles
CREATE TABLE users (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  google_sub VARCHAR(64) NULL UNIQUE,
  college_email VARCHAR(190) NOT NULL UNIQUE,
  display_name VARCHAR(100) NOT NULL,
  roll_no VARCHAR(20) NULL,
  batch_year SMALLINT NULL,
  branch VARCHAR(16) NULL,
  status ENUM('ACTIVE','PENDING','SUSPENDED','ALUMNI') NOT NULL DEFAULT 'ACTIVE',
  show_in_leaderboard TINYINT(1) NOT NULL DEFAULT 1,
  avatar_url VARCHAR(500) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_users_cohort (status, batch_year, branch),
  INDEX idx_users_name (display_name)
);
CREATE TABLE roles (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code ENUM('MEMBER','MENTOR','EDITOR','MODERATOR','ADMIN','SUPERADMIN') NOT NULL UNIQUE
);
CREATE TABLE user_roles (
  user_id BIGINT UNSIGNED NOT NULL,
  role_id BIGINT UNSIGNED NOT NULL,
  granted_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, role_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE
);
-- sessions table managed by express-mysql-session.

-- 002 codeforces linking
CREATE TABLE codeforces_accounts (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL UNIQUE,
  handle VARCHAR(64) NOT NULL,
  normalized_handle VARCHAR(64) NOT NULL UNIQUE,
  verified_at TIMESTAMP NOT NULL,
  status ENUM('ACTIVE','NOT_FOUND','RENAMED_OR_MISMATCHED','TEMPORARY_ERROR','UNLINKED')
    NOT NULL DEFAULT 'ACTIVE',
  last_checked_at TIMESTAMP NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE codeforces_link_attempts (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  state VARCHAR(128) NOT NULL UNIQUE,
  nonce VARCHAR(128) NOT NULL,
  pkce_verifier VARCHAR(128) NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 003 leaderboard
CREATE TABLE leaderboard_versions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  status ENUM('RUNNING','READY','FAILED','ABANDONED') NOT NULL DEFAULT 'RUNNING',
  started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP NULL,
  handles_requested INT NOT NULL DEFAULT 0,
  handles_updated INT NOT NULL DEFAULT 0,
  handles_stale INT NOT NULL DEFAULT 0,
  cf_calls INT NOT NULL DEFAULT 0,
  error_summary VARCHAR(1000) NULL
);
CREATE TABLE leaderboard_entries (
  version_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  position INT NOT NULL,
  handle VARCHAR(64) NOT NULL,
  rating INT NOT NULL DEFAULT 0,
  max_rating INT NOT NULL DEFAULT 0,
  cf_rank VARCHAR(40) NULL,
  cf_max_rank VARCHAR(40) NULL,
  solved_count INT NULL,
  contribution INT NULL,
  last_online_at TIMESTAMP NULL,
  avatar_url VARCHAR(500) NULL,
  profile_updated_at TIMESTAMP NOT NULL,
  stale TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (version_id, user_id),
  FOREIGN KEY (version_id) REFERENCES leaderboard_versions(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_lb_rating (version_id, rating DESC, max_rating DESC),
  INDEX idx_lb_maxrating (version_id, max_rating DESC, rating DESC),
  INDEX idx_lb_solved (version_id, solved_count DESC),
  INDEX idx_lb_position (version_id, position)
);
CREATE TABLE leaderboard_active (
  id TINYINT UNSIGNED PRIMARY KEY,           -- always 1
  version_id BIGINT UNSIGNED NOT NULL,
  activated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (version_id) REFERENCES leaderboard_versions(id)
);
CREATE TABLE codeforces_rating_daily (
  user_id BIGINT UNSIGNED NOT NULL,
  snapshot_date DATE NOT NULL,
  rating INT NOT NULL,
  max_rating INT NOT NULL,
  solved_count INT NULL,
  PRIMARY KEY (user_id, snapshot_date),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 004 solved-count enrichment
CREATE TABLE codeforces_solved_state (
  user_id BIGINT UNSIGNED PRIMARY KEY,
  last_submission_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
  solved_count INT NOT NULL DEFAULT 0,
  last_synced_at TIMESTAMP NULL,
  last_error VARCHAR(500) NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE codeforces_solved_problems (
  user_id BIGINT UNSIGNED NOT NULL,
  problem_key VARCHAR(80) NOT NULL,          -- "contestId-index" or "ps:{setName}:{name}"
  PRIMARY KEY (user_id, problem_key),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 005 jobs & settings
CREATE TABLE job_runs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  job_code VARCHAR(60) NOT NULL,
  status ENUM('RUNNING','OK','FAILED') NOT NULL,
  started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at TIMESTAMP NULL,
  duration_ms INT NULL,
  detail JSON NULL,
  INDEX idx_job_runs (job_code, started_at DESC)
);
CREATE TABLE settings (
  skey VARCHAR(60) PRIMARY KEY,              -- 'leaderboard_enabled','announcement','leaderboard_refresh_minutes'
  svalue TEXT NOT NULL,
  updated_by BIGINT UNSIGNED NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- 006 club org chart (Teams page)
CREATE TABLE club_teams (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  display_order INT NOT NULL DEFAULT 0
);
CREATE TABLE club_team_members (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  team_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NULL,
  name VARCHAR(100) NOT NULL,
  role_title VARCHAR(100) NOT NULL,
  cf_handle VARCHAR(64) NULL,
  photo_url VARCHAR(500) NULL,
  display_order INT NOT NULL DEFAULT 0,
  FOREIGN KEY (team_id) REFERENCES club_teams(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- 007 audit
CREATE TABLE audit_events (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  actor_user_id BIGINT UNSIGNED NOT NULL,
  action VARCHAR(80) NOT NULL,
  target_type VARCHAR(40) NULL,
  target_id VARCHAR(60) NULL,
  before_json JSON NULL,
  after_json JSON NULL,
  request_id VARCHAR(60) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_audit_actor_time (actor_user_id, created_at DESC),
  INDEX idx_audit_time (created_at DESC)
);
~~~

---

# §E. JOBS

## E1. Server CF client (`shared/cf-client.ts`)
`userInfo(handles[], checkHistoricHandles=false)`, `userStatus(handle, from, count)`. Module-level promise chain serializes ALL calls; enforce `CF_MIN_INTERVAL_MS` between starts; 20 s timeout; check HTTP status AND CF envelope `{status:'OK'|'FAILED', comment?}`; typed errors `CfRateLimitError | CfHandleError(handle) | CfUnavailableError`; ≤3 retries (5 s/20 s/60 s + jitter) on network/5xx only; never retry 4xx.

## E2. Job 1 — leaderboard snapshot (`refresh-codeforces-leaderboard.ts`, hourly Cron)
Budget: 1,000 handles / batch 75 ≈ 14 calls ≈ ~31 s at 2.2 s spacing; ~336 calls/day.
~~~text
 1. GET_LOCK('bitlegion:cf-leaderboard', 0) or exit 0.
 2. INSERT leaderboard_versions RUNNING; job_runs 'lb-refresh' RUNNING.
 3. Read codeforces_accounts status IN ('ACTIVE','TEMPORARY_ERROR') join users
    (include ALL users regardless of show_in_leaderboard — hiding is read-time).
 4. Batches of LEADERBOARD_BATCH_SIZE, URL-safe.
 5. Sequential cf.userInfo per batch. On CF FAILED naming a bad handle: bisect the batch,
    mark offenders NOT_FOUND / RENAMED_OR_MISMATCHED, continue. One bad handle never fails others.
 6. Map each returned handle to expected user (normalized compare); mismatch → RENAMED_OR_MISMATCHED.
 7. Fetch-failed users: copy entry from previous READY version with stale=1.
 8. LEFT JOIN codeforces_solved_state → solved_count.
 9. position by default sort (rating DESC, max_rating DESC, normalized_handle ASC).
10. Bulk insert entries (chunks of 200).
11. ONE transaction: version READY + completed_at; UPSERT leaderboard_active.version_id.
12. Append codeforces_rating_daily per user (INSERT ... ON DUPLICATE KEY UPDATE).
13. job_runs OK {requested, updated, stale, calls, duration}.
14. finally RELEASE_LOCK. Crash before 11 → previous snapshot stays live;
    later runs mark RUNNING versions older than 30 min ABANDONED.
~~~

## E3. Job 2 — rolling solved-count sync (`sync-solved-counts.ts`, nightly 02:30 IST)
Exists ONLY because the leaderboard must sort by solved count; stores solved_count + dedupe keys, never submission histories.
~~~text
1. GET_LOCK('bitlegion:cf-solved', 0) or exit.
2. Pick ≤ SOLVED_SYNC_USERS_PER_RUN ACTIVE-linked users, oldest last_synced_at first (NULL first)
   → every user refreshed ≤ ~3 days at 1,000 users.
3. Per user (sequential, 2.2 s spacing):
     from=1; loop ≤ SOLVED_SYNC_MAX_PAGES_PER_USER:
       page = userStatus(handle, from, 500)
       newSubs = items with id > last_submission_id
       stop when page has id ≤ last_submission_id or empty; from += 500
     per newSub with verdict=='OK':
       problem_key = contestId!=null ? `${contestId}-${index}` : `ps:${problemsetName}:${name}`
       INSERT IGNORE codeforces_solved_problems; row actually added → solved_delta++
     tx: UPDATE codeforces_solved_state SET last_submission_id=max(id),
         solved_count = solved_count + solved_delta, last_synced_at=NOW()
4. Rate limit → stop run cleanly (rest picked up next night); record in job_runs.
5. Handle NOT_FOUND → set codeforces_accounts.status; skip.
6. RELEASE_LOCK; job_runs OK {usersSynced, cfCalls, newSolved}.
~~~
Idempotent by design (INSERT IGNORE + monotone cursor); heavy first syncs resume next run. Registration-week: full backfill takes a few nights — leaderboard copy: "Solved counts update daily and may take a few days for new members." Ratings are fresh hourly from Job 1.

## E4. Retention & cleanup (daily)
`retain-leaderboard-history.ts`: keep latest 3 READY versions (older cascade-deleted); ABANDON stale RUNNING; keep rating_daily 24 months; delete expired link_attempts; prune audit_events >24 months. `cleanup-sessions-and-links.ts`: expired sessions if the store doesn't self-clean.

**Cron (Hostinger, `node dist/jobs/<name>.js`):**
~~~text
0 * * * *    refresh-codeforces-leaderboard
0 21 * * *   sync-solved-counts            # 02:30 IST
30 22 * * *  retain-leaderboard-history
45 22 * * *  cleanup-sessions-and-links
~~~
If the panel can't run commands: protected HTTP trigger with `JOB_TRIGGER_SECRET` (constant-time compare) + same MySQL lock + replay protection. In-process timers alone are forbidden.

---

# §F. EXPRESS API

Conventions: base `/api/v1`; camelCase JSON; `{data, meta}` lists; UTC ISO-8601; opaque IDs; `limit` ≤100 leaderboard / ≤50 others; zod `.strict()` on params/query/body; body ≤100 KB; CSV ≤2 MB. Error envelope (no stack/SQL/env ever):
~~~json
{ "error": { "code": "VALIDATION_ERROR", "message": "One or more fields are invalid.",
             "fields": { "batch": "Unsupported value." }, "requestId": "req_..." } }
~~~

**Public / member:**
~~~text
GET  /api/v1/health                    # {status, database, activeLeaderboardGeneratedAt, version}; never calls CF
GET  /api/v1/me                        # profile, roles, cf link status, solved-state summary; no-store
GET  /api/v1/settings/public           # {announcement, leaderboardEnabled}
GET  /api/v1/leaderboards/codeforces   # contract below
GET  /api/v1/teams
GET  /api/v1/profiles/:handle          # public server-side profile; 404 for hidden/suspended
~~~

**Authenticated:**
~~~text
GET  /api/v1/auth/google/start    GET /api/v1/auth/google/callback    POST /api/v1/auth/logout
GET  /api/v1/codeforces/link/start  GET /api/v1/codeforces/link/callback  DELETE /api/v1/codeforces/link
PATCH /api/v1/me                   # displayName; onboarding one-time rollNo/batch/branch confirm
~~~

**Admin (roles as marked; ALL mutations audited):**
~~~text
GET/PATCH /api/v1/admin/settings                                  # ADMIN
GET   /api/v1/admin/members?year=&branch=&status=&q=&page=        # ADMIN
POST  /api/v1/admin/members            POST /api/v1/admin/members/import
PATCH /api/v1/admin/members/:userId    DELETE /api/v1/admin/members/:userId/codeforces-link
PATCH /api/v1/admin/members/:userId/roles                         # ADMIN ≤MODERATOR; SUPERADMIN for ADMIN
POST/PATCH/DELETE /api/v1/admin/teams[/:teamId]
POST/PATCH/DELETE /api/v1/admin/teams/:teamId/members[/:memberId]
GET  /api/v1/admin/jobs/leaderboard    POST /api/v1/admin/jobs/leaderboard/retry
GET  /api/v1/admin/jobs/solved-sync    POST /api/v1/admin/jobs/solved-sync/user/:userId
GET  /api/v1/admin/handle-issues       POST /api/v1/admin/handle-issues/:userId/recheck
GET  /api/v1/admin/audit-events?actor=&action=&page=
GET  /api/v1/admin/stats               # users, linked %, signups/day (7d)
~~~

**Leaderboard contract:**
~~~text
GET /api/v1/leaderboards/codeforces
    ?scope=all|batch|branch &batch=2027 &branch=CSE
    &q=text &sort=rating|maxRating|solvedCount &limit=50 &cursor=opaque
~~~
- Allow-list every sort/filter; parameterized SQL only.
- Reads ONLY the active version (`JOIN leaderboard_active`), filtered by `users.show_in_leaderboard=1 AND users.status='ACTIVE'` at read time.
- `sort=solvedCount`: `solved_count DESC NULLS LAST, rating DESC`; NULL renders "—".
- `rank` recomputed (ROW_NUMBER) for the requested sort/filter; `position` is only the default-sort precomputation.
- Entry: `{rank, userId, displayName, handle, batch, branch, rating, maxRating, codeforcesRank, ratingChange30d, solvedCount, avatarUrl, profileUpdatedAt, stale}`; meta: `{snapshotId, generatedAt, nextRefreshAfter, scope, limit, nextCursor, disabled?, previewOnly?}`. `ratingChange30d` from `codeforces_rating_daily` (today − 30d; NULL if insufficient), 60 s in-process cache.
- Never expose emails, roles, session IDs.
- ETag `"{snapshotId}:{queryHash}"`, `Cache-Control: public, max-age=60`, 304 support. Ranking rules published on the page.

**Middleware order:** requestId → pino-http (route template, duration; redact cookies/tokens/OIDC) → helmet (CSP `default-src 'self'`; `connect-src 'self' https://codeforces.com`; `img-src 'self' https: data:`) → compression → JSON limit → session → CSRF (double-submit on cookie-authed mutations) → rate limits (process-local buckets: auth 10/min/IP, link 5/min/user, writes 30/min/user, admin 60/min/user; link attempts also persisted in MySQL) → routers → errorHandler.

---

# §G. SECURITY, PRIVACY, OPERATIONS (implement all)

**Security:** parameterized SQL everywhere; zod at every boundary; helmet+CSP; CSRF; strict origin checks; session rotation; least-privilege MySQL user; secrets only in env; redacted logs; recent-auth (<30 min) for role/link changes; admin routes under explicit authorization middleware; server-side checks in services (hiding a button is not authorization); 404-not-403 for hidden profiles (no enumeration).

**Privacy:** never expose college emails in public APIs; short "what we store" page; avatar URLs stored only because displayed; deactivation is reversible status change; students can clear local IndexedDB; retention per §E4.

**Audit all of:** role changes; member edit/approval/suspension; CF link/unlink/relink; settings changes; job manual triggers; member import; team edits. Event = actor, action, target, before/after summary, requestId, timestamp; no secrets.

**Performance budgets:** public API p95 <300 ms; leaderboard DB query <100 ms; initial compressed JS <250–350 KB; 50-row leaderboard response <50 KB compressed; error rate <1%; pool wait ≈0; snapshot age <90 min. Techniques: needed-columns-only selects, composite indexes matching sort+filter, no N+1, compression, ETags from snapshot ID, debounced filters, aborted stale requests, lazy charts.

**Logging:** pino structured — timestamp, level, requestId/jobId, route template, duration, result code, safe error class. Never log cookies, tokens, OIDC payloads, or full CF responses.

**Backups:** Hostinger DB backups on; migrations in Git; restore tested before launch; documented restore owner.

---

# §H. PHASED DELIVERY PLAN (each phase ≈ one or more Antigravity sessions)

Rules: phases run IN ORDER; a phase starts only when the previous phase's **exit criteria** are all checked in `PROGRESS.md` with evidence; every phase ends with the §0.1 session-end ritual. Owner-action items are flagged 🔑 (agent lists them in HANDOFF.md and proceeds where possible with stubs/fixtures).

## Phase 0 — Bootstrap & deployment spike
**Goal:** repo skeleton + prove the four risky integrations before writing features.
**Tasks:** monorepo scaffold (client/server/shared/tests), tsconfigs, ESLint+Prettier, root docs (`CONTEXT.md`, `PROGRESS.md`, `HANDOFF.md`, `DECISIONS.md` seeded from this spec); server: env loader, pool, migration runner + migration 001; health endpoint; Express serving a compiled Vue "hello" page with router fallback; 🔑 owner creates Hostinger app + MySQL, Google OAuth client, CF OAuth app; spike proofs: (1) browser can call the required CF methods under current CORS behavior, (2) CF OIDC works against the production callback URL, (3) Hostinger deploys/restarts the pinned Node LTS and serves the Vue fallback, (4) a Hostinger Cron Node script connects to MySQL and writes a test `job_runs` row.
**Exit criteria:** deployed hello app reachable over HTTPS; `GET /api/v1/health` OK from production; all four spike results recorded in `CONTEXT.md` (including exact CF CORS findings); migration runner works up/down locally.

## Phase 1 — Identity & accounts
**Goal:** Google sign-in with college restriction, sessions, roles.
**Tasks:** migrations 001 complete + roles seed + superadmin seed; auth module (start/callback/logout per §B1); rollno parser (+unit tests incl. `x@cse.iiitp.ac.in` pass, `x@gmail.com` fail, `x@iiitp.ac.in.evil.com` FAIL); session store & rotation; `requireAuth`/`requireRole`; `/me`; `PATCH /me` (onboarding one-time confirm); users module + repository; audit module (used from Phase 1 onward).
**Exit criteria:** integration tests green for accept/reject paths, session rotation, suspended rejection, pre-provisioned activation; manual login on staging works; PROGRESS updated with test names.

## Phase 2 — Codeforces linking
**Goal:** verified handle ownership via CF OIDC.
**Tasks:** migrations 002; codeforces-links module per §B2 (state/nonce/PKCE, discovery, callback validation, handle-taken, unlink w/ fresh-auth, relink, audits); link-attempt expiry cleanup; seed `codeforces_solved_state` on link.
**Exit criteria:** tampered state/nonce/audience fixtures rejected in tests; duplicate-handle conflict test green; live link succeeds on staging with a real CF account; unlink clears state.

## Phase 3 — CF server client + Jobs
**Goal:** all scheduled data production.
**Tasks:** migrations 003–005; `shared/cf-client.ts` (§E1) with stubbed transport for tests; Job 1 exactly per §E2 (incl. bisect-on-bad-handle, stale carry-forward, atomic activation, ABANDONED sweep); Job 2 exactly per §E3 (idempotency!); retention + cleanup jobs; `job_runs` recording; MySQL lock helper; Cron wiring on Hostinger 🔑.
**Exit criteria:** unit tests — solved dedupe (resubmissions, nonstandard keys), incremental stop condition, tie rules; integration — staging+activation atomicity (readers mid-publish always see a complete version), failed-handle carry-forward stale=1, Job 2 run-twice ⇒ identical counts, rate-limit mid-run stops cleanly; one real snapshot published on staging with ≥3 real handles; runbook notes in CONTEXT.md.

## Phase 4 — Leaderboard, settings, teams APIs
**Goal:** the shared read surface.
**Tasks:** migrations 006; leaderboard endpoint per §F contract (filters, search, all three sorts, cursor pagination, rank recomputation, ratingChange30d, ETag/304, disabled & previewOnly, read-time hide filter); settings module (`/settings/public` + admin PATCH); teams module (public GET + admin CRUD); public profile endpoint.
**Exit criteria:** integration tests for every filter/sort combo incl. NULL solved ordering, ETag 304, disabled vs admin-preview, hide-user instant effect; leaderboard DB query <100 ms on 1,000 seeded rows (record EXPLAIN in CONTEXT.md).

## Phase 5 — Client foundation + browser CF subsystem
**Goal:** Vue shell and the personal-data engine.
**Tasks:** Vue scaffold, router + guards, api layer (TanStack Query), session store, login + onboarding pages; entire `client/src/codeforces/` per §C (queue, Dexie cache, normalize, incremental fetch, analytics + worker, cross-tab coordinator, failure matrix).
**Exit criteria:** unit tests — normalization, unique-accepted set, incremental overlap, queue spacing (fake timers); browser tests — first-visit-no-cache, warm stale revalidate, rate-limit stop + manual retry, handle-change cache clear; login→onboarding→link flow works on staging end-to-end.

## Phase 6 — Product pages
**Goal:** dashboard, leaderboard, teams, profile, settings pages per §B4.
**Tasks:** dashboard widgets (stat row, rating line chart, tag donut, difficulty bars, calendar, refresh, freshness, per-widget failures); leaderboard page (URL-driven controls, debounce, abort, snapshot/meta line, disabled state, "—" solved placeholder); teams page; public profile; settings page (unlink, clear local data); announcement banner everywhere; rank-color util.
**Exit criteria:** browser tests for leaderboard filtering/pagination and dashboard failure states; mobile + keyboard smoke pass; charts have text summaries; no logic inside `.vue` templates (spot-check listed in HANDOFF).

## Phase 7 — Admin panel
**Goal:** all of §B3.
**Tasks:** admin API routes (§F) + admin views: settings/toggles, member list/edit, single add + CSV import with per-row report, role management with all guard rules, teams CRUD, ops dashboard (both jobs, retry, force resync, handle reconciliation), audit viewer, stats.
**Exit criteria:** every admin mutation produces an audit row (test asserts it); CSV of 500 rows imports with row-level errors; hide-user & leaderboard-off verified from a public browser instantly; role-guard tests (self-edit forbidden, ADMIN can't grant ADMIN) green.

## Phase 8 — Hardening & launch
**Goal:** production readiness.
**Tasks:** full §G checklist sweep; load tests with STUBBED CF (never load-test real CF): 100 concurrent leaderboard readers, 20 concurrent `/me`, publish-during-reads; budgets verified; backup restore drill 🔑; seed script (roles, settings defaults, demo teams); README runbook (deploy, migrate, seed, cron, rollback step); registration-week plan noted (solved counts backfill over a few nights; ratings hourly); final `CONTEXT.md` cleanup so a brand-new session could operate the system.
**Exit criteria / Definition of Done:** account create+verify works; secure CF link; dashboard cached-first with no CF secret anywhere; snapshot-only leaderboard; failed refresh leaves previous board live; correct paginated filters incl. solved sort; admin: job status, invalid handles, member CRUD + year-wise CSV, leaderboard on/off + hide-user; teams page fully admin-driven; server-side permissions everywhere; headers/CSRF/validation on; backup restore tested; mobile + keyboard OK; logs have requestIds and no secrets; load budgets met; all invariants §0.4 re-verified and checked off in PROGRESS.md.

---

# §I. TESTING SUMMARY
- **Unit:** CF normalization/validation; unique-solved dedupe; incremental overlap; leaderboard sort/tie + rank recomputation; email-suffix gate; rollno parser; permission matrix; Job 2 idempotency.
- **Integration (Supertest + test MySQL):** auth accept/reject; session rotation/expiry; OIDC callback tamper fixtures; handle-taken; snapshot atomicity; stale carry-forward; leaderboard filters/sorts/cursor/ETag; disabled/preview; read-time hide; CSV import report; audit-on-every-mutation; retry-returns-immediately under lock.
- **Browser:** cache lifecycle, rate-limit behavior, partial failures, relink clears cache, leaderboard controls, keyboard-only admin flow, mobile smoke.
- **Load:** stub CF service only; budgets in §G.
