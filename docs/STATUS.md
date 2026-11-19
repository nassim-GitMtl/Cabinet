# Build status and handoff

**Read this first when the user says "continue".** Work the first unchecked item in "Next steps", keep the
checks green, then update this file (move items, add notes) before ending your turn. Claude and Codex
alternate on this repo; this file is the shared memory between them.

Last updated: 2026-11-19 by Codex (session 27b — after-visit validation and distinctive roadmap).

## How to verify the current state

```bash
npm run db:up          # docker compose: Postgres 18 on localhost:54329
npm run db:migrate     # main database
npm run db:seed        # fictitious demo clinic (credentials in .env.example)
npm test               # unit + integration (integration resets cabinet_test)
npx tsc --noEmit && npx eslint src tests scripts
npx next build
npx next dev --port 3010
```

Session 1 results: 34/34 tests passing, typecheck clean, lint clean, production build OK. Browser-checked:
login, dashboard counts, patient list/search (accent + phone formats), duplicate warning → confirmed create,
profile with header alert chips, catalog price edit with history, Arabic RTL on a 375 px phone viewport.

Session 2 results: 44/44 tests passing (25 unit, 19 PostgreSQL integration), typecheck clean, lint clean,
and production build green with Next's supported `--webpack` fallback. The sandbox blocks Turbopack's Tailwind
worker from binding its internal localhost port (`EPERM`); this is a runner restriction, not a compile failure.
Browser-checked the Turbopack dev build at 375 px: operational dashboard with real activity/recent-patient data,
patient → phone-first procedure entry, persistent clinical alert, category/search picker, anatomy-dependent fields,
clinical history empty state, and Arabic RTL. Integration
coverage verifies completed encounters, immutable catalog/price snapshots, FDI anatomy, override permission +
reason + approver, audited reversal, favorites/recents, and cross-tenant read/write denial.

Session 3 results (Claude): 54/54 tests (10 new billing integration tests), typecheck, lint, production build
green. Browser-checked on a 375 px phone: procedure → checkout → issue F-2026-00001 → partial cash payment
(state "partiellement payée", balance correct, receipt print link) → daily report (procedures grouped by
invoice, invoice total once, unbilled group, payments by method) → monthly report → A4 invoice print.
Bug found and fixed: Drizzle drops table qualifiers in single-table selects, so correlated subqueries must
use explicit raw identifiers (see ARCHITECTURE.md "Correlated subqueries").

Session 4 results (Codex): 65/65 tests, typecheck, lint and production build green. Agenda WIP completed with `/agenda`
provider day columns, patient search and booking dialog, conflict-aware errors, appointment details,
confirmation/cancellation/no-show actions, `/reception` forward-only arrival → waiting → treatment → completed
flow, navigation and patient next-appointment card. Browser-checked patient search/selection in English plus
Agenda and Reception in Arabic RTL without creating product data.

Session 5 results (Claude, committed Codex's session-4 work): 65/65 tests, typecheck, lint, build green. Added
"Déplacer" rescheduling (version-checked, availability re-checked, confirmation reset), after-visit shortcuts
(add procedure / bill) on in-treatment and completed appointments, appointment type → default duration auto-fill,
RTL time-range fix (`dir="ltr"`) and Arabic plural for the reception count. Browser-checked on 375 px: booked
via patient search, moved 10:00 → 11:00, agenda and reception in Arabic.

Session 5b (Claude): patient booking links with mandatory staff approval. 73/73 tests (5 new booking integration
tests + 3 slot unit tests), typecheck, lint, build green. Browser-checked on 375 px: staff creates link → public
page shows real free times (weekend and booked slots excluded, 12 h notice) → patient request → status page
"en attente de validation du cabinet" → staff "Créer la fiche et valider" → status "Rendez-vous confirmé".

Session 6 (Claude): agenda settings + week view. 78/78 tests (5 new), typecheck, lint, build green. Browser-checked
`/settings/agenda` (chairs, types, weekly hours editor, time off) and the Sunday-start week view.

Session 7 (Codex): modernized the shared app shell, page headers, cards and dialogs without changing workflow
behavior. Added an always-available FDI permanent-tooth numbering guide to desktop and mobile chrome with complete
FR/EN/AR copy. 78/78 tests, typecheck and lint green. The standard Turbopack build still fails on the known local
helper-port restriction; Next's supported `npx next build --webpack` fallback is green. Browser-checked the Arabic
desktop dashboard, mobile agenda, responsive navigation and tooth-guide dialog; RTL ordering and FDI quadrants are
correct.

Session 8 (Codex): treatment plans and estimates end to end. Added tenant-scoped plan workflow, immutable full
estimate versions and service/price/anatomy snapshots, exact-version patient acceptance/refusal, revisions that
preserve prior decisions, and one-time conversion of accepted items into completed procedures. Patient workspace,
estimate builder/detail/history, FR/EN/AR and RTL are complete. 81/81 tests (3 new integration tests), typecheck and
lint green; supported `npx next build --webpack` is green after the unchanged Turbopack helper-port restriction.
Browser-checked the Arabic patient treatment tab and responsive estimate builder without creating product data.

Session 9 (Codex): consent flows and patient portal accounts end to end. Staff can create a portal identity only
after documenting an assisted in-person identity check, issue a single-use seven-day activation link, and request
an exact category/date/future-update scope. Patients activate a separate locked-down account, sign in, approve or
decline requests, and revoke active grants. Grant creation remains patient-context-only in PostgreSQL; approved
grants are immutable except for revocation. The shared-read guard evaluates the grant and writes an allowed/denied
event atomically. 84/84 tests (3 new integration tests), typecheck and lint green; supported
`npx next build --webpack` is green after the unchanged Turbopack helper-port restriction. Browser-checked the
Arabic portal login at a 390 px mobile viewport; RTL layout and responsive form are correct.

Session 10 (Codex): staff access security end to end. Added single-use seven-day staff invitations for new or
existing global accounts, exact clinic role assignment, custom role creation/editing, owner/self lockout guards,
immediate session revocation on deactivation, encrypted TOTP enrollment, password-first MFA challenges, eight
single-use hashed recovery codes, and active-session review/revocation. All mutations are audited and invitation
data remains tenant-isolated. 88/88 tests (3 new integration tests + TOTP unit coverage), typecheck and lint green;
supported `npx next build --webpack` is green after the unchanged Turbopack helper-port restriction. Browser-checked
Arabic RTL team and account-security screens on desktop and mobile without changing demo data.

Session 11 (Claude): **clinic server — runs on the clinic network with no internet** (user decision 2026-11-18:
"Clinic server (no internet)"; per-device offline data was explicitly not chosen). Also committed Codex session 10
after verifying it (88/88). Results: 89/89 tests, typecheck, lint, `next build` green; Docker images built
(app 305 MB, migrate 1.55 GB); full stack verified on test ports: migrations, HTTPS via Caddy local CA
(`/ca.crt` download validates the certificate), HTTP→HTTPS redirect, `/api/health`, first-only registration,
`cabinet_app` role non-superuser/NOBYPASSRLS. **Backup/restore exercise (scenario 32), measured:** dev demo DB
(302 KB dump) restored into the stack in 18 s; then backup (296 KB, sha256 verified) → modification → restore in
19 s (includes safety backup + app restart); clinic name and 196 audit events identical after restore; health OK.
Connection banner verified (appears within ~30 s when the server stops answering, clears on recovery).
Browser pane cannot open the stack's HTTPS (local CA not trusted on this machine — expected; devices install `ca.crt`).

Session 12 (Claude): 96/96 tests (+4 export unit, +3 integration), typecheck, lint, build green. Excel (.xlsx,
dependency-light writer on fflate: inline strings never evaluated, numeric money, real dates, frozen header) and CSV
(French Excel: `;`, decimal comma, UTF-8 BOM, OWASP formula-injection guard) exports of daily/monthly reports
(`/api/exports/report`, sheets: summary with metric bases, procedures, invoices, payments, refunds, credit notes)
and aging (`/api/exports/aging`); `report.export` required, every export audited (filters/format only).
Receivables aging as of any date (`/reports/aging`, 0–30/31–60/61–90/90+ from due date). Printable patient account
statement (`/print/statements/[id]`, browser "Save as PDF") reconciled in tests with the account
(closing = amount due − unapplied credit). Migrate image slimmed 1.55 GB → 242 MB (esbuild bundle). Browser-checked
downloads (xlsx "PK", CSV French format), aging page, statement.

Session 13 (Codex): patient portal expansion end to end. Each patient account now resolves only its active,
verified clinic identity links, then reads appointments, accepted/completed estimates, issued invoices with derived
balances, and payment receipts under that clinic's tenant context and exact local patient ID. The portal never
offers a fake online payment flow; it directs the patient to the clinic. Staff can create a 24-hour, single-use
password-recovery link only after an assisted identity check; resetting clears lockout state, revokes every existing
patient session, and consumes the link. FR/EN/AR and RTL copy are complete. 98/98 tests (2 new integration tests),
typecheck and lint green. The standard Turbopack build still hits the known runner-only helper-port `EPERM`;
`npx next build --webpack` is green and includes `/portal/recover/[token]`.

Session 14 (Codex): odontogram foundation end to end. Added a responsive permanent-dentition FDI chart to the
patient clinical workspace with tooth/surface findings, ten finding types, observation date and clinician, plus
optional exact-tooth links to current treatment-plan items and completed procedures. Findings are append-only:
resolution or correction creates one serialized superseding event, and the database rejects mutation, duplicate
supersession, cross-patient/cross-tooth treatment links, and cross-tenant writes. Audits contain identifiers only,
not clinical notes. FR/EN/AR and RTL are complete. 102/102 tests (2 unit + 2 integration added), typecheck and lint
green; `npx next build --webpack` green after the unchanged Turbopack helper-port restriction. Browser-checked the
Arabic clinical workspace and odontogram layout without creating demo data.

Session 15 (Claude): clinical notes (§12). 106/106 tests (+4 integration), typecheck, lint, build green. Drafts with
1.2 s debounced autosave + optimistic locking (conflict → reload), structured sections (complaint, observations,
assessment, plan, work performed, FDI teeth), clinic templates (5 starters; template snapshot stored to separate copied
text), assistant "send for signature" → signer review, explicit attestation, signing writes immutable version 1
(append-only `clinical_note_versions`, DB trigger freezes the header), dated amendments with reason as new versions,
SHA-256 hash chain verified on every view ("Intégrité vérifiée"), discard instead of delete, audit of view/sign/amend.
Browser-checked: template draft → autosave → sign → amendment, integrity badge.

Session 16 (Claude): medical history (§8) + security fix. 111/111 tests (+4 health, +1 privilege guard), typecheck,
lint, build green; browser-checked fill → header "à revoir" badge → allergy promoted to a critical alert → review.
**Security fix:** migrations 0006–0022 used bare `REVOKE DELETE`, later undone by `apply_security()`; the app role
could DELETE payments, cash_sessions, expenses, appointments, booking_requests, treatment_plans, clinical_notes
(triggers still blocked edits; app code never deleted). Fixed by `app_private.no_delete_tables()` inside
`apply_security()` (0023) + catalog-level regression test. Observed one unreproduced failing run (4 tests incl.
procedures reversal) followed by 3 clean full runs — watch for flakiness.

Session 17 (Codex): inventory foundation (§22/§23). Added an inventory workspace with tenant-scoped item catalog,
branch-specific immutable lots, append-only receipt/usage ledger, derived balances, reorder thresholds, 60-day expiry
alerts and expired-lot quarantine visibility. Routine consumption is atomic FEFO across usable lots and never consumes
expired stock; database triggers reject mismatched lot references, wrong movement signs and negative balances under
concurrency. FR/EN/AR, RTL navigation and permission-gated UI are complete. Integration coverage verifies FEFO,
expiry exclusion, immutable movements, privilege grants and cross-tenant denial. 114/114 tests, typecheck and lint
green; `npx next build --webpack` is green and includes `/inventory` after the unchanged runner-only Turbopack
helper-port restriction. Browser-checked the responsive French inventory empty state without creating demo data.

Session 18 (Codex): inventory purchasing phase 2. Added multi-line supplier purchase orders with per-year `BC-…`
numbering, optional integer-minor-unit costs, delivery expectations, partial deliveries and automatic ordered → partially
received → received progression. Each delivery creates or reuses an immutable lot and links its append-only stock movement
to the exact order line. Database guards reject cross-tenant references, mutation, closed-order receipts and over-receipt;
audits stay in the same transaction. FR/EN/AR and responsive forms are complete. 115/115 tests, typecheck and lint green;
the standard Turbopack build still hits the known runner-only helper-port `EPERM`, while `npx next build --webpack` is
green and includes `/inventory`. Browser-checked the French mobile inventory and purchase-order form without creating data.

Session 19 (Codex): inventory barcode/QR workflow. Added tenant-unique multi-code identifiers per item (EAN-13, GTIN/GS1,
Code 128, QR/Data Matrix and internal), with immutable assignment and one-way audited deactivation instead of silent
reassignment. `/inventory` now accepts USB/Bluetooth scanner input or manual codes, and uses the local browser camera when
`BarcodeDetector` is available. GS1 `01`/`17`/`10` decoding resolves the product and prefills lot/expiry for immediate
receipt; recognized items also expose quick FEFO consumption. No scan image or payload leaves the clinic. Database guards
cover actor, same-tenant item links and mutation; tests cover compact/human GS1, month-end expiry, uniqueness, permissions,
immutability and cross-tenant denial. 119/119 tests, typecheck and lint green; `npx next build --webpack` is green after
the unchanged runner-only Turbopack helper-port restriction. Browser-checked the responsive French GS1 scan/assignment flow.

Session 20 (Claude): inventory phase 2. Consumable recipes per catalog service (`/inventory/consumables`); each completed
procedure creates usage lines, confirmed at chairside (default) or consumed automatically (org mode `auto`, shortage stays
pending, never blocks care); confirm/skip with reason, then frozen by trigger; reversed procedures cannot consume. Usage
movements link to the procedure, giving `/inventory/lots/[lotId]`: patients/procedures per lot, untraced manual usage, and
an audited Excel/CSV recall export (`/api/exports/lot`). Explainable reorder suggestions from 90-day usage, agenda load,
minimum stock and open orders. Migrations 0027–0028 (same-clinic link triggers, no-delete registration). 124/124 tests
(5 new consumables integration tests + grants list), typecheck, lint, `npx next build` green. Browser-checked on the dev
server: item + lot created, recipe REST-01 → 2 capsules, auto mode, composite recorded on tooth 36 → lot L2611A shows
the patient with 18 left, export headers translated, Arabic RTL page. Note: a long-running `next dev` served stale
message JSON to a route handler until restarted.

Session 21 (Claude + Codex): sterilization traceability (§23). Added clinic/branch-scoped sterilizers and instrument sets,
immutable cycle facts and indicators, an explicit authorized pending → released/failed decision, released → recalled flow,
and one-time biological results that automatically recall a released load when non-conforming. Every pouch receives a
tenant/year `ST-YYYY-NNNNNN` code and printable local Code 128 label; only released, unexpired, non-discarded pouches may
be scanned/entered and linked once to the exact patient and optional completed procedure. Wrong links are voided with a
reason, never deleted. Database guards enforce same-clinic references, actors, transitions, immutability and no-delete
privileges; service actions are permission-checked and audited in the same transaction. `/sterilization`, cycle detail,
label print and `/patients/[id]/sterilization` are complete in FR/EN/AR with RTL. 129/129 tests (2 encoder unit + 3
sterilization integration tests added), typecheck and lint green. The standard Turbopack build hit the documented
runner-only helper-port restriction; `npx next build --webpack` is green with all four new routes. Browser-checked the
responsive French empty/setup state without creating product data.

Session 22 (Codex): medical questionnaire completion end to end. Owners can build complete FR/EN/AR questionnaire
versions with stable question identifiers, reorder questions and configure sensitive/clinical-alert metadata; saving creates
an immutable draft and a practitioner with the separate approval permission atomically activates it without rewriting older
responses. Linked patients can complete or update the approved form in their portal for the exact clinic record. Staff can
also create a random, hashed, 30-minute, single-use tablet handoff from the patient workspace; replay and cross-clinic access
are rejected by database guards/RLS. Both patient sources create acknowledged append-only responses awaiting the existing
clinician review. Migration 0031 adds one-current-version enforcement and tablet sessions. FR/EN/AR and RTL copy are complete.
132/132 tests (3 new integration tests), typecheck and lint green. The standard Turbopack build hit the documented runner-only
helper-port restriction; `npx next build --webpack` is green and includes `/settings/questionnaire`,
`/portal/health/[organizationId]` and `/health/tablet/[token]`. Visual browser verification was unavailable because the Mac
was locked; route compilation and production rendering checks completed in the build.

Session 23 (Codex + Claude): clinical images & documents (§12A, §15). Codex built it and stopped before committing;
Claude finished, fixed and verified it. Private files on the clinic server (`CLINICAL_STORAGE_DIR`, Docker volume
`clinical-files`, default `.data/clinical-files` in dev), never under `/public`, never cached by the service worker.
Upload from the patient "Images et documents" tab (file or camera capture): JPEG/PNG/WebP/PDF/DICOM up to 20 MB, type
taken from magic bytes (browser type ignored), sha256 + size stored, FDI teeth, clinical date (no future), category,
optional title. Before/after pairs: the new image becomes "after" for one earlier unpaired image of the same patient.
Migration 0032: both tables append-only (no update/delete for the runtime role), DB guards for actor, same clinic/patient,
kind ↔ media type, FDI numbers, after ≥ before date. Every original view is audited (`clinical_file.viewed`). Daily
backups now write `cabinet-<ts>-files.tar.gz` next to the dump (same sha256 file); `restore.sh` restores both.
Claude's fixes: (1) a successful upload showed "Une erreur est survenue" (`event.currentTarget` read after `await`);
(2) uploads over 10 MB were silently truncated because `src/proxy.ts` makes Next buffer bodies (default 10 MB) →
`experimental.proxyClientMaxBodySize: "21mb"`; (3) PDFs were served with `CSP: sandbox`, which browsers refuse to show
in their PDF viewer → sandbox kept for images/DICOM only; (4) dynamic storage paths made Turbopack trace the whole project
(and potentially local patient files) into the standalone output → `turbopackIgnore` hints, `.data` in `.dockerignore`.
135/135 tests (2 integration + 1 unit added), typecheck, lint and `next build` (no warnings) green. Browser-checked on
localhost: upload → library, before/after pair, 12.9 MB image round-trips byte-identical, spoofed PNG rejected (400),
21 MB rejected (413), private/no-store headers, Arabic RTL at 375 px. Inline PDF display not checked (the in-app browser
downloads PDFs). Fictitious test files were left on P-000012 in the dev database.

Session 24 (Claude): patient follow-ups "Relances" (§20), first step of the new priority (see "Product direction").
`/follow-ups` (nav "Relances", permission `patient.followup`: owner, dentist, assistant, receptionist; backfilled in 0033)
lists real data only: tomorrow's (first upcoming day with appointments) reminders with confirmation status, check-up recalls
(last completed procedure/visit ≥ N months, default 6, no future appointment), accepted-but-unfinished plans and proposed
estimates older than 3 days without a next appointment, and no-shows of the last 30 days. Each card has the message ready in
the patient's language (FR/EN/AR, Arabic first name when known, weekday + date + time + practitioner + clinic phone, no
clinical detail) with one-tap WhatsApp (wa.me) / SMS / call / copy, "Marquer confirmé", and an outcome log (joint, pas de
réponse, RDV pris, refuse). Nothing is sent by the server: staff send from their own phone, so it works with the offline
clinic server. Every attempt goes to append-only `patient_contacts` (DB guard: staff actor, same clinic/patient, appointment
or plan of that patient; reference must match the reason). Contacted patients leave the list for 30 days (recall) / 14 days;
"refuse" hides them 6 months. `/settings/follow-ups`: recall delay, clinic phone per branch (branches.phone, E.164) and
per-language template overrides (empty = built-in default). Patient form: "Ne souhaite pas recevoir de rappels par message"
(communicationPrefs.transactionalAllowed, merged so marketing consent evidence is kept); opted-out patients are excluded.
144/144 tests (4 integration + 2 unit files added), typecheck, lint, `next build` green. Browser-checked on localhost with
fictitious rows added to the demo clinic (P-000002/05/06/09/10, appointments on 22/11/2026): reminders with Arabic message,
WhatsApp click logs "Message préparé", confirm, outcome "RDV pris" removes the recall, estimate card with amount, clinic phone
saved and inserted into messages, Arabic RTL at 375 px, opt-out checkbox saved both ways. Bug fixed during the check: the
contact action rejected the `null` reference sent by buttons (unit test added).

Session 25 (Claude): where new patients come from (§6, §19). Migration 0034 adds `acquisition_channel` (Facebook,
Instagram, TikTok, Google/Maps, bouche-à-oreille, recommandé par un patient, adressé par un médecin, passage, convention,
autre) on patients and booking requests, and `patients.referred_by_patient_id` (DB guard: same clinic, never self). Patient
form: "Comment nous a-t-il connu ?" + detail + referring-patient search (picking a referrer sets the channel; another channel
clears it; fields absent from an update keep stored values). Public booking form asks the optional question in the patient's
words; the answer shows in the request inbox and is copied to the patient created on approval. Patient details show source,
referrer link and "N patients recommandés". `/reports/acquisition` (report.operational; link on /reports): 3/6/12 months —
new patients, % with a source, % treated (≥1 completed procedure), online bookings accepted/received; by source (share,
treated, production only with report.financial), by month, booking funnel, top referring patients. 148/148 tests (3
integration + 1 unit added), typecheck, lint, `next build` green. Browser-checked: new patient referred by HAMDI Nour saved
and shown on details, report with real demo numbers (13 new, 12 without source → reminder shown), referrer list, public booking
question. Fixed during the check: report tables overflowed the page (grid items need `min-w-0`).

Session 26 (Claude): clinic public page + QR poster (§9A). Migration 0035: `clinic_public_profiles` (one per clinic;
globally unique lowercase slug; unpublished by default; about FR/EN/AR, WhatsApp, Google Maps/Facebook/Instagram https
links, booking link, up to 24 featured catalog services, opt-in "à partir de" prices). Guard: staff editor, same-clinic booking
link and services. Visitors resolve a published page of an active clinic through `app_private.resolve_public_clinic` (SECURITY
DEFINER, returns the organization only), then tenant-scoped reads of public fields: name, branches (address/phone), opening
hours = union of active clinicians' agenda hours per weekday, featured services, active booking link. `/settings/public-page`
(org.settings.manage): address with availability check (`public_slug_taken`), publish switch, local-network warning,
view/copy, A4 poster `/print/public-poster` (French + Arabic, vector QR via the `qrcode` package, falls back to the booking
link when unpublished), SVG QR download `/api/public-page/qr`. `/c/[slug]` is public in `src/proxy.ts`, has Open Graph
title/description for social previews, works FR/EN/AR. Optional `PUBLIC_APP_URL` (env, clinic compose) sets the internet
address used in shared links. 154/154 tests (2 integration + 1 helper unit file added), typecheck, lint, `next build` green.
Browser-checked: demo clinic page saved and published (4 services with prices), phone view, Arabic RTL, anonymous 200 / unknown
404, no staff or patient names in the HTML, poster with bilingual text + QR + phone, SVG download. Note: npm audit lists 8
moderate issues, all pre-existing dev tooling (drizzle-kit, shadcn), none from `qrcode`.

Session 27 (Claude): after-visit messages, reviews and referral thanks. Migration 0036 adds follow-up reasons
`after_visit` and `referral_thanks` and `patient_contacts.visit_date` (reference CHECK compares `reason::text`, since a
migration cannot use enum values added in the same transaction). Relances gets two tabs: "Après visite" (patients with
completed procedures on a day, default today, day navigation; message = thanks + the clinic's own care advice for the
catalog categories treated that day + clinic phone, plus the Google review sentence when a review link is set; logging checks
the patient really had a completed procedure that day) and "Remerciements" (patients who referred someone in the last 60 days;
hidden once thanked until their next referral; the message never names who was referred). `/settings/follow-ups` gains the
review link (https) and optional care advice per catalog category in FR/EN/AR — none shipped by default (clinical wording is
the clinic's). 155/155 tests (1 integration test added), typecheck, lint, `next build` green. Browser-checked on the demo
clinic: settings saved, after-visit card for BENSAID Karim with review link (no advice for his category, as configured), WhatsApp
click logged with the visit day, Arabic thank-you to HAMDI Nour without naming the referred patient.

Session 27b (Codex): validation follow-up. The Google review destination is now also editable from the public-page settings
and remains the same organization value used by after-visit messages; that save merges only the nested review key, preserving
templates and clinic-authored aftercare. Long messages have an explicit expand/collapse control so staff can review the full
text on mobile before sending. Fixed the public poster action showing a translation key. 155/155 tests, typecheck and lint
green; `npx next build --webpack` green after the unchanged runner-only Turbopack helper-port restriction. Browser-checked
the real French post-visit card, full-message disclosure and shared public-page review field without changing product data.

## Requirement coverage map

Legend: ✅ implemented and verified · 🟡 implemented, awaiting validation · 🔌 integration-dependent · ⏳ planned · ⛔ out of scope (reason)

| Area (brief §) | Status | Notes |
| --- | --- | --- |
| Multi-tenant orgs, legal entity, branch (§2, §25) | ✅ | Created at registration. Branch/legal-entity management UI ⏳ |
| Postgres RLS tenant isolation (§4A, §27) | ✅ | Integration tests: cross-tenant read/write denied, no-context = 0 rows |
| Roles & permission templates (§4) | ✅ | Permission-key templates, tenant custom role editor, owner-role protection and exact membership assignment |
| Staff auth: login, sessions, lockout, logout (§4, §27) | ✅ | Invite activation, password lockout, encrypted TOTP + recovery codes, MFA challenge, active session list/revocation. Account recovery ⏳ |
| Clinic onboarding (§25) | 🟡 | Self-service register creates clinic + catalog. Wizard steps (hours, chairs, branding, numbering) ⏳. Verification workflow ⏳ |
| Active clinic switching for multi-org staff (§4A) | ✅ | `/select-clinic`, membership re-checked per request |
| Audit trail (§4, §27) | ✅ | Append-only; viewer UI ⏳ |
| Network identity + consent schema (§4A) | ✅ | Assisted in-person verified linking, exact-scope requests, patient-only approval/revocation, immutable grants, guarded + logged shared reads and cross-tenant tests |
| Patient registration & directory (§6) | ✅ | Structured acquisition source + referring patient, numbering, Arabic names, approximate age, E.164 phones, emergency contact, duplicates (clinic-local), archive/restore, optimistic locking |
| Patient profile workspace (§7) | 🟡 | Header (identity, age, contacts, alert chips, Bill button), overview (real balance), details, alerts, clinical history, odontogram, treatment plans, finance tab (account, invoices, payments, deposit). |
| Clinical alerts separate from marketing (§7, §8) | ✅ | `patient_alerts`; versioned structured medical questionnaires, separate editor/approval permissions, clinician review and explicit alert promotion ✅ |
| Guardians / relationships (§6) | 🟡 | Table only; UI ⏳ |
| Service catalog with default prices & history (§11) | ✅ | 41 editable demo services (flagged, FR/EN/AR), append-only price history, reusable category/search picker with per-user favorites and recents |
| i18n FR/EN/AR + RTL (§2, §5) | ✅ | Key parity test; PDFs in Arabic ⏳ |
| Responsive/mobile shell, PWA manifest (§5, §27) | 🟡 | Modern desktop sidebar, floating mobile bottom nav, FAB, sticky form actions, and an always-available FR/EN/AR FDI tooth-number guide. Service worker/offline policy ⏳ (no patient data offline by design) |
| Scheduler & booking (§9, §9A) | ✅ | Clinic public page `/c/[slug]` + QR poster ✅. Agenda: clinician day view (phone list), patient search, book/move (version-checked)/cancel/no-show/confirm, working hours + time off with explicit override, PostgreSQL EXCLUDE constraints prevent overlaps per clinician/chair/patient (concurrency-tested). Online booking: `/book/[token]` public page with real free slots (hours − booked − time off, min notice, horizon), pending requests only, secret status page; staff `/agenda/requests` approve (duplicate-checked patient creation or existing pick, locked single approval, taken slot stays pending) / decline with patient-safe reason; link create/copy/deactivate; limits 3/phone/day, 10/IP/hour, honeypot; public org resolution only via SECURITY DEFINER functions. Settings at `/settings/agenda`: chairs (add/deactivate), appointment types (FR/EN/AR names, default duration, online-bookable, active), weekly working hours per clinician (two ranges/day, overlap-validated), time off (clinician or whole clinic; leave/holiday/blocked) that blocks staff + online booking and reports overlapping appointments. Week view (Sun–Sat). Drag-and-drop, recurring, curated offers, propose-alternative, SMS/WhatsApp notifications ⏳ 🔌 |
| Reception/queue (§10) | ✅ | Today's queue with forward-only arrival → waiting → in treatment → completed workflow |
| Visits & fast procedure entry "Ajouter un acte" (§14) | ✅ | Completed encounter + procedure snapshot, FDI anatomy, clinician/date/qty/price, controlled overrides, reversal/error correction, phone UI + clinical history |
| Treatment plans/estimates/consents (§12A, §13) | 🟡 | Treatment plans ✅: immutable versioned estimates with catalog/anatomy/price snapshots, exact-version proposal + acceptance/refusal, full revision history, and one-time accepted-item conversion to completed procedures. Consent capture/signatures ⏳. |
| Odontogram, perio chart, notes, signing (§12) | 🟡 | Permanent FDI chart ✅: append-only findings/surfaces, resolution/correction history and treatment links. Structured draft notes, review, signing, amendments and hash-chain integrity ✅. Primary visual chart and periodontal chart ⏳. |
| Images/documents, object storage (§12A, §15) | ✅ | Private clinic-server storage, camera upload, magic-byte type check, sha256, append-only metadata, before/after pairs, audited views, included in backups. DICOM viewer, annotations/measurements, cloud object storage 🔌 ⏳ |
| Invoices, payments, deposits, refunds, ledger (§16) | ✅ | Invoices from completed procedures (snapshots, billed once, draft/issue/void), per-entity yearly numbering (F-/AV-/R-), payments with idempotency key, partial/auto/over-payment, deposits + later application (no new receipt), credit notes (release excess allocations), refunds ≤ unapplied, payment reversal reopening balances. DB triggers enforce immutability and all allocation/refund/credit limits. Split billing of one procedure, line discounts UI, installments, third-party/family allocation ⏳ |
| Cash close, expenses (§17) | ✅ | `/cash`: one session per day, opening float, expected cash derived from ledger (cash receipts − cash refunds − cash expenses ± transfers; card/transfer excluded), count + mandatory discrepancy reason, approval (`cash.close.approve`), print. Cash entries dated on a closed day are blocked (payments, refunds, expenses, movements). `/expenses`: categories, suppliers (auto-created), unpaid/paid/void with DB guards. Per-branch drawers, supplier balances, recurring expenses, attachments ⏳ |
| Dashboards & reports, daily/monthly grouped by invoice, print (§18, §19) | 🟡 | Acquisition report ✅ (sources, treated share, production, booking funnel, referrers). `/reports`: daily + monthly with §18 metric bases (production, invoiced sales, gross/net collections, unbilled), procedures grouped by invoice, invoice list, credit notes, payments by method, by service/provider, per-day breakdown; A4 print. CSV/Excel export, receivables aging, saved views, branch/provider filters ⏳ |
| Messaging/reminders (§20) | 🟡 | Relances ✅: reminders, after-visit care + review requests, referral thanks, recalls, unfinished treatments, pending estimates, no-shows with ready messages (FR/EN/AR) sent by staff via WhatsApp/SMS links, contact log, opt-out, editable templates. Automatic sending through an SMS/WhatsApp Business provider ⏳ 🔌 |
| Patient portal (§21) | 🟡 | Invite-only activation, separate patient accounts/sessions with lockout, consent inbox/history/revocation, linked-clinic appointments, accepted estimates, invoice/payment history, assisted single-use account recovery, and exact-clinic medical questionnaire completion ✅. Wider health-record views and online payment provider integration ⏳ |
| Lab, inventory, sterilization (§22, §23) | 🟡 | Inventory ✅: items, per-branch lots, immutable movement ledger, low/expiry alerts, FEFO usage, supplier purchase orders/receiving, barcode/QR camera and GS1 scan actions. Consumable recipes per procedure (confirm or auto), patient-to-lot recall with export, and explainable reorder suggestions ✅. Sterilization ✅: equipment/sets, immutable cycles and indicators, authorized release/fail/recall, Code 128 pouch labels, patient/procedure linkage and full trace. Lab ⏳ |
| Imports/FHIR/integrations (§26) | ⏳ 🔌 | |
| Backups/restore exercise (§27, scenario 32) | 🟡 | Daily dump + clinical-files archive with sha256, `restore.sh` restores both. Timed restore exercise on a real clinic server ⏳ |
| Platform operations console (§25) | ⏳ | |

## Product direction (user, 2026-11-19)

Priority: features that bring patients in and make the clinic easy to deal with. Inventory/purchasing is good enough for now
(no warehouse); do not extend it unless asked.

Distinctive product pillars to preserve in future work:

- **For practitioners — one visit cockpit:** alerts, odontogram, planned work, note, traceable consumables, images and the
  aftercare draft in one guided workflow, with clinician confirmation instead of opaque automation.
- **For patients — a visual treatment journey:** clinician-selected before/after images, treatment milestones, estimates,
  consent and aftercare in plain FR/EN/AR, shared only through explicit patient-controlled access.
- **For both — explainable prevention:** recalls and safety prompts show the exact rule/date/source that triggered them;
  the app never invents a diagnosis or hides a recommendation behind an unexplained score.
- **For families — delegated care:** guardian/family access with exact per-patient permissions, consolidated appointments
  and balances, while preserving each patient's confidentiality.

## Next steps (in order)

1. Patient-friendly estimates & payment plans (§13, §16): send the estimate to the patient (portal link or PDF by WhatsApp),
   propose an installment schedule (amounts + due dates, linked to the accepted plan), show upcoming/overdue installments in
   Relances and on the patient finance tab.
2. Visual treatment journey (§12A, §21): let the clinician select images and milestones for the patient portal, with explicit
   consent, plain-language context and revocable access; never expose the full clinical library by default.
3. Chairside visit cockpit (§7, §12, §14): one guided screen for alerts, planned work, odontogram, note, consumable trace and
   the aftercare draft, without replacing clinician decisions.
4. Marketing consent & campaigns (§8, §20): record opt-in with evidence on the patient form, then campaign lists (e.g.
   détartrage season, children's check-up) only for opted-in patients, using the same WhatsApp/SMS tools.
5. Guardian/family portal (§6, §21): exact delegated permissions, combined appointment coordination and balances without
   leaking one family member's clinical record to another.
6. Clinic server optional internet sync to a cloud copy, so public page, booking links and the portal work from outside.

Later / on hold: inventory follow-ups (pending consumptions on the patient screen; reorder suggestion → pre-filled order
form), treatment consent capture (§12A), lab cases (§22).

## Known gaps / decisions to revisit

- Clinical notes: links to specific performed procedures/odontogram findings are by tooth number and date only; a note-template editor UI and per-encounter auto-note are not built yet.

- Role names for custom roles are stored as entered; system roles are translated via `messages.*.roles`.
- `next dev` must be started with an explicit `--port` if 3000 is busy (see `.claude/launch.json`).
- Login rate limiting is per-account lockout only; add per-IP limiting before public exposure.
- Legal/regulatory items (invoice mentions, tax, retention, data hosting) are configurable placeholders pending local professional validation (§2, §25).
