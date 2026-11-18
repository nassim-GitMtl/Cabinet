# Build status and handoff

**Read this first when the user says "continue".** Work the first unchecked item in "Next steps", keep the
checks green, then update this file (move items, add notes) before ending your turn. Claude and Codex
alternate on this repo; this file is the shared memory between them.

Last updated: 2026-11-18 by Claude (session 20 — consumables per procedure, lot recall, reorder suggestions).

> **In progress (Claude, session 21 — sterilization traceability, Next step 1).** Done: schema
> `src/server/db/schema/sterilization.ts` (sterilizers, instrument_sets, sterilization_cycles, sterilization_packs,
> sterilization_pack_uses), migrations 0029 (tables) + 0030 (no-delete registration, same-clinic link checks, cycle state
> machine pending_release → released|failed, released → recalled; a failed indicator blocks release; pending biological
> indicator resolved once; packs added only to pending cycles; pack use only from released, non-discarded, non-expired
> packs, one active use per pack, void once with reason), applied to the main DB. New permission `sterilization.release`
> (owner, dentist; backfilled for existing system roles in 0030). Left: `src/features/sterilization/server.ts` (setup,
> recordCycle with ST-YYYY-NNNNNN pack codes via nextCounter, release/fail/recall/biological result, discard, pack lookup,
> link pack to patient/procedure, void, cycle trace), integration tests (incl. cross-tenant + grants NO_DELETE list),
> Code 128 label encoder + print page, pages `/sterilization`, `/sterilization/cycles/[id]`,
> `/patients/[id]/sterilization`, nav entry, FR/EN/AR strings, checks, STATUS. Typecheck green; tests not yet written.

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
| Patient registration & directory (§6) | ✅ | Numbering, Arabic names, approximate age, E.164 phones, emergency contact, duplicates (clinic-local), archive/restore, optimistic locking |
| Patient profile workspace (§7) | 🟡 | Header (identity, age, contacts, alert chips, Bill button), overview (real balance), details, alerts, clinical history, odontogram, treatment plans, finance tab (account, invoices, payments, deposit). |
| Clinical alerts separate from marketing (§7, §8) | ✅ | `patient_alerts`; structured medical questionnaires, clinician review and explicit alert promotion ✅ |
| Guardians / relationships (§6) | 🟡 | Table only; UI ⏳ |
| Service catalog with default prices & history (§11) | ✅ | 41 editable demo services (flagged, FR/EN/AR), append-only price history, reusable category/search picker with per-user favorites and recents |
| i18n FR/EN/AR + RTL (§2, §5) | ✅ | Key parity test; PDFs in Arabic ⏳ |
| Responsive/mobile shell, PWA manifest (§5, §27) | 🟡 | Modern desktop sidebar, floating mobile bottom nav, FAB, sticky form actions, and an always-available FR/EN/AR FDI tooth-number guide. Service worker/offline policy ⏳ (no patient data offline by design) |
| Scheduler & booking (§9, §9A) | ✅ | Agenda: clinician day view (phone list), patient search, book/move (version-checked)/cancel/no-show/confirm, working hours + time off with explicit override, PostgreSQL EXCLUDE constraints prevent overlaps per clinician/chair/patient (concurrency-tested). Online booking: `/book/[token]` public page with real free slots (hours − booked − time off, min notice, horizon), pending requests only, secret status page; staff `/agenda/requests` approve (duplicate-checked patient creation or existing pick, locked single approval, taken slot stays pending) / decline with patient-safe reason; link create/copy/deactivate; limits 3/phone/day, 10/IP/hour, honeypot; public org resolution only via SECURITY DEFINER functions. Settings at `/settings/agenda`: chairs (add/deactivate), appointment types (FR/EN/AR names, default duration, online-bookable, active), weekly working hours per clinician (two ranges/day, overlap-validated), time off (clinician or whole clinic; leave/holiday/blocked) that blocks staff + online booking and reports overlapping appointments. Week view (Sun–Sat). Drag-and-drop, recurring, curated offers, propose-alternative, SMS/WhatsApp notifications ⏳ 🔌 |
| Reception/queue (§10) | ✅ | Today's queue with forward-only arrival → waiting → in treatment → completed workflow |
| Visits & fast procedure entry "Ajouter un acte" (§14) | ✅ | Completed encounter + procedure snapshot, FDI anatomy, clinician/date/qty/price, controlled overrides, reversal/error correction, phone UI + clinical history |
| Treatment plans/estimates/consents (§12A, §13) | 🟡 | Treatment plans ✅: immutable versioned estimates with catalog/anatomy/price snapshots, exact-version proposal + acceptance/refusal, full revision history, and one-time accepted-item conversion to completed procedures. Consent capture/signatures ⏳. |
| Odontogram, perio chart, notes, signing (§12) | 🟡 | Permanent FDI chart ✅: append-only findings/surfaces, resolution/correction history and treatment links. Structured draft notes, review, signing, amendments and hash-chain integrity ✅. Primary visual chart and periodontal chart ⏳. |
| Images/documents, object storage (§12A, §15) | ⏳ 🔌 | |
| Invoices, payments, deposits, refunds, ledger (§16) | ✅ | Invoices from completed procedures (snapshots, billed once, draft/issue/void), per-entity yearly numbering (F-/AV-/R-), payments with idempotency key, partial/auto/over-payment, deposits + later application (no new receipt), credit notes (release excess allocations), refunds ≤ unapplied, payment reversal reopening balances. DB triggers enforce immutability and all allocation/refund/credit limits. Split billing of one procedure, line discounts UI, installments, third-party/family allocation ⏳ |
| Cash close, expenses (§17) | ✅ | `/cash`: one session per day, opening float, expected cash derived from ledger (cash receipts − cash refunds − cash expenses ± transfers; card/transfer excluded), count + mandatory discrepancy reason, approval (`cash.close.approve`), print. Cash entries dated on a closed day are blocked (payments, refunds, expenses, movements). `/expenses`: categories, suppliers (auto-created), unpaid/paid/void with DB guards. Per-branch drawers, supplier balances, recurring expenses, attachments ⏳ |
| Dashboards & reports, daily/monthly grouped by invoice, print (§18, §19) | 🟡 | `/reports`: daily + monthly with §18 metric bases (production, invoiced sales, gross/net collections, unbilled), procedures grouped by invoice, invoice list, credit notes, payments by method, by service/provider, per-day breakdown; A4 print. CSV/Excel export, receivables aging, saved views, branch/provider filters ⏳ |
| Messaging/reminders (§20) | ⏳ 🔌 | Requires real SMS/WhatsApp/email providers |
| Patient portal (§21) | 🟡 | Invite-only activation, separate patient accounts/sessions with lockout, consent inbox/history/revocation, linked-clinic appointments, accepted estimates, invoice/payment history, and assisted single-use account recovery ✅. Health records and online payment provider integration ⏳ |
| Lab, inventory, sterilization (§22, §23) | 🟡 | Inventory ✅: items, per-branch lots, immutable movement ledger, low/expiry alerts, FEFO usage, supplier purchase orders/receiving, barcode/QR camera and GS1 scan actions. Consumable recipes per procedure (confirm or auto), patient-to-lot recall with export, and explainable reorder suggestions ✅. Lab and sterilization ⏳ |
| Imports/FHIR/integrations (§26) | ⏳ 🔌 | |
| Backups/restore exercise (§27, scenario 32) | ⏳ | |
| Platform operations console (§25) | ⏳ | |

## Next steps (in order)

0. Clinic server follow-ups: optional internet sync to a cloud
   copy for patient booking links/portal/cross-clinic sharing when online; attachments folder in backups once
   file storage exists.

1. Sterilization traceability: instrument sets, cycle/indicator records, chairside scan and exact patient/procedure linkage.
2. Questionnaire editor (new versions with clinician approval) and patient completion via the portal/tablet mode.
3. Clinical images & documents (§12A/§15): private file storage on the clinic server, camera upload, before/after, included in backups.
4. Inventory follow-ups: show pending consumptions on the procedure/patient screen for chairside confirmation; turn a
   reorder suggestion into a draft purchase order.

## Known gaps / decisions to revisit

- Clinical notes: links to specific performed procedures/odontogram findings are by tooth number and date only; a note-template editor UI and per-encounter auto-note are not built yet.

- Role names for custom roles are stored as entered; system roles are translated via `messages.*.roles`.
- `next dev` must be started with an explicit `--port` if 3000 is busy (see `.claude/launch.json`).
- Login rate limiting is per-account lockout only; add per-IP limiting before public exposure.
- Legal/regulatory items (invoice mentions, tax, retention, data hosting) are configurable placeholders pending local professional validation (§2, §25).
