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
- Append-only tables (ledger, history, audit-like): add the name to `app_private.append_only_tables()` (re-create the function in the new migration with the FULL list) so UPDATE/DELETE are revoked.
- Rows that must never be deleted (but may be updated under triggers): add to `app_private.no_delete_tables()` (full list). Do NOT write a bare `REVOKE DELETE`: `apply_security()` re-grants DELETE on every other tenant table each time it runs (this happened in migrations 0006–0022; fixed in 0023, guarded by `tests/integration/grants.test.ts`).
- Tables without `organization_id` need explicit policies (see consent tables) — never leave a table readable by default.
- Add an integration test proving cross-tenant denial.

## Shared patient profile and consent (§4A)

- `network_patients` = stable private identity, **not** tenant-scoped. `patients` = clinic-private registration; `network_patient_id` is set only through `patient_identity_links` (verified evidence: patient account claim, patient QR, documented assisted in-person flow). Never auto-matched on name/phone/birth date.
- `consent_requests` (clinic → patient), `consent_grants` (patient decision), `shared_access_events` (every allowed/denied read, append-only).
- **DB-enforced**: `consent_grants` INSERT/UPDATE require `app.actor_type = 'patient'` and the matching `app.network_patient_id`. Staff code paths physically cannot create a grant; a trigger makes an approved grant immutable except for patient revocation, so neither staff nor patient code can widen it (tested).
- `evaluateSharedAccess()` (pure, unit-tested) is the single decision function for all shared reads: permission `shared_profile.read`, verified organization, active non-expired non-revoked grant, category, date range, future-updates rule. Every shared path (pages, APIs, file URLs, thumbnails, exports, jobs) must call it and log to `shared_access_events`.
- Clinic staff may create a network identity link only through the documented assisted in-person flow: a non-clinical evidence reference is required and audited. Names, phone numbers and birth dates are never identity-matching inputs.
- Patient portal accounts are global and separate from staff users. Activation requires a single-use seven-day invitation, passwords use the same scrypt policy, sessions are opaque hashed 12-hour tokens, and five failed logins lock the account for 15 minutes. Staff-assisted recovery requires another documented in-person identity check and creates a single-use 24-hour link; a successful reset clears lockout state and revokes every existing patient session. Narrow `SECURITY DEFINER` functions expose only invitation/recovery resolution, activation/reset, login lookup, active-session lookup and the verified local clinic links; account/session tables otherwise have patient-self RLS.
- A portal patient may read clinic-local appointments, accepted/completed estimates, issued invoices and payments only after `patient_portal_links()` proves an active identity link for the current network patient. Every clinic is then queried in its own `withDbContext` transaction, and every query also filters the exact linked local `patient_id`; an account never receives a general tenant browse capability. Portal financial balances are derived from the immutable subledger and online payment is not shown until a real provider exists.
- Consent approval copies the exact requested purpose, categories, date range and future-update flag into a new grant. Decline and revocation are patient-authenticated portal actions. Approval, decline, revocation, activation and staff request/invite mutations are audited without clinical content.
- Not built yet: shared-record pages themselves, portal views of the wider clinical record, online payment provider integration, and revocation propagation to future caches/exports. Patient-authenticated medical-questionnaire completion is built, but does not expose clinical notes or other records. Until a cache/export exists, every read is evaluated live.

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

## Scheduling and reception (§9, §10)

- Appointments keep three independent states: scheduling (`booked/cancelled/no_show`), confirmation, and visit progress. UI labels never collapse them into one ambiguous status.
- PostgreSQL exclusion constraints are the final concurrency guard against overlapping booked appointments for a provider, chair, or patient. Service checks improve messages but never replace the database constraint.
- Clinic-local date/time input is converted once with `zonedToUtc`; agenda display converts timestamps with the organization timezone. Date-only navigation never passes through the browser timezone.
- Working hours are provider-specific recurring intervals; time off can be provider-specific or clinic-wide. Outside-hours booking requires an explicit override stored on the appointment and in audit metadata.
- Reception visit states are forward-only: `not_arrived → arrived → waiting → in_treatment → completed`. They do not imply that clinical procedures were recorded or the account was paid.
- Appointment notes are administrative only. Clinical findings belong in signed clinical records.

## Treatment plans and estimates (§13)

- `treatment_plans` is the mutable workflow pointer only. Each edit inserts a complete immutable
  `treatment_plan_versions` snapshot and immutable `treatment_plan_items`; accepted prices and catalog labels are
  never rewritten by later revisions or catalog changes.
- A proposal is accepted or declined through an append-only `treatment_plan_decisions` row tied to the exact version.
  The staff audit records identifiers, version and method only; decision notes stay in the clinical record, not audit metadata.
- Only an accepted current version can be converted. Each item converts at most once into a completed encounter/procedure,
  using the accepted service, anatomy and price snapshot, with an append-only `treatment_plan_conversions` link.
  The plan becomes completed when every item in that accepted version has been converted.
- Revisions after a proposal or decision create a new draft version and preserve all earlier decisions. Optimistic locking
  protects workflow transitions; RLS and explicit `treatment_plan.*` permission keys protect every service path.

## Odontogram findings (§12)

- `odontogram_findings` is an append-only clinical event table. The current chart is derived from rows that have not
  been superseded; resolving or correcting an active finding inserts a new event referencing `supersedes_id` and never
  rewrites the original observation. A unique index plus a transaction advisory lock permits only one successor.
- FDI tooth validity and the allowed surface vocabulary are database checks as well as application validation. The
  first visual chart covers permanent teeth (11–48); the data model also accepts primary FDI teeth (51–85) for later UI.
- Optional links to `treatment_plan_items` and `performed_procedures` are accepted only when organization, patient and
  exact tooth all match. A database trigger enforces this even when application services are bypassed.
- Reading requires `clinical.read`; recording, resolving and correcting require `clinical.write`. All services use
  `tenantTx`, and audits record only finding identifiers and actions—never the finding kind, surfaces or clinical note.

## Financial invariants to implement (Release 1, next steps — §16, §18)

- Invoices: draft → issued (immutable) → corrections only via credit note / void-reissue; per-legal-entity numbering via `counters` (`scope = invoice:<legalEntityId>:<year>`), allocated inside the issuing transaction.
- Line snapshots (code, description, unit, qty, unit price, discount, tax, service date, provider, procedure ref). Catalog changes never touch them.
- Payments, allocations, deposits, refunds are separate append-only events; allocations ≤ available payment and ≤ invoice balance (DB constraints + transaction checks). Deposit application is not a new receipt. Credit note changes the charge; refund changes cash.
- Idempotency keys on issue/pay/refund endpoints (unique constraint). Reports derive from the same tables; never stored totals.

## Security notes

- Passwords: scrypt (N=2^15, r=8, p=3), NFKC-normalized, 10-char minimum. Uniform timing for unknown emails; lockout 15 min after 5 failures. TOTP MFA is available to every staff account.
- Authentication entry points also have a shared PostgreSQL per-client throttle before password hashing/account lookup:
  staff and portal login each allow 30 attempts per 15 minutes, then block that client for 15 minutes; forgot-password
  allows 10 requests per hour, then blocks for one hour (the existing 3/hour/account email limit remains). Buckets are
  concurrency-locked by `app_private.consume_auth_rate_limit()` and survive restarts/multiple app processes. The runtime
  role cannot read or mutate `auth_rate_limits` directly; its key is an HMAC of the address using
  `AUTH_RATE_LIMIT_SECRET`, never the raw address. Missing/invalid addresses share a conservative `unknown-client` bucket.
- The clinic Caddy proxy overwrites `X-CDP-Client-IP` from the socket address and the app container has no published port.
  Other internet deployments must likewise use a trusted reverse proxy that overwrites forwarding headers; never expose
  the Next.js process directly and trust caller-supplied `X-Forwarded-For`.
- Sessions: opaque 32-byte token in httpOnly SameSite=Lax cookie; DB stores SHA-256; 12 h sliding; revocable (`revokeAllSessions`).
- Staff invitations are tenant-owned, single-use SHA-256 token links with a seven-day expiry. Acceptance creates one
  membership for the invitation's exact role; existing global accounts prove their password and new accounts set one.
  No session is issued by acceptance, so the normal password + MFA login path always runs afterward.
- Staff TOTP secrets are AES-256-GCM protected at rest. Production requires a dedicated `MFA_ENCRYPTION_KEY`; local
  development derives a stable key from its database URL. Login uses a five-minute, five-attempt password-first
  challenge. Recovery codes are shown once, stored only as SHA-256 hashes, and consumed once.
- Owners can create tenant custom roles from exact permission keys. The owner role is immutable, users cannot change
  or deactivate themselves, and staff deactivation revokes every active session immediately. Session revocation is
  user-scoped and audited in the active clinic.
- Audit: `audit_events` is INSERT/SELECT-only for the app role. Never put clinical content or secrets in metadata.
- Security headers in `next.config.ts`. Platform operator role grants no patient-data access.
- The platform console is a separate authorization plane: `users.platform_role = operator` may call only narrow
  `app_private.platform_*` SECURITY DEFINER functions for organization identity, owner contact, status and entitlements.
  It never creates a membership and therefore cannot resolve `ClinicContext` or read tenant clinical tables. Operators
  are granted/revoked explicitly with `npm run platform:operator -- <email> [--revoke]`.
- Commercial entitlements are stored in `organizations.enabled_modules`. Existing role permissions are filtered through
  `entitledPermissions()` when `ClinicContext` is built, so the same `requirePermission()` checks protect UI and server
  mutations. Public entry points without a staff permission (currently online booking) also check the module explicitly.
  `core` is always present; migration 0045 assigned all modules to pre-existing clinics to avoid accidental lockout.
- Free trials (0053): `organizations.trial_ends_at` (null = paid), set only through `platform_set_trial` from the
  console (start/extend/convert to paid, audited `platform.trial.*`) or at self sign-up (`SIGNUP_TRIAL_DAYS`). Once the end
  has passed, `sessionPermissions()` keeps view/report/export keys only (`trialExpiredPermissions`), public booking and
  automatic reminders stop; nothing is deleted. Trial requests from the public `/essai` page are platform data
  (`trial_requests`, no `organization_id`, no direct app access) read and handled only through `app_private.platform_*`.

## Financial subledger (implemented — `src/features/billing`, migrations 0005/0006)

- Tables: `invoices`, `invoice_lines`, `credit_notes`, `payments`, `payment_allocations`, `refunds`.
- Balances are always derived (`src/features/billing/sql.ts`): invoice balance = total − Σ allocations − Σ credit notes;
  payment unapplied = amount − Σ allocations − Σ refunds (0 when reversed).
- Triggers (`0006_finance_security.sql`): issued invoices/lines immutable (only issued → void, with no payments/credits);
  payments immutable except posted → reversed (nothing applied/refunded); credit notes, allocations, refunds append-only;
  AFTER-INSERT checks reject over-allocation, over-refund, over-credit and cross-patient/entity/currency allocation.
- Services lock the invoice row (`FOR UPDATE OF invoices`) before allocating; triggers are the backstop.
- `invoice_lines.performed_procedure_id` is unique while `released = false` → a procedure is billed at most once; voiding releases it.
- Payment forms send a client-generated `idempotencyKey` (unique per org) so retries never create a second receipt.
- Numbering: `counters` scope `invoice|credit|receipt:<legalEntityId>:<year>` → `F-2026-00001`, `AV-…`, `R-…`. Numbers are never reused;
  voided invoices keep theirs. No gapless guarantee is claimed.

### Correlated subqueries (pitfall)
Drizzle omits table qualifiers in single-table selects, so `sql\`… where x.invoice_id = ${invoices.id}\`` inside a
subquery binds to the subquery's own `id`. Write correlated subqueries with explicit aliased identifiers
(see `billing/sql.ts`) and select FROM the unaliased outer table.

## Reports (`src/features/reports/server.ts`)
Metric bases follow §18 and are printed under each KPI. Production by service date; invoiced sales by document date
less credit notes; gross receipts by receipt date (deposits included); net = gross − refunds. Other currencies are listed,
never summed. "Paid to date" is as of generation time.

## Deployment: clinic server without internet (`deploy/clinic`, guide `docs/INSTALLATION-CABINET.md`)

- One machine on the clinic LAN runs Docker Compose: `db` (PostgreSQL 18), `migrate` (one-shot, drizzle migrations),
  `app` (Next.js `output: "standalone"`, non-root, healthcheck), `proxy` (Caddy, HTTPS with its local CA for the LAN IP
  and `cabinet.local`; `http://<host>/ca.crt` serves the root to install on devices), `backup` (daily `pg_dump -Fc`
  + clinical-files tar archive, one sha256 file, retention). HTTPS is mandatory: secure cookies, service worker and `crypto.randomUUID` need a secure context.
- No runtime internet dependency: fonts are vendored in `src/app/fonts` (OFL) and loaded with `next/font/local`;
  no external scripts/APIs. Fully offline installs load images from `cabinet-images.tar.gz` (`export-images.sh`).
- `REGISTRATION_MODE=first-only` (clinic server default): `/register` works only until the first organization
  exists (`app_private.organization_count()` SECURITY DEFINER); then staff join via invitations. Cloud default `open`.
- Offline policy (§27): `public/sw.js` caches only static build assets, icons, manifest and `/offline.html`;
  pages and API responses are never cached; navigations fall back to `/offline.html` when the server is
  unreachable. `ConnectionBanner` polls `/api/health` and warns that nothing is saved while disconnected.
  No patient, clinical or financial data is stored on devices; there is no offline write queue (deliberate).

## Deployment: Neon PostgreSQL + cloud VPS (`deploy/neon`, guide `docs/DEPLOYMENT-NEON.md`)

- The application uses two physically separate connection strings: the direct Neon owner endpoint exists only in the
  one-shot migration container; the web process receives a pooled `-pooler` URL for `cabinet_app`.
- `scripts/setup-neon.ts` creates the runtime role through SQL (never the Neon Console), removes inherited roles, verifies
  `NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`, applies migrations, then verifies the role and a context-free RLS read
  through the pooled endpoint. The owner URL must never be used as `DATABASE_URL`.
- Tenant context uses transaction-local `set_config(..., true)` inside `tenantTx` / `withDbContext`, which is compatible
  with PgBouncer transaction pooling. Postgres.js protocol prepared statements remain enabled on the runtime pool.
- Postgres.js URL normalization removes only the unsupported libpq `channel_binding` query hint; Neon TLS remains mandatory
  through `sslmode=require`.
- Caddy is the only published service and overwrites `X-CDP-Client-IP`; the Next.js process remains on the private Docker
  network. Clinical uploads remain on the persistent `clinical-files` volume and require a backup independent of Neon.

## Deployment: Vercel + Neon + private Blob (`docs/DEPLOYMENT-VERCEL.md`)

- Vercel uses its native Next.js adapter (`output: "standalone"` is enabled only outside Vercel). The runtime gets only the
  pooled Neon URL for restricted `cabinet_app`; the direct owner URL remains in a separate operator/CI migration context.
- `CLINICAL_STORAGE_BACKEND=vercel-blob` replaces the ephemeral filesystem with a private Vercel Blob store. Browser
  uploads use a short-lived server-authorized token restricted to one active patient, accepted MIME declarations and
  20 MB. The finalizer downloads the object, validates magic bytes/date/comparison rules, computes sha256, then renames it
  from `pending/<patient>/<uuid>.bin` to the canonical immutable organization/patient key before the DB transaction.
- Private reads still pass through `GET /api/clinical-files/[id]`: permission, tenant RLS and view audit run before the
  Blob stream is returned with `private, no-store`. The Blob URL/token is never sent to readers.
- Temporary direct uploads have a one-day TTL. A DB failure removes the finalized object; accepted clinical objects have
  no product delete path. Neon and Blob require coordinated, independently verified backups.

## Medical history (`src/features/health`, migrations 0021/0022/0031)
- `questionnaire_versions` (wording immutable; one-time clinician approval), append-only `questionnaire_responses`
  (every update is a new row) and `health_history_reviews` ("reviewed" / "no_changes" events).
- `questionnaire.manage` creates complete immutable drafts; `questionnaire.approve` atomically approves and activates one
  version. A partial unique index permits exactly one current version per tenant/key, while every response retains its exact
  historical version. Existing approved versions cannot be reactivated or have their approval changed.
- Portal completion first resolves the patient's exact active clinic identity link, then reads/writes only that local patient
  under patient RLS. Clinic tablet completion uses a random 256-bit bearer token stored only as a hash in
  `questionnaire_tablet_sessions`; its narrow `SECURITY DEFINER` lookup returns one approved current form, expires after
  30 minutes, and the database permits only the one-way unused → used transition. Portal/tablet submissions are append-only,
  patient-acknowledged responses awaiting the same clinician review as staff-entered responses.
- Answers: `yes | no | unknown | declined` or text; an unanswered question is ABSENT (never stored as "no").
- No inference: alerts are created only by a clinician from an answer (`promoteToAlertAction`, label built server-side).
- The starter questionnaire is generic wording flagged "to be approved by a clinician" until approved.

## Inventory (`src/features/inventory`, migrations 0024–0028)

- `inventory_items` is the tenant catalog; stock is never stored as a mutable total. The balance is always derived from
  append-only `inventory_movements`, grouped by immutable `inventory_lots` and branch.
- Receipt and consumption services require `inventory.manage`, run through `tenantTx`, and audit identifiers and quantities
  in the same transaction. RLS and database triggers reject cross-tenant/cross-item/cross-branch lot references.
- Outbound movements can never make a lot negative. A privileged trigger locks the immutable lot row before validating the
  derived balance; service-level advisory locks give concurrent users a clear, serialized FEFO result.
- Routine use is FEFO (first-expiring, first-out), with non-expiring lots last. Expired lots remain visible for quarantine
  and traceability but are never eligible for routine consumption.
- Supplier purchase orders use tenant/year counters (`inventory_po:<year>` → `BC-2026-00001`). Their item quantities and
  optional unit costs are immutable order lines; only the header status advances `ordered → partially_received → received`.
  A receipt movement references its exact order line and immutable lot. The database locks that line/order and rejects
  cross-tenant, cross-item, cross-branch, closed-order, non-receipt and over-quantity inserts even if services are bypassed.
- An item may have multiple scan identifiers (EAN-13, GTIN/GS1, Code 128, QR/Data Matrix or clinic-specific). Codes are
  unique per tenant and cannot be rewritten, deleted or reassigned; an incorrect code is deactivated once with actor/time.
  Camera scanning uses the browser's local `BarcodeDetector` when available and always retains manual/USB-scanner input.
  GS1 application identifiers `01`, `17` and `10` populate the product lookup, expiry date and lot without sending images
  or scan payloads off the clinic server.
- Consumable recipes (`service_consumables`) give a quantity per unit of a catalog service. Recording a completed procedure
  creates one `procedure_consumptions` line per recipe item in the same transaction. Mode is the org setting
  `consumablesMode`: `suggest` (default) leaves lines pending for chairside/stock-room confirmation; `auto` consumes FEFO
  immediately. A stock shortage NEVER blocks recording care: the line stays pending with note `insufficientStock`.
  Lines move once `pending → consumed | skipped` (skip needs a reason) and are then frozen by trigger; they are never deleted.
  Confirmation is refused if the procedure has been reversed. Usage movements carry `performed_procedure_id`, which is the
  basis of lot recall (`getLotTrace`: patients/procedures per lot, plus manual usage that cannot be traced to a patient).
- Reorder suggestions are explainable, not a model: max(0, ceil(90-day usage / 90 × 30 × agenda factor) + minimum stock −
  usable on hand − open order quantity). Agenda factor = booked appointments in the next 14 days ÷ the 14-day average of the
  last 90 days, clamped to [0.5, 2]. Expired lots are not counted as on hand.

## Sterilization traceability (`src/features/sterilization`, migrations 0029–0030)

- Sterilizers and instrument sets are tenant-owned setup records. Their identity is immutable; deactivation is the only
  supported correction. A cycle records machine reference, program, physical parameters and indicator results as immutable
  facts. Recording always starts at `pending_release`; it never certifies the load as a side effect.
- `sterilization.release` is separate from `sterilization.manage`. An authorized reviewer explicitly moves a pending cycle
  to `released` or `failed`; a failed indicator blocks release. A released cycle may only move to `recalled`. Pending
  biological indicators resolve once; a failed result on an already released load recalls it in the same transaction.
- Each pouch gets a clinic/year counter code (`sterilization_pack:<year>` → `ST-YYYY-NNNNNN`) and a locally generated Code
  128 label. A pouch can be used only from a released cycle, before expiry, while not discarded, and has at most one active
  patient link. The optional procedure must belong to that exact patient. Incorrect links are voided once with a reason.
- PostgreSQL triggers lock cycle state against concurrent use/recall, validate same-clinic/branch references and actors,
  freeze recorded facts, and enforce transition rules even when application services are bypassed. All five tables are in
  `no_delete_tables()`; services use tenant transactions, permission keys and identifier-only audits.

## Clinical images & documents (`src/features/clinical-files`, migration 0032)

- Bytes live either on the clinic server's disk (`CLINICAL_STORAGE_DIR`; Docker volume `clinical-files`) or in private
  Vercel Blob, never under `/public`. The canonical storage key `<org>/<patient>/<uuid>.<ext>` is generated server-side
  and validated by regex; it is never shown to a client. Filesystem writes use `wx` (no overwrite) and 0600. Vercel direct
  uploads first use a patient-scoped pending key, then become canonical only after server-side content validation.
- Media type comes from magic bytes (JPEG/PNG/WebP → image, PDF/DICOM → document), never from the browser. sha256 and
  size are stored. `clinical_files` and `clinical_file_comparisons` are append-only; corrections are new uploads.
- Filesystem upload is a route handler (`POST /api/patients/[id]/clinical-files`, multipart). `src/proxy.ts` makes Next
  buffer request bodies, so `experimental.proxyClientMaxBodySize` must stay above the 20 MB limit plus multipart overhead.
  Vercel uses direct browser-to-Blob upload to avoid the function request-body limit; the token and finalization routes
  enforce the same permission, patient, size and content rules.
- `GET /api/clinical-files/[id]` checks `clinical.images.read`, audits `clinical_file.viewed`, and returns
  `private, no-store`, `nosniff`; `CSP: sandbox` for images/DICOM (not PDFs: browsers refuse to render them sandboxed).
- `path.resolve` calls on runtime data carry `/*turbopackIgnore: true*/` so the standalone build doesn't trace the
  project or stored files; `.data` is in `.gitignore` and `.dockerignore`.

## Patient follow-ups (`src/features/follow-ups`, migrations 0033/0036)

- No server-side sending: each card builds `wa.me` / `sms:` / `tel:` links with the message, and staff send from their own
  phone (works without internet on the clinic server). A real SMS/WhatsApp Business provider would plug in later as another
  channel; never show a message as "sent" unless a provider confirmed it (`message_prepared` = link opened).
- Lists are computed on read with raw SQL in `getFollowUps` (no queue table): reminders for one local day, recall from the
  latest completed procedure or completed appointment, plans by `treatment_plans.status` + `updated_at` (3-day grace),
  no-shows of 30 days. All except reminders require no future booked appointment and `transactionalAllowed` ≠ false.
- `patient_contacts` is append-only and drives snoozing (latest contact per patient/reason/reference: 30 days recall,
  14 days otherwise, 180 days after `declined`). Reference rules are a CHECK constraint plus the `guard_patient_contact`
  trigger (same clinic, same patient, staff actor).
- Templates: built-in defaults live in `messages/*.json` → `followUps.templates` and are read from all three files on the
  server (`compose.ts`), because a message follows the patient's language, not the user's. Clinic overrides are stored in
  `organizations.settings.followUps.templates` (empty = default). `{placeholders}` are filled by `fillTemplate`, not ICU.
- Messages never include diagnoses, procedure names or teeth; plan titles/amounts are shown to staff only with
  `treatment_plan.read`. Exception by design: after-visit messages may carry the clinic's own care advice (per catalog
  category, written by the clinic, none by default), sent to the patient's own number and visible to staff before sending.
- After-visit rows come from completed `performed_procedures` of one day (appointments optional); contacts reference
  `visit_date`. Referral thanks never name the referred patient (that would disclose someone else's care).
- The HTTPS review destination is one organization setting (`followUps.reviewUrl`) exposed on both the public-page and
  follow-up settings screens. Public-page saves merge only that nested key so they cannot overwrite templates or aftercare.
  Staff can expand and review the complete message before opening WhatsApp/SMS; the software logs `message_prepared`, never
  claims that an external app sent it.
- New `follow_up_reason` values: add them to the enum and to `FOLLOW_UP_REASONS`, and write any SQL that compares them as
  `reason::text` in the same migration (Postgres refuses new enum values inside the transaction that added them).

## Patient acquisition (`src/lib/acquisition.ts`, `src/features/reports/acquisition.ts`, migration 0034)

- One channel list (`ACQUISITION_CHANNELS`) feeds the PostgreSQL enum, forms and the report; add a channel there plus a
  migration (`ALTER TYPE … ADD VALUE`) and the FR/EN/AR labels (`acquisition.channels` and `channelsPublic`).
- Patient input fields `acquisitionChannel` / `referredByPatientId` are optional: absent = keep the stored value (other
  callers such as booking approval or tests never erase them); `""` from the form = explicit clear. A referrer forces the
  `patient_referral` channel; any other channel clears the referrer. `guard_patient_referral` enforces same clinic, not self.
- The report counts patients by `created_at` in the clinic time zone over whole months; production is the value of all
  completed procedures of those patients (§18 production basis) and is hidden without `report.financial`.

## Clinic public page (`src/features/public-page`, `/c/[slug]`, migration 0035)

- Public, unauthenticated route (listed in `src/proxy.ts`). Resolution goes only through
  `app_private.resolve_public_clinic(slug)` (published page + active clinic → organization id); everything else is read with
  `withDbContext({ actorType: "system" })` selecting public columns only. Never add patient, staff-account or financial data
  to `getPublicClinicPage`; staff appear nowhere (hours are aggregated per weekday, not per clinician).
- Slugs are global (unique index) but a clinic cannot list other clinics' profiles (RLS); `public_slug_taken` answers
  availability without revealing the owner. External links must be `https:` (`safeHttpsUrl`).
- Shared addresses use `publicOrigin()`: `PUBLIC_APP_URL` when set, else the current host, flagged "local only" for
  `.local`, private IPs and localhost. QR codes are vector SVG generated server-side (`qrcode`), no external service.

## Payment schedules (`src/features/payment-plans`, migrations 0037–0038)

- A schedule belongs to one exact accepted estimate version and is append-only; changing it inserts a new schedule that
  supersedes the current one (allowed only before any receipt). Installment amounts must add up to the estimate total
  (deferred constraint trigger, checked at commit).
- Money stays in the payment ledger: receiving on an installment records a normal `advance_deposit` payment (unapplied
  credit used later for invoices) plus an append-only receipt row classifying it to the installment. Paid = posted payments
  minus refunds of those receipts; a receipt can never exceed what is left on the installment.
- Pitfalls met here: in PL/pgSQL never name a variable like a table alias used in the same query; `SELECT … FOR SHARE` needs
  UPDATE privilege, so append-only tables are serialized with `pg_advisory_xact_lock` instead; Server Components cannot pass
  functions to client components (wrap `DialogButton` render functions in a client component).

## Clinic identity and issuer details (`src/features/clinic-identity`, migration 0039)

- The default legal entity holds the legal name, address and identifiers (NIF, NIS, RC, AI; printed as labelled, empty ones
  skipped); its first active branch holds phone and email. Edited from `/settings/clinic`.
- Issued documents carry `issuer_snapshot` (invoices at draft→issued, receipts and credit notes at insert), built by the SQL
  function `app_private.issuer_snapshot_for(legal_entity_id)` so code and backfill agree. Existing ledger guards make it
  immutable afterwards; `require_issuer_snapshot` refuses issued rows without it. Prints use the snapshot, live details only
  for drafts, estimates and statements. The logo is decoration and is not frozen.
- Logo bytes live in `clinic_logos` (bytea, ≤ 300 KB, PNG/JPEG/WebP from magic bytes, never SVG), served privately at
  `/api/clinic/logo` and publicly at `/c/<slug>/logo` only for published pages.

## Patient import (`src/features/patients/import`, migration 0040)

- Pure parsing (`parse.ts`: CSV/XLSX → strings) and mapping/validation (`mapping.ts`) are unit-tested; the server re-runs the
  full analysis on import (stateless: the browser sends the file again with the confirmed mapping), so the preview and the
  import can never disagree. Files are never stored.
- Inserts bypass `createPatient` for speed but keep its rules: same field normalization, one audit event per patient in the
  same transaction, patient numbers from the same `patient` counter (reserved as a block).
- Duplicate keys: `phone:<E.164>`, `name:<last>|<first>|<birthDate>`; `nameonly:` is used only when a row has neither phone
  nor birth date. Archived patients count as existing.


## Staff password reset (`src/server/auth/password-reset.ts`, migration 0041)

- `staff_password_resets` is a **platform auth table** (like `staff_mfa_challenges`): no `organization_id` column,
  so no tenant RLS; `cabinet_app` has SELECT/INSERT/UPDATE only (no DELETE: rows are the reset history). The
  issuing clinic is `issued_by_organization_id` (null for email/server links). A trigger freezes every column except
  a single `used_at` / `revoked_at`. Only the SHA-256 of the token is stored.
- Three channels: **admin_link** (owner/admin with `org.staff.manage`, 24 h, Settings → Team), **email** (only when
  `SMTP_HOST` + `SMTP_FROM` and a configured base URL exist; 1 h; max 3 per account per hour; no answer difference
  for unknown addresses, work done in `after()`), **server_command** (`scripts/staff-reset-link.ts`, bundled into
  the migrate image, `deploy/clinic/reset-password.sh`; 2 h) for the owner, whom nobody in the app can reset.
- A clinic may reset only an account that is active, not a platform operator and **active in no other clinic**
  (`app_private.staff_reset_scope`, SECURITY DEFINER, checked at creation and again at use): otherwise an admin of
  clinic A could take over the person's access to clinic B. Never self (use "change my password") or the owner role.
- Using a link: password policy, new hash, lockout cleared, **all sessions revoked**, pending MFA challenges closed,
  other open links revoked; optional "lost phone" flag turns MFA off. Emailed links use `PUBLIC_APP_URL`/`APP_URL`
  only, never the request Host (reset-link poisoning). Admin links are built client-side from `location.origin`.
- Changing one's own password (Settings → Security) needs the current one and revokes the other sessions.

## Offline clinic computer and cloud sync (`src/server/sync`, `src/features/sync`, migration 0043)

User decision 2026-11-21: like Dentus, the clinic keeps working without internet. One clinic computer runs the app
and its own PostgreSQL ("clinic" node, `deploy/clinic`); all clinic devices on the Wi-Fi use it. The hosted copy
(Neon + Vercel, "cloud" node) stays in sync when internet is up and serves everything used from outside (online
booking, public page, patient portal, the owner's phone). Per-device offline copies were rejected: invoice numbering
and double bookings are only safe with one copy in charge.

- **Who is in charge.** `organizations.data_home`: `cloud` (default, hosted copy only) or `clinic` (a paired clinic
  computer). For a clinic-homed clinic the cloud copy is **read-only for staff**: the `sync_writer_guard` trigger
  refuses any `staff` write there (`clinic_read_only`); patients' own online actions (`system`/`patient` actors) and
  audit events are accepted and travel down. `app_private.node_settings.node_role` says what a database is.
- **Change capture.** `sync_capture` (AFTER row trigger on every replicated table, SECURITY DEFINER) appends the full
  row (`to_jsonb`) or the delete key to `sync_changes` (append-only) for clinic-homed clinics, on both copies. Shared
  rows a row depends on are captured just before it (the staff account of a new membership, the network patient of a
  linked patient). Replicated = every table with `organization_id` except `sync_*`, plus `organizations`, `users`
  (clinic → cloud only), `consent_requests`, `consent_grants`; node-local and never copied: sessions, MFA challenges,
  password resets, rate limits, patient portal accounts/sessions.
- **Reading in order.** Readers take only finished transactions: `txid` in `[from, to)` with `to` =
  `pg_snapshot_xmin` when the window opens, paged by id inside a fixed window (`SyncCursor`). A transaction that
  commits late can never be skipped.
- **Applying.** A separate login, `cabinet_sync` (NOBYPASSRLS, member of `cabinet_app`), sets `app.sync_apply = on`;
  `app_private.sync_applying()` is true only for that login, so `cabinet_app` cannot switch checks off. Every business
  trigger has `WHEN (NOT app_private.sync_applying())`: rows were checked where they were written, and replaying
  them must not re-run actor/time-dependent checks. `apply_security()` adds the condition to new triggers
  automatically; `tests/integration/sync.test.ts` fails if one is missing. (Neon refuses
  `session_replication_role`, hence this design.) `app_private.sync_apply_row` upserts by primary key
  (append-only tables: insert-only) with the tenant context set, so RLS still applies. `sync_row_versions` keeps the
  last change id per row and origin: an older change never overwrites a newer one; re-sending a batch is harmless.
  A row whose parent has not arrived (FK violation) waits in `sync_pending` and is retried after each batch.
- **Deployment credentials.** `cabinet_app` and `cabinet_sync` always have distinct secrets. Hosted deployments use
  pooled Neon URLs for both application connections; the direct owner URL exists only in migrations/setup. The clinic
  Compose stack enables `cabinet_sync` after migrations, marks `node_settings.node_role = 'clinic'`, and starts the
  worker there. Cloud deployments expose the sync routes but set `CABINET_SYNC_WORKER=off`.
- **Pairing and first copy.** The owner creates a 30-minute single-use code in the cloud (`createPairingCode`,
  `org.settings.manage`); the clinic computer exchanges it for a long-lived node key (`claim_sync_pairing`: from
  this moment the clinic computer is in charge). Only SHA-256 hashes are stored in the cloud; the clinic computer
  stores its key AES-GCM-encrypted. The first copy (`exportSnapshotPage`, parents first, `organizations` first) is
  read once every transaction older than the pairing has finished (`snapshotReady`); pulling cloud changes starts
  at that point. The clinic computer always opens the connection (no inbound port, works behind any router).
- **Not yet copied (later phase):** patient portal accounts and portal account recovery for clinic-homed clinics,
  and clinical file bytes (only their records are copied).

## Practitioner fees / honoraires (`src/features/honoraria`, migration 0047)

Clinics with several dentists pay each one a share of the acts they perform (a percentage, sometimes a fixed amount,
after the lab fee for prostheses). Started by Codex, finished and hardened by Claude.

- **Rules.** Per practitioner: a default percentage (`memberships.default_fee_rate_bp`, basis points). Per practitioner
  and service (his price list, `/honoraires/tarifs`, user decision 2026-11-22 "each doc has his tarif"):
  `provider_service_terms` (own price, null = catalog price; percent or fixed-per-unit rule, null = his default
  percentage; changed in place, every change copied to append-only `provider_service_term_history`; never deleted,
  "back to defaults" = both null). His own price applies when an act is recorded. Per line at checkout: an
  optional one-off rule with a mandatory reason, stored on `invoice_lines.honorarium_rule_*`. Resolution: line rule,
  then service rule, then default (`resolveRule`). `services.deduct_lab_before_share` (catalog editor) says whether the
  lab fee typed at checkout (`invoice_lines.lab_fee_minor`) comes off the base first.
- **Ledger.** `honorarium_entries` is append-only. `snapshotInvoiceHonoraria` runs inside the invoice issue
  transaction and writes one `earned` row per line with a practitioner, freezing the rule, base and both shares
  (integer minor units, one rounding per line, share capped at the base, practitioner + clinic = line amount before
  tax). Lines issued before the ledger existed are assigned one at a time after a preview (`backfill`). Corrections
  are signed `adjustment` rows linked to the entry they correct; the corrected share must stay within [0, line amount].
  A partial unique index allows one base entry per invoice line.
- **What is owed.** Never stored, always derived in SQL from the invoice: share net of credit notes =
  share × (total − credited) / total; collected share = share × min(paid, net) / total. "Still to pay" = all-time
  collected share − all-time payouts. Void invoices are excluded.
- **Payouts.** `honorarium_payments` is append-only; a mistake is cancelled by one negative reversal row
  (`reverses_payment_id`, unique). Cash payouts count in the cash day (`cashHonorariaMinor` in the expected amount) and
  are refused on a closed cash day, like expenses.
- **Closed months.** `honorarium_period_closures` (append-only, per practitioner, only for a finished month). A fee,
  assignment or correction whose date falls in a closed month is dated today instead; a payout cannot be dated in a
  closed month. Nothing ever rewrites a closed month.
- **Access (user decision 2026-11-22: only the owner and the practitioner concerned see what he earned; prices are
  set by the owner).** `honorarium.read.own` (dentists: only their own rows and own price list, read-only, enforced in
  the service). `honorarium.read.all`, `.manage`, `.pay`, `.close` are **owner-only** (`OWNER_ONLY_PERMISSIONS`):
  not offered in the role editor, filtered out of custom roles on save, and stripped from any non-owner role when the
  context loads (`roleEffectivePermissions`); migration 0049 removed them from existing roles. Dentists no longer hold
  `price.override` (the price field is locked at their price). Checkout sends rates/rules/shares to the owner only;
  others can only type a lab fee, and choosing who is paid or a one-off rule needs `honorarium.manage`. The activity
  log hides `honorarium.*` entries and fee-table changes from readers without `honorarium.read.all`.
  All in the `billing` module. Read keys stay available on a view-only cloud copy. Migration 0047 adds the keys to the
  built-in roles of existing clinics. Practitioner and service ids are re-checked inside the tenant transaction
  (foreign keys alone do not stop another clinic's ids, since they bypass RLS).
- **Pitfall.** Append-only tables only grant SELECT/INSERT, so `SELECT … FOR UPDATE` on them fails with
  "permission denied": lock a parent row instead (corrections lock the invoice).

## Activity log: who did what (`src/features/activity`, `/settings/activity`, migration 0048)

User requirement 2026-11-22: every change is recorded under the person who made it, and the owner can read it.

- **Two layers, both append-only and tenant-isolated.** (1) `audit_events`: one readable line per action, written by
  each service with `audit(tx, …)` in the same transaction (action code, person, patient, entity, metadata without
  clinical content). (2) `record_changes`: the safety net. The `record_change` trigger (AFTER INSERT/UPDATE/DELETE,
  SECURITY DEFINER) on every table with `organization_id` (plus `organizations`; excluded: the logs themselves, sync
  bookkeeping, counters, see `app_private.change_log_excluded_tables()`) writes the table, row id, operation, the
  names of the changed columns (never values), and the person from the transaction settings `app.user_id` /
  `app.actor_type` set by `withDbContext`. So a change made by a service that forgot `audit()` is still attributed.
- **Autosave.** An update by the same person of the same columns of the same row within 10 minutes is not logged
  again (clinical notes autosave about every second).
- **New tables are covered automatically:** `apply_security()` now calls `app_private.apply_change_log()`;
  `tests/integration/activity.test.ts` fails if a clinic table lacks the trigger. The trigger carries
  `WHEN (NOT app_private.sync_applying())`: on the other copy the change-log rows arrive through sync instead.
- **Reading.** `audit.read` only (owner, clinic admin). `/settings/activity`: "Actions" (audit trail: person, readable
  action, patient, invoice number, non-identifying details; views of records hidden unless asked) and "All changes"
  (change log). Filters: dates (clinic time zone), person, area, patient (from the patient header "History").
  Paging cursor = id of the last entry; the next page compares `(occurred_at, id)` with that entry's exact values in
  SQL (entries of one transaction share an instant more precise than a JavaScript date).
- **Labels.** Every action code has a label in `activity.actions` (FR/EN/AR, key = code with dots replaced by `_`);
  `src/features/activity/labels.test.ts` scans the code and fails on a missing label or an unknown action template.

## Visual treatment journey (`src/features/journey`, patient tab "Parcours", `/portal/journey/[organizationId]`, migration 0050)

STATUS next step 2 ("clinician-selected images and milestones in the patient portal, with explicit consent, plain-language
context and revocable access").

- **Clinic side** (`patient.journey.manage`: owner, dentist, hygienist; module `advanced_clinical`): share a step
  (`milestone`, optionally linked to a plan, may be dated up to a year ahead), a photo (`image`, an image of the same
  patient) or a before/after pair (`comparison`), each with a plain-language title and explanation.
  `patient_journey_items` is never edited and never deleted: an item is withdrawn once, with who and why
  (`guard_journey_item` trigger also refuses another patient's file/pair/plan). Plan progress is derived from the
  accepted plan's items and `treatment_plan_conversions` (nothing typed).
- **Patient control.** `patient_journey_access` (append-only, latest decision applies, account id without foreign key
  because portal accounts are not copied to a clinic computer). Before the patient switches it on in the portal, the
  portal shows only a count of shared items; after "hide", nothing is shown or served.
- **Portal reads** prove the exact identity link first (`app_private.patient_portal_links()`), then query that clinic
  only, filtered on the linked patient. Photos are streamed by `GET /portal/journey/[org]/files/[item]?side=` (under
  `/portal` because the patient session cookie has `path=/portal`): only a shared, not withdrawn item of that patient,
  journey switched on, image files only; `private, no-store`, `nosniff`, `CSP: sandbox`; each view audited
  (`patient_journey.file_viewed`).

## Automatic WhatsApp reminders (`src/features/reminders`, `src/server/whatsapp.ts`, migration 0051)

User decision 2026-11-28: WhatsApp only, through the platform's own Meta WhatsApp Cloud API account, sold per clinic as
module `whatsapp_reminders` (self-registered clinics do not get it: messages cost the platform money).

- **Sending.** Business-initiated messages must use an approved template (`WHATSAPP_REMINDER_TEMPLATE`, 5 body
  variables: first name, clinic, date, time, site phone; FR/AR/EN, patient language with French fallback).
  `sendWhatsAppTemplate` posts to `graph.facebook.com/<version>/<phone-number-id>/messages` with a 15 s timeout and maps
  errors to retryable (network, 429, 5xx, throttling codes) or final. Configuration only from server env; the token is
  never logged. Setup steps: `docs/DEPLOYMENT-VERCEL.md` §9.
- **Daily run.** Vercel Cron → `GET /api/cron/reminders` (`Authorization: Bearer $CRON_SECRET`, cloud node only) →
  `runAutoReminders`: clinics from `app_private.auto_reminder_clinics()` (module + clinic switch
  `settings.autoReminders.enabled`), tomorrow's booked, not declined appointments of active patients with a phone who
  did not opt out (`transactionalAllowed`). One `outbound_messages` row per appointment **time** (unique
  appointment/kind/starts_at: never twice; a moved appointment gets a new one). Queued rows are re-checked before
  sending (still booked at the same time, still allowed, more than 2 h away) and retried up to 3 attempts on later runs.
- **Statuses.** `outbound_messages` is no-delete and guarded: content never changes, status only moves forward
  (queued → sent → delivered → read; failed and read are final). Delivery receipts arrive on
  `POST /api/whatsapp/webhook` (HMAC-SHA256 `X-Hub-Signature-256` over the raw body with `WHATSAPP_APP_SECRET`; GET
  handshake with `WHATSAPP_WEBHOOK_VERIFY_TOKEN`) and are applied by the SECURITY DEFINER
  `app_private.whatsapp_status_update` (the receipt carries only the provider id). The follow-up reminder cards show the
  automatic status so reception does not send twice. A message is shown as sent only after WhatsApp accepted it.

## Multi-site (`src/server/sites.ts`, `src/features/sites`, migration 0052)

Module `multi_site` (`branches.manage`, owner) to add sites; editing a site's details only needs `org.settings.manage`.

- **Shared vs per site.** Patients, catalog, team, invoices (one numbering per legal entity) and reports are shared.
  Per site: chairs, working hours, appointments, the cash drawer (`cash_sessions` unique per org/site/day, NULLS NOT
  DISTINCT) and cash records (`payments`, `refunds`, `expenses`, `honorarium_payments` carry `branch_id`).
- **Main site** = the first site created (`mainSiteId`). Rows from before multi-site were assigned to it by 0052 (guard
  triggers paused for that one deterministic statement); `ofSite()` still counts rows without a site for the main
  site. `guard_branch_same_org` refuses another clinic's site on insert.
- **Current site.** `ClinicContext.sites` (active sites the member may use: `memberships.branch_ids`, null = all) and
  `siteId` (cookie `cdp_site`, set by `chooseSiteAction`, re-validated by `currentSiteId`, else main). The switcher sits
  under the clinic name (hidden with one site). Agenda, reception, agenda settings, procedure entry defaults and the cash
  day follow the current site; the report adds a per-site table (production by visit site, net collections by the site
  that took the money). A closed site, or a site of another clinic, falls back to the main site.
- **Not yet:** staff restricted to some sites in the team screen (column exists), separate legal entity/numbering per
  site, per-site public booking links, a clinic computer per site (offline mode assumes one per clinic).
