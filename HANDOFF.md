# HANDOFF.md — overwritten every session

**Session:** 2026-08-14 · Phase 2 (Codeforces linking)

## Done this session

### Migration
- `006_cf_links.sql` — `codeforces_accounts`, `codeforces_link_attempts`,
  `codeforces_solved_state`; applied cleanly by the integration test runner.

### `server/src/modules/codeforces-links/`
| File | What it does |
|------|--------------|
| `types.ts` | `CfLinkStatus`, `CfAccount`, `CfClaims` types |
| `repository.ts` | All SQL for the three CF tables; `findAccountByUserId`, `findAccountByNormalizedHandle`, `upsertAccount`, `unlinkAccount`, `updateAccountStatus`, `createLinkAttempt`, `consumeLinkAttempt` (single-use, expiry-checked), `deleteExpiredAttempts`, `seedSolvedState`, `deleteSolvedState` |
| `schemas.ts` | `cfCallbackQuerySchema` (zod, validates `code` + `state` presence) |
| `service.ts` | `linkCfHandle` (upsert + solved-state seed + audit, all in one transaction); `unlinkCfHandle` (soft-unlink + solved-state delete + audit); `normalizeHandle` |
| `router.ts` | `GET /api/v1/codeforces/link/start` (requireAuth + requireRecentAuth, PKCE+state+nonce stored in session AND DB); `GET /api/v1/codeforces/link/callback` (validates session+DB attempt, calls `linkCfHandle`, redirects `/dashboard?linked=1`); `DELETE /api/v1/codeforces/link` (requireAuth + requireRecentAuth, calls `unlinkCfHandle`) |

### Changes to existing files
- `server/src/middleware/session.ts` — `SessionData` extended with `cfOauth?: {state,nonce,verifier}` (separate from `oauth` to avoid confusion with Google flow).
- `server/src/modules/auth/router.ts` — post-login redirect now checks CF link existence; no active link → `/onboarding` (previously only checked `isNew || !profileConfirmed`).
- `server/src/modules/users/router.ts` — `meResponse()` is now `async`; fetches `cfRepo.findAccountByUserId` and returns `{handle,status,verifiedAt}` or `null` for UNLINKED/absent. Phase 2 `codeforces: null` placeholder removed.
- `server/src/app.ts` — `linkLimiter` (5 req/min) added; `cfLinksRouter` registered at `/api/v1/codeforces` before the catch-all 404.
- `shared/contracts/index.ts` — `CfLinkStatus`, `CfLinkInfo`, `MeResponse` types added.
- `tests/helpers/db.ts` — `resetDb()` now truncates `codeforces_solved_state`, `codeforces_link_attempts`, `codeforces_accounts`; `seedCfLink()` helper added.
- `tests/cf-links.integration.test.ts` — 18 new tests (see PROGRESS.md for list).

## Verified this session
- `npm test` → **10/10 unit** (unchanged from Phase 1).
- `npm run test:integration` → **32/32** (18 new + 14 Phase 1; migration 006 applied cleanly).

## Half-done
Nothing mid-edit.

One deliberate stub still in code:
- `GET /api/v1/codeforces/link/start` and `/callback` will return an HTTP 500
  (the `cfConfig()` rejects with "not configured") until `CF_OIDC_CLIENT_ID`/`CF_OIDC_CLIENT_SECRET`
  are set. The service layer is complete and tested; only the OIDC network leg is missing.

## BLOCKED (owner action needed) 🔑
1. **Codeforces:** OAuth app at `codeforces.com/settings/api`, redirect URI
   `https://<domain>/api/v1/codeforces/link/callback`.
   → Set `CF_OIDC_CLIENT_ID` and `CF_OIDC_CLIENT_SECRET` in the Hostinger env panel.
   → Then do one end-to-end live link on staging and tick the last Phase 2 exit criterion.
2. **Hostinger + Google OAuth** (carried over from Phase 1) — still needed for the manual
   login test.
3. **Phase 0 spike 1** (CF CORS) — still unrun; open `/spike/cf` in a browser before Phase 5.

## Next 3 concrete steps
1. Owner creates the CF OAuth app → sets the two env vars → agent does one live link on staging.
2. Start Phase 3: `shared/cf-client.ts` (serialized CF API client, §E1) + Job 1 (leaderboard
   snapshot, §E2) + migrations 003 (leaderboard tables) and 004 (solved_problems).
   Note: migrations 003–005 in the spec correspond to the NEW tables in §D; they will be
   numbered 007+ here because 003–006 are already used. Check DECISIONS.md before creating.
3. Run Phase 0 CF CORS spike from a browser and record results in `CONTEXT.md` spike table
   before Phase 5 client work begins.

## Failing tests
None. 10/10 unit, 32/32 integration.

## Uncommitted local state
Still **no git repository** — nothing is committed. `git init` + initial commit is overdue.
Docker container `bitlegion-test-mysql` may be running on port 3307 (disposable).
