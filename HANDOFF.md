# HANDOFF.md — overwritten every session

**Session:** 2026-08-14 · Phase 1 (Identity & accounts)

## Done
- **Migrations** 003 `course_codes` (admin-editable, 15=CSE/16=ECE), 004 `profile_confirmed`,
  005 `audit_events`. Runner proven up → down → re-up on MySQL 8.
- **Auth** (`modules/auth/`): openid-client PKCE+state+nonce start, callback validating the ID
  token then applying §B1 steps 2–8 in one transaction, logout. Redirect errors are exactly
  `not-college-email | account-suspended | oauth-failure`.
- **Users** (`modules/users/`): rollno parser (owner's `11|24|15|119` layout), repository holding
  ALL user/role SQL, `GET /me`, `PATCH /me` with the one-time identity confirm, pure permission
  matrix for role changes.
- **Middleware**: session (express-mysql-session, rotation helpers), requireAuth / requireRole /
  requireRecentAuth, requestId, error handler emitting the §F envelope with no stack or SQL.
- **Audit** (`modules/audit/`): writes on the transaction connection so events commit with the
  mutation they describe. Sign-in paths already emit `user.create` / `user.activate` / `role.grant`.
- **Client**: `/login` (error banner from `?error=`), `/onboarding`, placeholder `/dashboard`,
  `auth/useMe.ts` composable (all fetching lives there — templates stay presentation-only),
  router guards with lazy-loaded routes.

## Verified this session
- `npm test` → **10/10 unit** (parser incl. the `iiitp.ac.in.evil.com` rejection; permission
  matrix incl. self-edit forbidden and ADMIN-cannot-grant-ADMIN).
- `npm run test:integration` → **14/14** against real MySQL 8: accept/reject sign-in paths,
  unverified-email rejection, suspended rejection, pre-provisioned PENDING→ACTIVE activation,
  duplicate-google-sub conflict, audit-row-on-every-path, session rotation, mid-session suspension,
  one-time confirm lock, strict-schema rejection of injected `status`.
- `npm run build` green in both workspaces (client 97 kB / 38 kB gzip with split chunks).

## Half-done
Nothing mid-edit. Two deliberate stubs, both marked in code:
- `/me` returns `codeforces: null` — Phase 2 fills it in.
- `/dashboard` is a placeholder page; the real widgets are Phase 6.

## BLOCKED (owner action needed) 🔑
1. **Hostinger:** Node app (pinned LTS) + MySQL. Blocks Phase 0 spikes 3 & 4, deployment, and the
   Phase 1 "manual login on staging" exit criterion.
2. **Google Cloud:** OAuth 2.0 Web client, redirect `https://<domain>/api/v1/auth/google/callback`
   → GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET. **The auth code is complete but has never run
   against real Google** — only against verified-claims fixtures.
3. **Codeforces:** OAuth app at codeforces.com/settings/api, redirect
   `https://<domain>/api/v1/codeforces/link/callback`. Blocks Phase 0 spike 2 and all of Phase 2.
4. **Phase 0 spike 1 (CF CORS)** is still unrun: open `/spike/cf` in a browser. If CF blocks
   cross-origin reads, §A1/§C's whole personal-data design must change before Phase 5.

## Next 3 concrete steps
1. Once the Google client exists: set GOOGLE_CLIENT_ID/SECRET and do one real end-to-end login on
   staging with a college account, then tick the last Phase 1 exit criterion. Watch for the
   `hd`-vs-suffix behaviour with department subdomains.
2. Run the CF CORS spike and record the exact result in the CONTEXT.md spike table.
3. Start Phase 2 (§B2 Codeforces linking): migration 002 `codeforces_accounts` +
   `codeforces_link_attempts`, the link start/callback/unlink routes, handle-taken conflict, and
   seeding `codeforces_solved_state` on link. The OIDC plumbing in `modules/auth/router.ts` is the
   template to follow.

## Failing tests
None. 10/10 unit, 14/14 integration.

## Uncommitted local state
Still **not a git repository** — nothing is committed. `git init` plus an initial commit should be
the next session's first action (or the owner's).
A Docker container `bitlegion-test-mysql` may be left running on port 3307; it is disposable
(`docker rm -f bitlegion-test-mysql`) and the test script recreates it.
