# HANDOFF.md — overwritten every session

**Session:** 2026-08-14 · Phase 5 (Vue client foundation + browser CF subsystem)

## Done this session

### Dependencies installed
`pinia@2.3.1`, `@tanstack/vue-query@5.101.4`, `dexie@4.4.4` added to `client/package.json`.

### Build config
- `client/vite.config.ts` — `@/` alias, `worker.format: 'es'`, `manualChunks` (vendor-vue / vendor-query / vendor-dexie)
- `client/tsconfig.json` — `paths: { "@/*": ["./src/*"] }`

### New files created

| File | Purpose |
|------|---------|
| `client/src/api/index.ts` | All typed server API calls; `ApiError`; `queryKeys`; TanStack Query compatible |
| `client/src/stores/session.ts` | Pinia session store; replaces module-level refs in `useMe.ts` |
| `client/src/router/index.ts` | Extracted router; all guards; lazy routes |
| `client/src/codeforces/types.ts` | All CF/cache/analytics/worker types; no Vue |
| `client/src/codeforces/normalize.ts` | Raw CF → stored shapes; `problemKey` for deduplication |
| `client/src/codeforces/cache.ts` | Dexie IndexedDB; stale-while-revalidate; memory fallback |
| `client/src/codeforces/queue.ts` | Serialized queue; rate-limit; cross-tab navigator.locks |
| `client/src/codeforces/analytics.ts` | Pure `computeAnalytics`; no Vue; worker-safe |
| `client/src/codeforces/analytics.worker.ts` | Web Worker wrapper; >500 subs threshold |
| `client/src/codeforces/client.ts` | CF API fetch wrappers; all through queue |
| `client/src/codeforces/coordinator.ts` | Refresh logic; failure matrix; per-handle Vue refs |
| `client/src/pages/Dashboard.vue` | Phase 5 version: stat row, freshness, failure states |
| `client/src/pages/Settings.vue` | Account info, clear local CF data, sign out |
| `client/src/pages/NotFound.vue` | 404 catch-all |
| `client/src/pages/Leaderboard.vue` | Stub (Phase 6) |
| `client/src/pages/Teams.vue` | Stub (Phase 6) |
| `client/src/pages/Profile.vue` | Stub (Phase 6) |
| `client/src/pages/admin/*.vue` | All admin stubs (Phase 7) |

### Modified files
| File | Change |
|------|--------|
| `client/src/main.ts` | Wired Pinia + VueQueryPlugin + QueryClient |
| `client/src/App.vue` | Announcement banner via `useQuery`; announcement removed from nav |
| `client/src/pages/Dashboard.vue` | Replaced Phase 0 placeholder with Phase 5 CF coordinator integration |

## Verified this session
- `npx vue-tsc -b` → clean (0 errors)
- `npx vite build` → 114 modules transformed, 0 errors
- `analytics.worker-*.js` bundled as a separate chunk by Vite (Web Worker ES module)
- All vendor chunks split correctly (vendor-vue ~95 kB, vendor-dexie ~96 kB, vendor-query ~41 kB gzip-friendly)

## Half-done / deliberate stubs
- `client/src/auth/useMe.ts` still exists — the router guard in `main.ts` was previously imported from here; the new router imports from `stores/session.ts` instead. The old file is now unused but harmless. Can be deleted in Phase 6 cleanup.
- Phase 6 pages (Leaderboard, Teams, Profile) are stubs with a "Coming in Phase 6" message. All routing works.
- Admin pages (Phase 7) are stubs — routing works, auth guards active.
- Dashboard shows a stat row and freshness label but no charts — those are Phase 6.
- No browser unit tests (Vitest) configured yet — see DECISIONS.md for why this is deferred to Phase 6.

## BLOCKED (owner action needed) 🔑
1. **Spike 1 — CF CORS** — open `/spike/cf` in a browser on staging, paste exact results (including whether `Access-Control-Allow-Origin` header is present) into CONTEXT.md before starting Phase 6.
2. **Google OAuth + CF OAuth** (carried from Phase 1/2) — needed for login→onboarding→link end-to-end test.
3. **Cron wiring on Hostinger** (carried from Phase 3).

## Next 3 concrete steps
1. Open `/spike/cf` in a browser — verify CF API calls succeed from the browser (CORS) and record exact findings in CONTEXT.md. This gates Phase 6's dashboard implementation.
2. Run `.\tests\run-integration.ps1` to verify all integration tests (Phase 1–4) still pass after Phase 5 changes (no server-side changes were made, but good to confirm).
3. Start Phase 6: implement the full product pages — leaderboard (URL-driven controls, debounce, abort, ETag), dashboard widgets (rating chart, tag donut, difficulty bars, practice calendar), teams page, public profile, settings page (unlink + clear local data), rank-color utility.

## Failing tests
None known. `vue-tsc -b` + `vite build` clean. Server unit tests unchanged (32/32).

## Uncommitted local state
Still no git repository initialized. `git init` + initial commit is significantly overdue — covers Phases 0–5.
