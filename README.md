# Cabinet Dentaire Pro

Multi-tenant dental practice management platform (working name). French by default, English and Arabic (RTL).

> Status: **foundation release** — tenancy/RLS, auth, roles, patients, service catalog. See `docs/STATUS.md`
> for the exact coverage map. Not production-ready.

## Requirements
Node.js 22+ (tested on 25), Docker (for PostgreSQL 18).

## Setup
```bash
cp .env.example .env
npm install
npm run db:up
npm run db:migrate
npm run db:migrate -- --test
npm run db:seed
npx next dev --port 3010
```
Open http://localhost:3010 and sign in with the demo account from `.env.example`
(fictitious clinic and patients), or create a new clinic at `/register`.

## Checks
```bash
npm test                 # unit + integration (uses the cabinet_test database)
npx tsc --noEmit
npx eslint src tests scripts
npx next build
```

## Documentation
- `docs/ARCHITECTURE.md` — stack, tenant isolation (PostgreSQL RLS), consent model, money/date rules.
- `docs/STATUS.md` — requirement coverage map and ordered next steps.
- `AGENTS.md` — rules for coding agents (also loaded by Claude via `CLAUDE.md`).
