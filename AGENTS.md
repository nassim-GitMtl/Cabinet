<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Cabinet Dentaire Pro — agent guide (Claude and Codex)

Multi-tenant dental clinic platform (FR default, EN, AR/RTL; DZD; Africa/Algiers).
Two agents alternate on this repo. The user resumes work by saying **"continue"**.

## Resume protocol ("continue")
0. Run `git status` and `git log -3`. The other agent may have stopped mid-step (token limit): if there are
   uncommitted changes or `docs/STATUS.md` has an "In progress" note, finish that work first.
1. Read `docs/STATUS.md` (coverage map + ordered "Next steps") and `docs/ARCHITECTURE.md` (binding decisions).
   The full product brief is `docs/BRIEF.md` when present; cite it by section (§N).
2. Take the first unchecked "Next steps" item. Build it end to end (schema → migration with RLS → service →
   actions → UI → FR/EN/AR strings → tests), not scaffolding across many areas.
3. Before ending: `npm test`, `npx tsc --noEmit`, `npx eslint src tests scripts`, `npx next build` all green;
   then update `docs/STATUS.md` (status, verification notes, next steps). Keep it honest: no "done" without tests.
4. Commit at the end of every turn (`git add -A && git commit`), message prefixed with the agent name, e.g.
   `[codex] invoices: issue + payments`. If stopping before the step is finished, add an "In progress" note
   at the top of `docs/STATUS.md` (what's done, what's left, failing checks) and commit anyway as WIP.
   Never run two agents on this folder at the same time.

## Non-negotiable rules
- Tenant data only through `tenantTx(ctx, …)` / `withDbContext`; never query tenant tables on the bare pool.
- Every service function checks a permission key (`requirePermission`) — never role names, never UI-only checks.
- New tenant tables: `organization_id` + migration ending with `SELECT app_private.apply_security();`;
  append-only tables registered in `app_private.append_only_tables()`. Add a cross-tenant integration test.
- Shared-profile reads go through `evaluateSharedAccess()` and are logged in `shared_access_events`.
  No staff/admin/emergency bypass of patient consent.
- Money: integer minor units + currency; use `src/lib/money.ts`. Dates: date-only strings never pass through timezones.
- Issued financial documents and signed clinical records are immutable; corrections are new linked records.
- No fake data, totals or integrations in the product UI. Unbuilt areas are hidden or labelled "coming soon".
  Demo data is fictitious and lives only in `scripts/seed.ts`.
- Every user-facing string in `messages/fr.json`, `en.json`, `ar.json` (same keys; a test enforces parity).
  Use logical CSS (`ms/me/ps/pe/start/end`), `<bdi>`/`dir="auto"` for user text.
- Mutations: `audit(tx, …)` in the same transaction, metadata without clinical content.
- Links styled as buttons: `ButtonLink`. Base UI `Button` never renders `<a>`.

## Commands
`npm run db:up` · `npm run db:migrate` · `npm run db:seed` · `npm run db:generate` · `npm test` ·
`npm run test:unit` · `npm run test:integration` · `npx next dev --port 3010`
