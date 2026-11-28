import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createAppointment, getAgendaSetup, listAppointments } from "@/features/agenda/server";
import { createChair } from "@/features/agenda/settings";
import { recordPayment } from "@/features/billing/server";
import { closeCashSession, getCashDay, openCashSession } from "@/features/cash/server";
import { getServicePickerData } from "@/features/catalog/server";
import { createPatient } from "@/features/patients/server";
import { getProcedureEntrySupport, recordPerformedProcedure } from "@/features/procedures/server";
import { getReport } from "@/features/reports/server";
import { createSite, listSites, setSiteActive } from "@/features/sites/server";
import { addDays, todayInZone } from "@/lib/dates";
import { ForbiddenError, type ClinicContext } from "@/server/auth/context";
import { appointments, expenses, legalEntities, payments } from "@/server/db/schema";
import { withDbContext } from "@/server/db/tenant";
import { contextFor, expectDbError, makeClinic } from "../support/factories";

const patientInput = {
  firstName: "Multi", lastName: "Site", firstNameAr: null, lastNameAr: null, sex: undefined, birthDate: null,
  birthDatePrecision: "exact" as const, phone: null, phoneAlt: null, email: null, addressLine: null, city: null, region: null,
  preferredLocale: "fr" as const, emergencyName: null, emergencyRelationship: null, emergencyPhone: null,
  referralSource: null, referredBy: null, administrativeNotes: null, assignedProviderId: null,
};

/** A clinic with its first site (A) plus a second one (B), and a context for each site. */
async function setup(name: string) {
  const owner = await makeClinic(name);
  const support = await getProcedureEntrySupport(owner);
  const siteA = support.branches[0]!.id;
  const siteB = await createSite(owner, { name: "Site Bab Ezzouar", address: "Cité 1", phone: "0550 11 22 33", email: null });
  const sites = [{ id: siteA, name: "A" }, { id: siteB, name: "Site Bab Ezzouar" }];
  const at = (siteId: string): ClinicContext => ({ ...owner, siteId, sites });
  const p = await createPatient(owner, patientInput, { confirmNotDuplicate: true });
  if (p.status !== "created") throw new Error("fixture");
  return { owner, at, siteA, siteB, patientId: p.id, provider: support.providers[0]!.id, today: todayInZone(owner.organization.timezone) };
}

describe("multi-site clinics", () => {
  it("keeps each site's agenda, chairs and working place apart", async () => {
    const f = await setup("Sites Agenda");
    expect((await listSites(f.owner)).map((s) => [s.name, s.isMain])).toEqual([[expect.any(String), true], ["Site Bab Ezzouar", false]]);
    await expect(createSite(f.owner, { name: "site bab ezzouar", address: null, phone: null, email: null })).rejects.toMatchObject({ code: "nameTaken" });
    await expect(createSite(f.owner, { name: "Autre", address: null, phone: "12", email: null })).rejects.toMatchObject({ code: "invalidPhone" });

    await createChair(f.at(f.siteB), "Fauteuil B1");
    expect((await getAgendaSetup(f.at(f.siteB))).chairs.map((c) => c.name)).toContain("Fauteuil B1");
    expect((await getAgendaSetup(f.at(f.siteA))).chairs.map((c) => c.name)).not.toContain("Fauteuil B1");

    const tomorrow = addDays(f.today, 1);
    const id = await createAppointment(f.at(f.siteB), { patientId: f.patientId, providerId: f.provider, chairId: null, appointmentTypeId: null, date: tomorrow, time: "10:00", durationMin: 30, notes: null, outsideHoursOverride: true });
    const [row] = await withDbContext({ organizationId: f.owner.organizationId, actorType: "system" }, (tx) => tx.select().from(appointments).where(eq(appointments.id, id)));
    expect(row!.branchId).toBe(f.siteB);
    const from = new Date(Date.now() - 86_400_000);
    const to = new Date(Date.now() + 3 * 86_400_000);
    expect((await listAppointments(f.at(f.siteB), from, to)).map((a) => a.id)).toContain(id);
    expect((await listAppointments(f.at(f.siteA), from, to)).map((a) => a.id)).not.toContain(id);

    // A site with appointments to come, or the last open site, cannot be closed.
    await expect(setSiteActive(f.owner, f.siteB, false)).rejects.toMatchObject({ code: "siteHasAppointments" });
    await setSiteActive(f.owner, f.siteA, false);
    await expect(setSiteActive(f.owner, f.siteB, false)).rejects.toMatchObject({ code: "lastSite" });
    await setSiteActive(f.owner, f.siteA, true);

    // A closed or foreign site falls back to the main site; never another clinic's site.
    const other = await makeClinic("Sites Ailleurs");
    const foreignSite = (await getProcedureEntrySupport(other)).branches[0]!.id;
    const fallback = await createAppointment({ ...f.owner, siteId: foreignSite }, { patientId: f.patientId, providerId: f.provider, chairId: null, appointmentTypeId: null, date: addDays(f.today, 2), time: "11:00", durationMin: 30, notes: null, outsideHoursOverride: true });
    const [fb] = await withDbContext({ organizationId: f.owner.organizationId, actorType: "system" }, (tx) => tx.select().from(appointments).where(eq(appointments.id, fallback)));
    expect(fb!.branchId).toBe(f.siteA);
  });

  it("gives each site its own cash drawer, old records counting for the main site", async () => {
    const f = await setup("Sites Caisse");
    await openCashSession(f.at(f.siteA), f.today, 100_000);
    const sessionB = await openCashSession(f.at(f.siteB), f.today, 50_000);
    const pay = (ctx: ClinicContext, amountMinor: number) =>
      recordPayment(ctx, { patientId: f.patientId, amountMinor, method: "cash", receivedOn: f.today, idempotencyKey: randomUUID(), allocateTo: null });
    await pay(f.at(f.siteA), 20_000);
    await pay(f.at(f.siteB), 7_000);
    // An expense recorded before sites existed (no site) belongs to the main site's drawer.
    await withDbContext({ organizationId: f.owner.organizationId, userId: f.owner.userId, actorType: "staff" }, async (tx) => {
      const [le] = await tx.select({ id: legalEntities.id }).from(legalEntities).limit(1);
      await tx.insert(expenses).values({ organizationId: f.owner.organizationId, legalEntityId: le!.id, category: "supplies", description: "Ancienne dépense", expenseDate: f.today, amountMinor: 3_000, currency: "DZD", status: "paid", paidOn: f.today, paymentMethod: "cash", createdByUserId: f.owner.userId });
    });
    const dayA = await getCashDay(f.at(f.siteA), f.today);
    const dayB = await getCashDay(f.at(f.siteB), f.today);
    expect(dayA.liveExpectedMinor).toBe(100_000 + 20_000 - 3_000);
    expect(dayB.liveExpectedMinor).toBe(50_000 + 7_000);
    expect(dayA.session!.id).not.toBe(dayB.session!.id);

    // Closing site B's day does not close site A's.
    await closeCashSession(f.at(f.siteB), sessionB, 57_000, null, null);
    await expect(pay(f.at(f.siteB), 1_000)).rejects.toMatchObject({ code: "cashSessionClosed" });
    await pay(f.at(f.siteA), 1_000);

    // The report splits production and collections by site.
    const svc = (await getServicePickerData(f.owner)).categories.flatMap((c) => c.services)[0]!;
    await recordPerformedProcedure(f.at(f.siteB), f.patientId, { serviceId: svc.id, branchId: f.siteB, performingProviderId: f.provider, serviceDate: f.today, quantity: 1, unitPriceMinor: svc.priceMinor, priceOverrideReason: null, toothNumber: null, surfaces: [], arch: null, quadrant: null });
    const report = await getReport(f.at(f.siteA), { from: f.today, to: f.today });
    const b = report.bySite.find((s) => s.siteId === f.siteB)!;
    const a = report.bySite.find((s) => s.siteId === f.siteA)!;
    expect(b).toMatchObject({ productionMinor: svc.priceMinor, collectedMinor: 7_000 });
    expect(a).toMatchObject({ productionMinor: 0, collectedMinor: 21_000 });
  });

  it("needs the multi-site module to add sites, and a site must be the clinic's own", async () => {
    const f = await setup("Sites Droits");
    const admin = contextFor({ userId: f.owner.userId, organizationId: f.owner.organizationId }, "tech_admin");
    await expect(createSite(admin, { name: "Interdit", address: null, phone: null, email: null })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(setSiteActive(admin, f.siteB, false)).rejects.toBeInstanceOf(ForbiddenError);
    const reception = contextFor({ userId: f.owner.userId, organizationId: f.owner.organizationId }, "receptionist");
    await expect(listSites(reception)).rejects.toBeInstanceOf(ForbiddenError);

    const other = await makeClinic("Sites Etranger");
    const foreignSite = (await getProcedureEntrySupport(other)).branches[0]!.id;
    await expectDbError(withDbContext({ organizationId: f.owner.organizationId, userId: f.owner.userId, actorType: "staff" }, async (tx) => {
      const [le] = await tx.select({ id: legalEntities.id }).from(legalEntities).limit(1);
      await tx.insert(payments).values({ organizationId: f.owner.organizationId, branchId: foreignSite, legalEntityId: le!.id, patientId: f.patientId, purpose: "advance_deposit", method: "cash", amountMinor: 1, currency: "DZD", receivedOn: f.today, receiptNumber: "X-1", idempotencyKey: randomUUID(), createdByUserId: f.owner.userId });
    }), /same clinic/);
    expect((await listSites(other)).map((s) => s.id)).not.toContain(f.siteB);
  });
});
