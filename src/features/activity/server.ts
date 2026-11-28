import "server-only";
import { and, desc, eq, gte, inArray, like, lt, not, or, sql, type SQL } from "drizzle-orm";
import { can, requirePermission, tenantTx, type ClinicContext } from "@/server/auth/context";
import { auditEvents, invoices, memberships, patients, recordChanges } from "@/server/db/schema";
import { addDays, parseDateOnly, zonedToUtc } from "@/lib/dates";

/**
 * Activity log: who did what, when. Reads the audit trail (one readable line per action, written by each service
 * with the person's id) and the change log (every row inserted/updated/deleted, written by the database trigger
 * `record_change`, so nothing escapes). Both are append-only and tenant-isolated; this module only reads them.
 */

/** Action-code prefixes per area of the app (filter). */
export const ACTIVITY_CATEGORIES = {
  patients: ["patient.", "patient_import.", "patient_portal.", "patient_journey.", "shared_profile.", "reminders."],
  agenda: ["appointment.", "appointment_type.", "booking_link.", "booking_request.", "chair.", "time_off.", "working_hours."],
  clinical: ["clinical_note.", "clinical_file.", "odontogram.", "performed_procedure.", "treatment_plan.", "health_history.", "questionnaire."],
  billing: ["invoice.", "payment.", "payment_schedule.", "credit_note.", "cash.", "expense.", "honorarium.", "report."],
  stock: ["inventory.", "sterilization."],
  settings: ["org.", "organization.", "role.", "staff.", "catalog.", "sync.", "platform.", "site."],
  security: ["auth."],
} as const;
export type ActivityCategory = keyof typeof ACTIVITY_CATEGORIES;
export const isActivityCategory = (v: string): v is ActivityCategory => v in ACTIVITY_CATEGORIES;

/** Reading a record is logged too (privacy); hidden unless asked for. */
const VIEW_ACTIONS = ["%.viewed"];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ActivityFilters = {
  from: string;
  to: string;
  actorUserId?: string | null;
  category?: ActivityCategory | null;
  patientId?: string | null;
  includeViews?: boolean;
  /** Paging: only entries strictly older than this instant (ISO). */
  before?: string | null;
};

function period(ctx: ClinicContext, f: { from: string; to: string }) {
  const from = parseDateOnly(f.from);
  const to = parseDateOnly(f.to);
  if (!from || !to) throw new Error("invalid period");
  const [a, b] = from <= to ? [from, to] : [to, from];
  return { from: a, to: b, start: zonedToUtc(a, "00:00", ctx.organization.timezone), end: zonedToUtc(addDays(b, 1), "00:00", ctx.organization.timezone) };
}

/**
 * Paging cursor = id of the last entry shown. Entries of one transaction share their instant (microseconds, more
 * precise than a JavaScript date), so the next page compares (instant, id) with that entry's exact values in SQL.
 */
const cursor = (before: string | null | undefined) => (before && UUID.test(before) ? before : null);
const cursorOf = (row: { id: string }) => row.id;

/** "Dr" + "Samira Haddad", without doubling a title already typed in the name. */
export const withTitle = (title: string | null, name: string) =>
  title && !name.toLowerCase().startsWith(title.toLowerCase()) ? `${title} ${name}` : name;

/** Names of the staff who acted, as known in this clinic (title + display name). */
async function staffNames(tx: Parameters<Parameters<typeof tenantTx>[1]>[0], userIds: string[]) {
  const ids = [...new Set(userIds.filter((id) => UUID.test(id)))];
  if (!ids.length) return new Map<string, string>();
  const rows = await tx
    .select({ userId: memberships.userId, displayName: memberships.displayName, title: memberships.title })
    .from(memberships)
    .where(inArray(memberships.userId, ids));
  return new Map(rows.map((r) => [r.userId, withTitle(r.title, r.displayName)]));
}

export async function listActivity(ctx: ClinicContext, f: ActivityFilters, limit = 150) {
  requirePermission(ctx, "audit.read");
  const p = period(ctx, f);
  return tenantTx(ctx, async (tx) => {
    const where: (SQL | undefined)[] = [gte(auditEvents.occurredAt, p.start), lt(auditEvents.occurredAt, p.end)];
    const after = cursor(f.before);
    if (after) where.push(sql`(${auditEvents.occurredAt}, ${auditEvents.id}) < (select c.occurred_at, c.id from audit_events c where c.id = ${after}::uuid)`);
    if (f.actorUserId && UUID.test(f.actorUserId)) where.push(eq(auditEvents.actorUserId, f.actorUserId));
    if (f.patientId && UUID.test(f.patientId)) where.push(eq(auditEvents.patientId, f.patientId));
    if (f.category) where.push(or(...ACTIVITY_CATEGORIES[f.category].map((prefix) => like(auditEvents.action, `${prefix}%`))));
    if (!f.includeViews) for (const pattern of VIEW_ACTIONS) where.push(not(like(auditEvents.action, pattern)));
    // What a practitioner earns is for the owner and that practitioner only (fees screen), not for the log readers.
    if (!can(ctx, "honorarium.read.all")) where.push(not(like(auditEvents.action, "honorarium.%")));
    const rows = await tx
      .select()
      .from(auditEvents)
      .where(and(...where))
      .orderBy(desc(auditEvents.occurredAt), desc(auditEvents.id))
      .limit(limit + 1);
    const page = rows.slice(0, limit);

    const names = await staffNames(tx, page.map((r) => r.actorUserId ?? ""));
    const patientIds = [...new Set(page.map((r) => r.patientId).filter((id): id is string => Boolean(id)))];
    const invoiceIds = [...new Set(page.filter((r) => r.entityType === "invoice" && r.entityId && UUID.test(r.entityId)).map((r) => r.entityId!))];
    const [people, bills] = await Promise.all([
      patientIds.length
        ? tx.select({ id: patients.id, firstName: patients.firstName, lastName: patients.lastName, number: patients.patientNumber }).from(patients).where(inArray(patients.id, patientIds))
        : Promise.resolve([]),
      invoiceIds.length ? tx.select({ id: invoices.id, number: invoices.number }).from(invoices).where(inArray(invoices.id, invoiceIds)) : Promise.resolve([]),
    ]);
    return {
      from: p.from,
      to: p.to,
      hasMore: rows.length > limit,
      next: rows.length > limit ? cursorOf(page.at(-1)!) : null,
      rows: page.map((r) => {
        const patient = r.patientId ? people.find((x) => x.id === r.patientId) : undefined;
        const invoice = r.entityType === "invoice" ? bills.find((x) => x.id === r.entityId) : undefined;
        return {
          id: r.id,
          occurredAt: r.occurredAt,
          actorType: r.actorType,
          actorUserId: r.actorUserId,
          actorName: r.actorUserId ? names.get(r.actorUserId) ?? null : null,
          action: r.action,
          entityType: r.entityType,
          entityId: r.entityId,
          patientId: r.patientId,
          patientName: patient ? `${patient.lastName} ${patient.firstName}` : null,
          patientNumber: patient?.number ?? null,
          invoiceId: invoice?.id ?? null,
          invoiceNumber: invoice?.number ?? null,
          metadata: r.metadata,
        };
      }),
    };
  });
}

export async function listRecordChanges(
  ctx: ClinicContext,
  f: { from: string; to: string; actorUserId?: string | null; before?: string | null },
  limit = 150,
) {
  requirePermission(ctx, "audit.read");
  const p = period(ctx, f);
  return tenantTx(ctx, async (tx) => {
    const where: (SQL | undefined)[] = [gte(recordChanges.occurredAt, p.start), lt(recordChanges.occurredAt, p.end)];
    const after = cursor(f.before);
    if (after) where.push(sql`(${recordChanges.occurredAt}, ${recordChanges.id}) < (select c.occurred_at, c.id from record_changes c where c.id = ${after}::uuid)`);
    if (f.actorUserId && UUID.test(f.actorUserId)) where.push(eq(recordChanges.actorUserId, f.actorUserId));
    if (!can(ctx, "honorarium.read.all")) where.push(and(not(like(recordChanges.tableName, "honorarium%")), not(like(recordChanges.tableName, "provider_service_term%"))));
    const rows = await tx
      .select()
      .from(recordChanges)
      .where(and(...where))
      .orderBy(desc(recordChanges.occurredAt), desc(recordChanges.id))
      .limit(limit + 1);
    const page = rows.slice(0, limit);
    const names = await staffNames(tx, page.map((r) => r.actorUserId ?? ""));
    return {
      from: p.from,
      to: p.to,
      hasMore: rows.length > limit,
      next: rows.length > limit ? cursorOf(page.at(-1)!) : null,
      rows: page.map((r) => ({ ...r, actorName: r.actorUserId ? names.get(r.actorUserId) ?? null : null })),
    };
  });
}

/** Everyone who works or worked in this clinic (filter by person). */
export async function listActivityPeople(ctx: ClinicContext) {
  requirePermission(ctx, "audit.read");
  return tenantTx(ctx, (tx) =>
    tx
      .select({ userId: memberships.userId, displayName: memberships.displayName, title: memberships.title, status: memberships.status })
      .from(memberships)
      .orderBy(memberships.displayName),
  );
}
