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

- Bytes live on the clinic server's disk (`CLINICAL_STORAGE_DIR`; Docker volume `clinical-files`), never under `/public`.
  The storage key `<org>/<patient>/<uuid>.<ext>` is generated server-side, validated by regex and confined to the root;
  it is never accepted from or shown to a client. Files are written with `wx` (no overwrite) and 0600; a failed DB
  transaction removes the just-written file (the only delete path).
- Media type comes from magic bytes (JPEG/PNG/WebP → image, PDF/DICOM → document), never from the browser. sha256 and
  size are stored. `clinical_files` and `clinical_file_comparisons` are append-only; corrections are new uploads.
- Upload is a route handler (`POST /api/patients/[id]/clinical-files`, multipart) because server actions cap bodies at
  1 MB. `src/proxy.ts` makes Next buffer request bodies, so `experimental.proxyClientMaxBodySize` must stay above the
  20 MB limit plus multipart overhead, or larger files are silently truncated.
- `GET /api/clinical-files/[id]` checks `clinical.images.read`, audits `clinical_file.viewed`, and returns
  `private, no-store`, `nosniff`; `CSP: sandbox` for images/DICOM (not PDFs: browsers refuse to render them sandboxed).
- `path.resolve` calls on runtime data carry `/*turbopackIgnore: true*/` so the standalone build doesn't trace the
  project or stored files; `.data` is in `.gitignore` and `.dockerignore`.
