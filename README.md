# BitLegion

College competitive-programming platform for IIIT Pune.
Spec: `bitlegion-phased-build-spec-v4.md`. **Agents: read `CONTEXT.md`, `PROGRESS.md`,
`HANDOFF.md` before touching anything (§0.1).**

## Stack
Vue 3 + Vite + TS (client) · Express + Node LTS + TS (server) · MySQL 8. One app, one DB.

## Quick start
```
npm install
cp .env.example .env                        # fill DB_* and SESSION_SECRET
npm run migrate --workspace=server          # apply migrations
npm run dev --workspace=server              # API on :3000
npm run dev --workspace=client              # UI on :5173 (proxies /api)
```

## Production shape
```
npm run build      # client → client/dist, server → server/dist
npm start          # Express serves the API and the compiled SPA
```

## Migrations
`server/src/db/migrations/*.sql`, filename-ordered, each with `-- up` and `-- down` sections.
`npm run migrate --workspace=server` applies pending; `-- down` rolls back the last one.
