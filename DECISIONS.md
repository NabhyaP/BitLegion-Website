# DECISIONS.md — append only

Format: `YYYY-MM-DD | decision | why | alternatives rejected`

2026-08-14 | Migration runner = filename-ordered `.sql` files with `-- up` / `-- down` sections + a `schema_migrations` table | Spec §0.4.10 forbids Prizma/ORMs; mysql2 is the only DB dep, and raw SQL files keep the DDL in §D byte-identical | node-pg-migrate style JS migrations (extra dep, DDL drifts from spec); umzug (dep for ~60 lines)

2026-08-14 | `job_runs` created in migration `002_job_runs.sql` instead of waiting for spec migration 005 | Phase 0 spike 4 must write a row to prove Hostinger Cron reaches MySQL, and there is nothing else to write to | Spike writing to a throwaway table (then it doesn't prove the real path); deferring spike 4 to Phase 3 (spec makes it a Phase 0 exit criterion). **Phase 3 must not re-create this table.**

2026-08-14 | Dev runs TypeScript directly via Node's `--experimental-strip-types`; production runs `tsc` output from `dist/` | Node 24 strips types natively, so no tsx/ts-node dependency; Hostinger runs plain compiled JS which is the safest deploy target | tsx (extra dep); ts-node (slower, ESM friction)

2026-08-14 | Phase 0 client is a two-page Vue app (hello + CF spike) with no Pinia, TanStack Query, or Tailwind | Phase 0's only client requirement is proving the Express→Vue fallback deploys; Phase 5 owns the real client foundation | Scaffolding the full §A2 client tree now (dead code across 5 phases, per §0.2's anti-scaffolding rule)

2026-08-14 | Roll number decodes as `11 | 24 | 15 | 119` — prefix, batch year, course code, serial. Course code → branch lives in an admin-editable `course_codes` table (15=CSE, 16=ECE), not in code | Owner confirmed the layout and asked for the mapping to be settable from the admin panel; a new course must not need a deploy | Hardcoding a TS map (needs a deploy per course); trusting only the email subdomain (breaks for students whose subdomain is missing/wrong). The subdomain is still the fallback when no course code matches.

2026-08-14 | `users.profile_confirmed` added in migration `004` although §D has no such column | §B4 requires onboarding fields to be "editable once", which needs persistent state; §D predates that requirement | Inferring it from non-NULL rollNo (breaks for students whose roll doesn't parse, and can't distinguish "parsed" from "confirmed by the student")

2026-08-14 | `audit_events` created in migration `005` instead of spec-numbered 007 | §H Phase 1 says "audit module (used from Phase 1 onward)", so the table must exist now; migrations are applied in filename order, not spec order | Waiting for Phase 7 (Phase 1 mutations would go unaudited, violating §G)

2026-08-14 | Google `hd` parameter is sent on the authorize request but the email-suffix check remains the enforcement | §B1 states `hd` is unreliable with department subdomains; sending it only improves the account picker UX | Trusting `hd` (spec explicitly forbids); omitting it (worse UX, no security difference)

2026-08-14 | Integration tests run with `--test-concurrency=1` and `--test-force-exit` | Node runs test FILES in parallel processes; sharing one MySQL meant one file's `resetDb()` truncated rows another was mid-test with (5 spurious failures, 0 when run singly). `--test-force-exit` because express-mysql-session holds a connection + reap timer open | Per-file databases (more setup than the suite is worth at this size); mocking MySQL (would stop testing the real SQL, which is the point of these tests)

2026-08-14 | TS parameter properties avoided in server code | Node's `--experimental-strip-types` (used for dev and tests) rejects them with ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX | Adding a transpile step for tests (slower, and diverges from how production runs)

2026-08-14 | `shared/contracts` and `tests/` created as placeholders only | §A2 mandates the layout, but inventing contracts before Phase 1 endpoints exist would be speculative | Omitting them (next session wouldn't know they're expected)

2026-08-14 | CF link attempts persisted in both the session AND `codeforces_link_attempts` DB table | Session alone is lost on server restart between start and callback; DB row adds durability and an expiry the DB enforces independently. `consumeLinkAttempt` is the authoritative single-use gate; the session copy is a fast consistency cross-check | Session only (not crash-safe); DB only (extra query on every /me hit — unnecessary)

2026-08-14 | CF OIDC `sub` claim used as the handle identifier, with a `handle` claim fallback | CF OIDC documentation shows `sub` = the CF handle (it is the account's primary identifier); a dedicated `handle` claim may be added by CF later — the fallback future-proofs this | Fetching user.info from CF API on the callback (extra CF call, extra latency, not needed since OIDC already proves ownership)

2026-08-14 | `unlinkCfHandle` is a soft delete (status = 'UNLINKED') not a hard DELETE | Historical leaderboard snapshots reference `codeforces_accounts.handle` via the snapshot's own denormalised `handle` column; a hard delete would only cascade-delete the account row, not the snapshot copies, so nothing is actually lost — but keeping the row makes admin reconciliation easier | Hard DELETE (spec says "historical leaderboard entries keep the handle used at that time" — satisfied by snapshot denormalisation either way, but soft delete is safer)

2026-08-14 | `meResponse()` in `users/router.ts` made async to fetch CF link inline | The simplest change with no architectural shift; one extra DB query per `/me` call (indexed PK lookup on `user_id`, negligible). No need for a separate `/me/codeforces` endpoint | Caching the CF link in the session (stale after unlink/re-link until next login); returning it only from a sub-route (extra round-trip for the client)
