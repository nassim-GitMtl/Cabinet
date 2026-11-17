# Architecture — Cabinet Dentaire Pro

Source brief: the "Complete Dental Clinic Application — Master Build Prompt" (sections referenced as §N).
This file records decisions that every agent (Claude, Codex) must follow. Update it when a decision changes.

## Stack

| Layer | Choice | Notes |
| --- | --- | --- |
| Web app | Next.js 16.4 (App Router), React 19.3, TypeScript strict | `cacheComponents: false` on purpose: all authenticated pages render per request; never cache patient/clinical/financial data server-side. Next 16 renamed middleware to `src/proxy.ts`. Read `node_modules/next/dist/docs/` before using a Next API. |
| UI | Tailwind 4, shadcn/ui **base-nova** style on **Base UI** (`@base-ui/react`), lucide icons | `components.json` has `rtl: true` (logical `ms/me/ps/pe/start/end` classes). Links styled as buttons use `ButtonLink` (Base UI forbids rendering `<a>` through `Button`). Forms use native `<select>` (`SelectField`) for phone UX. |
| i18n | next-intl 4, no locale routing; cookie `NEXT_LOCALE` → `Accept-Language` → `fr` | `messages/{fr,en,ar}.json` must keep identical keys (unit test enforces). `<html dir="rtl">` for Arabic. User-entered text: use `<bdi>` / `dir="auto"`. |
| DB | PostgreSQL 18 (`uuidv7()`), Drizzle ORM 0.45 + drizzle-kit, `postgres` driver 3.4.x | v4 of the driver was skipped for compatibility. Money = `bigint` minor units, `mode: "number"` (safe-integer checked). |
| Tests | Vitest 4 projects: `unit` (`src/**/*.test.ts`) and `integration` (`tests/integration`, real Postgres `cabinet_test`) | `server-only` is aliased to an empty module in tests and scripts (`tsconfig.scripts.json`). |
| Jobs / storage | **Planned**: pg-boss (Postgres queue + transactional outbox), S3-compatible private object storage (MinIO in dev) | Not installed yet. |

## Code layout

```
src/
  app/(auth)/…            login, register (clinic onboarding), select-clinic
  app/(app)/…             staff app: dashboard, patients, catalog, settings
  components/ui/          generated shadcn components (regenerate with the CLI; small local size tweaks for touch)
  components/             app-level shared components (form fields, ButtonLink, shell)
  features/<feature>/     server.ts (service functions: permission check + tenantTx + audit),
                          actions.ts ("use server" wrappers: parse FormData, map errors, revalidate),
                          schemas.ts (zod), components/ (client UI)
  server/
    db/schema/*.ts        Drizzle schema (platform, patients, consent, catalog)
    db/client.ts          runtime pool as `cabinet_app` (RLS enforced)
    db/tenant.ts          withDbContext / nextCounter
    auth/                 password (scrypt), session (DB sessions), context (DAL: requireClinicContext, can, tenantTx)
    authz/permissions.ts  permission keys + role templates
    consent/evaluate.ts   pure shared-profile access decision
    services/             onboarding (registerClinic), auth (authenticate, listMyClinics)
    audit.ts              audit(tx, …) inside the caller's transaction
drizzle/                  SQL migrations (0000 extensions, 0001 core tables, 0002 RLS/grants)
scripts/                  migrate.ts, seed.ts (fictitious demo data)
tests/                    integration tests + support (global setup resets cabinet_test)
```

## Tenant isolation (§4A, §27, §28)

1. Two DB roles: `cabinet_owner` owns the schema and runs migrations; `cabinet_app` is the runtime role (NOSUPERUSER, NOBYPASSRLS).
2. Every tenant table has `organization_id`. Migration `0002_security.sql` defines `app_private.apply_security()`, which enables RLS and creates `tenant_isolation` (USING + WITH CHECK `organization_id = app_private.current_org()`) on every such table, and grants privileges.
3. Every request runs tenant queries through `tenantTx(ctx, fn)` → `withDbContext`, which sets transaction-local settings `app.org_id`, `app.user_id`, `app.actor_type`, `app.network_patient_id`. No context = zero rows (default deny).
4. Service functions **also** call `requirePermission(ctx, "<key>")` — RLS isolates tenants; permissions isolate roles. Hiding a button is never the control.
5. `getClinicContext()` re-validates the ACTIVE membership on every request (deactivation is immediate) and loads permissions from the org's role row.
6. `INSERT … RETURNING` must satisfy the SELECT policy: allocate ids first (`select uuidv7()`) and set context before inserting rows whose visibility depends on that id (see `registerClinic`).

### Adding a table (checklist)
- Add it in `src/server/db/schema/*.ts` with `organizationId()` if tenant-owned.
- `npm run db:generate`, then create a custom migration (`npx drizzle-kit generate --custom --name=<x>`) ending with `SELECT app_private.apply_security();`.
- Append-only tables (ledger, history, audit-like): add the name to `app_private.append_only_tables()` (re-create the function in the new migration) so UPDATE/DELETE are revoked.
- Tables without `organization_id` need explicit policies (see consent tables) — never leave a table readable by default.
- Add an integration test proving cross-tenant denial.

## Shared patient profile and consent (§4A)

- `network_patients` = stable private identity, **not** tenant-scoped. `patients` = clinic-private registration; `network_patient_id` is set only through `patient_identity_links` (verified evidence: patient account claim, patient QR, documented assisted in-person flow). Never auto-matched on name/phone/birth date.
- `consent_requests` (clinic → patient), `consent_grants` (patient decision), `shared_access_events` (every allowed/denied read, append-only).
- **DB-enforced**: `consent_grants` INSERT/UPDATE require `app.actor_type = 'patient'` and the matching `app.network_patient_id`. Staff code paths physically cannot create or widen a grant (tested).
- `evaluateSharedAccess()` (pure, unit-tested) is the single decision function for all shared reads: permission `shared_profile.read`, verified organization, active non-expired non-revoked grant, category, date range, future-updates rule. Every shared path (pages, APIs, file URLs, thumbnails, exports, jobs) must call it and log to `shared_access_events`.
- Not built yet: patient portal accounts, request/approval UI, revocation propagation to caches/exports.

## Money and dates (§2, §16)

- Integer minor units + ISO currency on every amount; `src/lib/money.ts` parses FR/DZ input without floats, refuses mixed-currency sums, rounds half away from zero.
- Display currency symbol from `organizations.settings.currencyDisplay` ("DA" for DZD).
- Timestamps `timestamptz` (UTC), displayed in the clinic timezone. Date-only values (`date`, ISO strings) are never timezone-converted. Keep service date, document date, payment date and created_at distinct.

## Visits and completed procedures (§14)

- `encounters` is the visit boundary (patient, branch, primary clinician, clinic-calendar service date and status). Phone-first fast entry creates a completed encounter and its first `performed_procedure` atomically.
- `performed_procedures` keeps a catalog snapshot (localized name, code, pricing unit, anatomy and tax), the exact unit price/currency, quantity, anatomy, performing clinician and service date. Later catalog edits never rewrite it.
- Anatomy is validated against the snapshotted service requirement: FDI tooth numbering, selected surfaces, arch or quadrant. Irrelevant anatomy fields are cleared server-side rather than trusted from the form.
- A price different from the catalog default requires `price.override`, a reason, and records the approving user. The catalog price itself is not changed.
- Completed procedures are never deleted in normal workflows. Corrections transition once to `reversed` or `entered_in_error`, retain a reason, and write an audit event without copying the clinical reason into audit metadata.
- The reusable service picker groups active services by category and adds per-user tenant-scoped favorites plus recent completed-procedure choices. Favorites contain catalog references only, never patient data.

## Financial invariants to implement (Release 1, next steps — §16, §18)

- Invoices: draft → issued (immutable) → corrections only via credit note / void-reissue; per-legal-entity numbering via `counters` (`scope = invoice:<legalEntityId>:<year>`), allocated inside the issuing transaction.
- Line snapshots (code, description, unit, qty, unit price, discount, tax, service date, provider, procedure ref). Catalog changes never touch them.
- Payments, allocations, deposits, refunds are separate append-only events; allocations ≤ available payment and ≤ invoice balance (DB constraints + transaction checks). Deposit application is not a new receipt. Credit note changes the charge; refund changes cash.
- Idempotency keys on issue/pay/refund endpoints (unique constraint). Reports derive from the same tables; never stored totals.

## Security notes

- Passwords: scrypt (N=2^15, r=8, p=3), NFKC-normalized, 10-char minimum. Uniform timing for unknown emails; lockout 15 min after 5 failures. MFA: schema flag only (planned TOTP).
- Sessions: opaque 32-byte token in httpOnly SameSite=Lax cookie; DB stores SHA-256; 12 h sliding; revocable (`revokeAllSessions`).
- Audit: `audit_events` is INSERT/SELECT-only for the app role. Never put clinical content or secrets in metadata.
- Security headers in `next.config.ts`. Platform operator role grants no patient-data access.
