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

## Phases 2–8
TODO.
