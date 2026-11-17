# Build status and handoff

**Read this first when the user says "continue".** Work the first unchecked item in "Next steps", keep the
checks green, then update this file (move items, add notes) before ending your turn. Claude and Codex
alternate on this repo; this file is the shared memory between them.

Last updated: 2026-11-17 by Codex (session 2 — visits and completed procedures).

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

## Requirement coverage map

Legend: ✅ implemented and verified · 🟡 implemented, awaiting validation · 🔌 integration-dependent · ⏳ planned · ⛔ out of scope (reason)

| Area (brief §) | Status | Notes |
| --- | --- | --- |
| Multi-tenant orgs, legal entity, branch (§2, §25) | ✅ | Created at registration. Branch/legal-entity management UI ⏳ |
| Postgres RLS tenant isolation (§4A, §27) | ✅ | Integration tests: cross-tenant read/write denied, no-context = 0 rows |
| Roles & permission templates (§4) | ✅ | Keys in `permissions.ts`; role editing UI ⏳; staff invitations ⏳ |
| Staff auth: login, sessions, lockout, logout (§4, §27) | ✅ | MFA ⏳, account recovery ⏳, session list/revocation UI ⏳ |
| Clinic onboarding (§25) | 🟡 | Self-service register creates clinic + catalog. Wizard steps (hours, chairs, branding, numbering) ⏳. Verification workflow ⏳ |
| Active clinic switching for multi-org staff (§4A) | ✅ | `/select-clinic`, membership re-checked per request |
| Audit trail (§4, §27) | ✅ | Append-only; viewer UI ⏳ |
| Network identity + consent schema (§4A) | 🟡 | Tables + RLS (staff cannot create grants — tested) + `evaluateSharedAccess` (unit-tested). Request/approval flows, portal ⏳ |
| Patient registration & directory (§6) | ✅ | Numbering, Arabic names, approximate age, E.164 phones, emergency contact, duplicates (clinic-local), archive/restore, optimistic locking |
| Patient profile workspace (§7) | 🟡 | Header (identity, age, contacts, alert chips), overview, details, alerts, and clinical procedure history. Odontogram/treatment/finance tabs ⏳ |
| Clinical alerts separate from marketing (§7, §8) | ✅ | `patient_alerts`; medical questionnaires ⏳ |
| Guardians / relationships (§6) | 🟡 | Table only; UI ⏳ |
| Service catalog with default prices & history (§11) | ✅ | 41 editable demo services (flagged, FR/EN/AR), append-only price history, reusable category/search picker with per-user favorites and recents |
| i18n FR/EN/AR + RTL (§2, §5) | ✅ | Key parity test; PDFs in Arabic ⏳ |
| Responsive/mobile shell, PWA manifest (§5, §27) | 🟡 | Bottom nav, FAB, sticky form actions. Service worker/offline policy ⏳ (no patient data offline by design) |
| Scheduler, booking links, staff approval (§9, §9A) | ⏳ | |
| Reception/queue (§10) | ⏳ | |
| Visits & fast procedure entry "Ajouter un acte" (§14) | ✅ | Completed encounter + procedure snapshot, FDI anatomy, clinician/date/qty/price, controlled overrides, reversal/error correction, phone UI + clinical history |
| Treatment plans/estimates/consents (§12A, §13) | ⏳ | |
| Odontogram, perio chart, notes, signing (§12) | ⏳ | |
| Images/documents, object storage (§12A, §15) | ⏳ 🔌 | |
| Invoices, payments, deposits, refunds, ledger (§16) | ⏳ | **Top priority next** |
| Cash close, expenses (§17) | ⏳ | |
| Dashboards & reports, daily/monthly grouped by invoice, print (§18, §19) | 🟡 | Operational dashboard has real daily visit/procedure/patient counts plus recent activity; financial/daily/monthly reports ⏳ |
| Messaging/reminders (§20) | ⏳ 🔌 | Requires real SMS/WhatsApp/email providers |
| Patient portal (§21) | ⏳ | |
| Lab, inventory, sterilization (§22, §23) | ⏳ | Release 3 |
| Imports/FHIR/integrations (§26) | ⏳ 🔌 | |
| Backups/restore exercise (§27, scenario 32) | ⏳ | |
| Platform operations console (§25) | ⏳ | |

## Next steps (in order)

1. **Invoicing & payments** (§16): `invoices`, `invoice_lines` (snapshots, link to performed procedure, unique to prevent double billing), `payments`, `payment_allocations`, `refunds`, `credit_notes`; numbering via `counters`; idempotency keys; append-only ledger tables registered in `append_only_tables()`; checkout view on the patient; receipt.
2. **Daily & monthly reports** (§18, §19): daily procedures, invoice list, procedures grouped by invoice (invoice totals once), monthly service vs invoiced totals, payments by method; A4 print CSS; metric definitions from §18 table.
3. **Agenda** (§9): providers/chairs/schedules, appointments with the three independent state dimensions, server-side conflict check (exclusion constraint), day/week views.
4. **Booking links + staff approval inbox** (§9A).
5. **Consent flows + patient portal accounts** (§4A, §21).
6. Staff invitations, role editor, MFA (TOTP), session management UI.

## Known gaps / decisions to revisit

- Role names for custom roles are stored as entered; system roles are translated via `messages.*.roles`.
- `next dev` must be started with an explicit `--port` if 3000 is busy (see `.claude/launch.json`).
- Login rate limiting is per-account lockout only; add per-IP limiting before public exposure.
- Legal/regulatory items (invoice mentions, tax, retention, data hosting) are configurable placeholders pending local professional validation (§2, §25).
