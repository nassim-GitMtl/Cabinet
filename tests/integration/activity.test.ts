import { and, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { listActivity, listActivityPeople, listRecordChanges } from "@/features/activity/server";
import { createPatient, getPatient, updatePatient } from "@/features/patients/server";
import { todayInZone } from "@/lib/dates";
import { ForbiddenError } from "@/server/auth/context";
import { db } from "@/server/db/client";
import { auditEvents, patients, recordChanges } from "@/server/db/schema";
import { withDbContext } from "@/server/db/tenant";
import { contextFor, expectDbError, makeClinic } from "../support/factories";

const input = {
  firstName: "Lina",
  lastName: "Journal",
  firstNameAr: null,
  lastNameAr: null,
  sex: undefined,
  birthDate: null,
  birthDatePrecision: "exact" as const,
  phone: null,
  phoneAlt: null,
  email: null,
  addressLine: null,
  city: null,
  region: null,
  preferredLocale: "fr" as const,
  emergencyName: null,
  emergencyRelationship: null,
  emergencyPhone: null,
  referralSource: null,
  referredBy: null,
  administrativeNotes: null,
  assignedProviderId: null,
};

async function clinicWithPatient(name: string) {
  const ctx = await makeClinic(name);
  const created = await createPatient(ctx, input, { confirmNotDuplicate: true });
  if (created.status !== "created") throw new Error("fixture");
  const asStaff = <T,>(fn: Parameters<typeof withDbContext<T>>[1]) =>
    withDbContext({ organizationId: ctx.organizationId, userId: ctx.userId, actorType: "staff" }, fn);
  return { ctx, patientId: created.id, asStaff, today: todayInZone(ctx.organization.timezone) };
}

describe("activity log", () => {
  it("records every change with its author and the changed fields, never their values", async () => {
    const f = await clinicWithPatient("Journal Auteur");
    const detail = await getPatient(f.ctx, f.patientId);
    await updatePatient(f.ctx, f.patientId, { ...input, city: "Oran" }, detail!.patient.version);

    const changes = await f.asStaff((tx) =>
      tx.select().from(recordChanges).where(and(eq(recordChanges.tableName, "patients"), eq(recordChanges.rowId, f.patientId))).orderBy(recordChanges.occurredAt));
    expect(changes.map((c) => c.operation)).toEqual(["insert", "update"]);
    expect(changes.every((c) => c.actorUserId === f.ctx.userId && c.actorType === "staff")).toBe(true);
    expect(changes[1]!.changedColumns).toEqual(["city"]);
    expect(JSON.stringify(changes)).not.toContain("Oran");
    const [edit] = await f.asStaff((tx) => tx.select().from(auditEvents).where(and(eq(auditEvents.action, "patient.updated"), eq(auditEvents.entityId, f.patientId))));
    expect(edit!.metadata).toEqual({ fields: ["city"] });

    // Autosave: the same person saving the same field again within 10 minutes stays one line...
    await f.asStaff((tx) => tx.update(patients).set({ city: "Alger" }).where(eq(patients.id, f.patientId)));
    // ...a different field or a different person is a new line.
    await f.asStaff((tx) => tx.update(patients).set({ region: "Alger" }).where(eq(patients.id, f.patientId)));
    const otherUser = (await makeClinic("Journal Autre")).userId;
    await withDbContext({ organizationId: f.ctx.organizationId, userId: otherUser, actorType: "staff" }, (tx) =>
      tx.update(patients).set({ city: "Blida" }).where(eq(patients.id, f.patientId)));
    const updates = await f.asStaff((tx) =>
      tx.select().from(recordChanges).where(and(eq(recordChanges.rowId, f.patientId), eq(recordChanges.operation, "update"))));
    expect(updates).toHaveLength(3);

    // A write by an online patient or the system is attributed as such.
    await withDbContext({ organizationId: f.ctx.organizationId, actorType: "system" }, (tx) =>
      tx.update(patients).set({ addressLine: "x" }).where(eq(patients.id, f.patientId)));
    const [system] = await f.asStaff((tx) =>
      tx.select().from(recordChanges).where(and(eq(recordChanges.rowId, f.patientId), sql`'address_line' = any(${recordChanges.changedColumns})`)));
    expect(system).toMatchObject({ actorType: "system", actorUserId: null });

    // The log itself cannot be rewritten.
    await expectDbError(f.asStaff((tx) => tx.update(recordChanges).set({ actorUserId: null }).where(eq(recordChanges.rowId, f.patientId))), /permission denied/);
    await expectDbError(f.asStaff((tx) => tx.delete(recordChanges).where(eq(recordChanges.rowId, f.patientId))), /permission denied/);
  });

  it("covers every clinic table, including the ones added later", async () => {
    const rows = await db.execute<{ table_name: string }>(sql`
      select c.relname as table_name
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r'
         and (c.relname = 'organizations' or exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'organization_id' and not a.attisdropped))
         and not (c.relname = any (app_private.change_log_excluded_tables()))
         and not exists (select 1 from pg_trigger t where t.tgrelid = c.oid and t.tgname = 'record_change')`);
    expect(rows.map((r) => r.table_name)).toEqual([]);
  });

  it("lists readable actions with names, filters and pages without gaps", async () => {
    const f = await clinicWithPatient("Journal Lecture");
    // Several entries in one transaction share the same instant: paging must not skip any.
    await f.asStaff(async (tx) => {
      for (let i = 0; i < 5; i += 1) {
        await tx.insert(auditEvents).values({ organizationId: f.ctx.organizationId, actorType: "staff", actorUserId: f.ctx.userId, action: "patient.updated", entityType: "patient", entityId: f.patientId, patientId: f.patientId, metadata: { fields: ["city"] } });
      }
      await tx.insert(auditEvents).values({ organizationId: f.ctx.organizationId, actorType: "staff", actorUserId: f.ctx.userId, action: "patient.viewed", entityType: "patient", entityId: f.patientId, patientId: f.patientId });
    });
    const range = { from: f.today, to: f.today };
    const seen: string[] = [];
    let before: string | null = null;
    for (let i = 0; i < 10; i += 1) {
      const page = await listActivity(f.ctx, { ...range, before }, 2);
      seen.push(...page.rows.map((r) => r.id));
      if (!page.next) break;
      before = page.next;
    }
    const all = await listActivity(f.ctx, range);
    expect(new Set(seen).size).toBe(all.rows.length);
    expect(all.rows.some((r) => r.action === "patient.viewed")).toBe(false);
    expect((await listActivity(f.ctx, { ...range, includeViews: true })).rows.some((r) => r.action === "patient.viewed")).toBe(true);

    const created = all.rows.find((r) => r.action === "patient.created")!;
    expect(created).toMatchObject({ actorType: "staff", actorName: "Dr Test", patientName: "Journal Lina" });
    expect((await listActivity(f.ctx, { ...range, category: "billing" })).rows).toEqual([]);
    expect((await listActivity(f.ctx, { ...range, patientId: f.patientId })).rows.length).toBeGreaterThan(5);
    expect((await listActivity(f.ctx, { ...range, actorUserId: crypto.randomUUID() })).rows).toEqual([]);
    expect((await listRecordChanges(f.ctx, { ...range, actorUserId: f.ctx.userId })).rows.some((r) => r.tableName === "patients")).toBe(true);
    expect((await listActivityPeople(f.ctx)).map((p) => p.userId)).toContain(f.ctx.userId);
  });

  it("is reserved to audit.read and never shows another clinic", async () => {
    const a = await clinicWithPatient("Journal Isolation A");
    const b = await clinicWithPatient("Journal Isolation B");
    const reception = contextFor({ userId: a.ctx.userId, organizationId: a.ctx.organizationId }, "receptionist");
    await expect(listActivity(reception, { from: a.today, to: a.today })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listRecordChanges(reception, { from: a.today, to: a.today })).rejects.toBeInstanceOf(ForbiddenError);
    const seenByB = await listActivity(b.ctx, { from: a.today, to: a.today, patientId: a.patientId });
    expect(seenByB.rows).toEqual([]);
    const changesB = await listRecordChanges(b.ctx, { from: a.today, to: a.today });
    expect(changesB.rows.some((r) => r.rowId === a.patientId)).toBe(false);

    // Practitioner earnings stay out of the log for anyone but the owner (tech admin reads the log, not the fees).
    await a.asStaff((tx) => tx.insert(auditEvents).values({ organizationId: a.ctx.organizationId, actorType: "staff", actorUserId: a.ctx.userId, action: "honorarium.payment.recorded", metadata: { amountMinor: 5000 } }));
    const techAdmin = contextFor({ userId: a.ctx.userId, organizationId: a.ctx.organizationId }, "tech_admin");
    expect((await listActivity(techAdmin, { from: a.today, to: a.today })).rows.some((r) => r.action.startsWith("honorarium."))).toBe(false);
    expect((await listActivity(a.ctx, { from: a.today, to: a.today })).rows.some((r) => r.action.startsWith("honorarium."))).toBe(true);
  });
});
