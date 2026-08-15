# HANDOFF.md — overwritten every session

**Session:** 2026-08-14 · Phases 6, 7, 8 (product pages, admin panel, hardening)

## Done this session

### Phase 6 — Product pages
All product pages fully implemented and build-verified.

| File | What was built |
|------|----------------|
| `client/src/utils/rankColor.ts` | `rankInfo(rating)` → `{label, color}` — single rank→color util used everywhere |
| `client/src/pages/Dashboard.vue` | Stat row, SVG rating chart, tag donut (SVG), difficulty bars, practice calendar heatmap, language usage, freshness label, all §C4 failure states |
| `client/src/pages/Leaderboard.vue` | URL-driven filters (sort/batch/branch/search), 300 ms debounce, AbortController, keyset pagination, snapshot meta line, disabled/previewOnly states, ranking rules footnote |
| `client/src/pages/Teams.vue` | TanStack Query, sections per team, member cards with rank-colored handles |
| `client/src/pages/Profile.vue` | Server-only data, 404-not-403, stale notice, `profileUpdatedAt` age |
| `client/src/pages/Settings.vue` | Display name edit, CF link status/unlink, clear local data, sign out |

### Phase 7 — Admin panel
Full server-side admin module + all admin UI pages.

**Server** (`server/src/modules/admin/`):
- `repository.ts` — all admin SQL (list/edit/create members, handle issues, job runs, audit events, stats)
- `schemas.ts` — zod validators for all admin inputs
- `service.ts` — business rules; every mutation audited in same transaction; role guards
- `router.ts` — all §F admin routes; registered in `app.ts`

**Shared** — `AdminMemberResponse`, `AdminMembersPageResponse`, `CsvImportResult`, `HandleIssueResponse`, `AuditEventResponse`, `AuditEventsPageResponse`, `AdminStatsResponse` added to `shared/contracts/index.ts`

**Client API** (`client/src/api/index.ts`) — all admin fetch wrappers + `adminQueryKeys`

**Admin UI pages:**
| File | What was built |
|------|----------------|
| `AdminLayout.vue` | Dark nav bar, active-class on current section |
| `AdminMembers.vue` | List+filter+debounce, edit modal, roles modal, add single modal, CSV import with per-row error report, CF link clear |
| `AdminTeams.vue` | Full CRUD teams + members via modals |
| `AdminOps.vue` | Stats widget, Job 1 history + retry trigger, Job 2 history, handle reconciliation (recheck/unlink), signups bar chart |
| `AdminSettings.vue` | Leaderboard toggle + refresh interval + announcement banner with live preview |
| `AdminAudit.vue` | Paginated log, filter by action + actor, expandable rows showing before/after JSON |

### Phase 8 — Hardening
- **CSRF** — `server/src/middleware/csrf.ts`: `doubleCsrf` v4, `getSessionIdentifier`, OAuth callbacks excluded, wired into `app.ts` after session middleware
- **CSRF token endpoint** — `GET /api/v1/auth/csrf-token`
- **Client CSRF** — `getCsrfToken()` in `api/index.ts`; pre-warmed in `App.vue`; invalidated on logout in `session.ts`
- **CSP hardened** — `scriptSrc: ["'self'"]`, `frameSrc/objectSrc: ["'none'"]`, HSTS production-only
- **Seed script** — `server/src/scripts/seed.ts`; `npm run seed` alias at root
- **README runbook** — full deploy/migrate/seed/cron/rollback/admin guide
- **All TS errors fixed** — `noUncheckedIndexedAccess` guards (`!`), `@contracts` alias for client, server tsconfig `rootDir: ".."` to include `shared/`

## Verified this session
- `vue-tsc --noEmit` → **Exit 0** (client; 0 errors)
- `tsc -p tsconfig.json` → **Exit 0** (server; 0 errors)
- `vite build` → **121 modules, 0 errors, built in 2.71s**

## BLOCKED (owner action needed) 🔑
1. **Google OAuth + CF OAuth credentials** — needed for login→onboarding→link end-to-end
2. **Hostinger deployment** — needed for staging smoke tests and cron wiring
3. **Spike 1 (CF CORS)** — open `/spike/cf` in browser, record findings in CONTEXT.md

## Half-done / deliberate defers
- `client/src/auth/useMe.ts` — still exists, unused; safe to delete (mentioned since Phase 5)
- Load test (100 concurrent leaderboard readers with stubbed CF) — deferred to staging
- Mobile + keyboard smoke test on staging — deferred
- Backup restore drill — deferred (needs Hostinger)

## Next 3 concrete steps
1. Owner: configure Google OAuth + CF OAuth credentials and Hostinger deployment
2. Run `npm run migrate` + `npm run seed` on the deployed database
3. Log in with a `SEED_SUPERADMIN_EMAILS` address, verify admin panel, run a manual leaderboard refresh from Admin → Operations
