import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { getAgendaSetup } from "@/features/agenda/server";
import { createInvoiceFromProcedures, recordPayment } from "@/features/billing/server";
import { getServicePickerData } from "@/features/catalog/server";
import { saveProviderFeeProfile } from "@/features/honoraria/server";
import { createInventoryItem, getInventory, receiveInventory } from "@/features/inventory/server";
import { getOperationalNotifications } from "@/features/notifications/server";
import { createPatient } from "@/features/patients/server";
import { getProcedureEntrySupport, recordPerformedProcedure } from "@/features/procedures/server";
import { createInstrumentSet, createSterilizer, getSterilizationDashboard, recordSterilizationCycle } from "@/features/sterilization/server";
import { addDays, todayInZone, zonedToUtc } from "@/lib/dates";
import { appointments, bookingRequests } from "@/server/db/schema";
import { withDbContext } from "@/server/db/tenant";
import { contextFor, makeClinic } from "../support/factories";

describe("global operational notifications", () => {
  it("shows real tenant-scoped counts and filters every source by permission", async () => {
    const ctx = await makeClinic("Cabinet Notifications A");
    const today = todayInZone(ctx.organization.timezone);

    const agenda = await getAgendaSetup(ctx);
    const createdPatient = await createPatient(ctx, {
      firstName: "Patient",
      lastName: "Notifications",
      firstNameAr: null,
      lastNameAr: null,
      sex: undefined,
      birthDate: null,
      birthDatePrecision: "exact",
      phone: null,
      phoneAlt: null,
      email: null,
      addressLine: null,
      city: null,
      region: null,
      preferredLocale: "fr",
      emergencyName: null,
      emergencyRelationship: null,
      emergencyPhone: null,
      referralSource: null,
      referredBy: null,
      administrativeNotes: null,
      assignedProviderId: null,
    }, { confirmNotDuplicate: true });
    if (createdPatient.status !== "created") throw new Error("patient fixture failed");
    await withDbContext({ organizationId: ctx.organizationId, userId: ctx.userId, actorType: "staff" }, async (tx) => {
      await tx.insert(bookingRequests).values({
        organizationId: ctx.organizationId,
        status: "submitted",
        refHash: randomUUID(),
        contactName: "Patient notification",
        contactPhone: "0550000000",
        preferredLocale: "fr",
        appointmentTypeId: agenda.types[0]!.id,
        providerId: agenda.providers[0]!.id,
        requestedStartsAt: new Date("2026-12-01T09:00:00Z"),
        requestedEndsAt: new Date("2026-12-01T09:30:00Z"),
        expiresAt: new Date("2026-12-02T09:00:00Z"),
      });
      await tx.insert(appointments).values([
        {
          organizationId: ctx.organizationId,
          branchId: agenda.branches[0]!.id,
          patientId: createdPatient.id,
          providerId: agenda.providers[0]!.id,
          appointmentTypeId: agenda.types[0]!.id,
          startsAt: zonedToUtc(today, "09:00", ctx.organization.timezone),
          endsAt: zonedToUtc(today, "09:30", ctx.organization.timezone),
          schedulingStatus: "booked",
          confirmationStatus: "confirmed",
          visitStatus: "waiting",
          createdByUserId: ctx.userId,
        },
        {
          organizationId: ctx.organizationId,
          branchId: agenda.branches[0]!.id,
          patientId: createdPatient.id,
          providerId: agenda.providers[0]!.id,
          appointmentTypeId: agenda.types[0]!.id,
          startsAt: zonedToUtc(addDays(today, 1), "10:00", ctx.organization.timezone),
          endsAt: zonedToUtc(addDays(today, 1), "10:30", ctx.organization.timezone),
          schedulingStatus: "booked",
          confirmationStatus: "pending",
          visitStatus: "not_arrived",
          createdByUserId: ctx.userId,
        },
      ]);
    });

    const catalog = await getServicePickerData(ctx);
    const service = catalog.categories.flatMap((category) => category.services).find((item) => item.code === "CONS-01")!;
    await recordPerformedProcedure(ctx, createdPatient.id, {
      serviceId: service.id,
      branchId: agenda.branches[0]!.id,
      performingProviderId: agenda.providers[0]!.id,
      serviceDate: today,
      quantity: 1,
      unitPriceMinor: service.priceMinor,
      priceOverrideReason: null,
      toothNumber: null,
      surfaces: [],
      arch: null,
      quadrant: null,
    });

    const inventory = await getInventory(ctx, today);
    const branchId = inventory.branches.find((branch) => branch.active)!.id;
    const itemId = await createInventoryItem(ctx, {
      sku: "ALERT-001",
      name: "Article surveillé",
      category: null,
      unit: "box",
      minimumStock: 5,
    });
    await receiveInventory(ctx, {
      itemId,
      branchId,
      lotNumber: "EXP-001",
      receivedOn: today,
      expiresOn: addDays(today, 30),
      quantity: 2,
      reference: null,
    });

    const sterilization = await getSterilizationDashboard(ctx);
    const sterilizationBranchId = sterilization.branches.find((branch) => branch.active)!.id;
    const sterilizerId = await createSterilizer(ctx, { branchId: sterilizationBranchId, name: "Autoclave notifications", serialNumber: null });
    const setId = await createInstrumentSet(ctx, { code: "NOTIF-01", name: "Set notifications", contents: null });
    await recordSterilizationCycle(ctx, {
      branchId: sterilizationBranchId,
      sterilizerId,
      reference: "NOTIF-CYCLE-1",
      program: "134 °C",
      startedDate: today,
      startedTime: "09:00",
      startedAt: new Date(),
      temperatureC: "134",
      pressureBar: "2.1",
      holdMinutes: "18",
      chemicalIndicator: "pass",
      airRemovalTest: "pass",
      biologicalIndicator: "not_used",
      notes: null,
      packs: [{ instrumentSetId: setId, label: null, expiresOn: addDays(today, 180), quantity: 1 }],
    });

    expect(await getOperationalNotifications(ctx)).toEqual([
      { kind: "bookingRequests", count: 1, href: "/agenda/requests", priority: "attention" },
      { kind: "receptionWaiting", count: 1, href: "/reception", priority: "attention" },
      { kind: "followUpsDue", count: 1, href: "/follow-ups?tab=reminders", priority: "attention" },
      { kind: "billingReady", count: 1, href: "/invoices", priority: "attention" },
      { kind: "sterilizationPending", count: 1, href: "/sterilization", priority: "attention" },
      { kind: "inventoryLow", count: 1, href: "/inventory", priority: "attention" },
      { kind: "inventoryExpiring", count: 1, href: "/inventory", priority: "attention" },
    ]);

    expect(await getOperationalNotifications(contextFor(ctx, "accountant"))).toEqual([
      { kind: "bookingRequests", count: 1, href: "/agenda/requests", priority: "attention" },
      { kind: "receptionWaiting", count: 1, href: "/reception", priority: "attention" },
    ]);
    expect(await getOperationalNotifications(contextFor(ctx, "tech_admin"))).toEqual([]);

    const other = await makeClinic("Cabinet Notifications B");
    expect(await getOperationalNotifications(other)).toEqual([]);
  });

  it("tracks billing work, overdue collections and practitioner fees as balances change", async () => {
    const ctx = await makeClinic("Cabinet Notifications Finance");
    const today = todayInZone(ctx.organization.timezone);
    const createdPatient = await createPatient(ctx, {
      firstName: "Finance",
      lastName: "Notifications",
      firstNameAr: null,
      lastNameAr: null,
      sex: undefined,
      birthDate: null,
      birthDatePrecision: "exact",
      phone: null,
      phoneAlt: null,
      email: null,
      addressLine: null,
      city: null,
      region: null,
      preferredLocale: "fr",
      emergencyName: null,
      emergencyRelationship: null,
      emergencyPhone: null,
      referralSource: null,
      referredBy: null,
      administrativeNotes: null,
      assignedProviderId: null,
    }, { confirmNotDuplicate: true });
    if (createdPatient.status !== "created") throw new Error("patient fixture failed");

    const [catalog, support] = await Promise.all([getServicePickerData(ctx), getProcedureEntrySupport(ctx)]);
    const service = catalog.categories.flatMap((category) => category.services).find((item) => item.code === "CONS-01")!;
    const providerId = support.providers[0]!.id;
    await saveProviderFeeProfile(ctx, { providerId, specialty: null, defaultFeeRateBp: 5000 });
    const perform = async () => (await recordPerformedProcedure(ctx, createdPatient.id, {
      serviceId: service.id,
      branchId: support.branches[0]!.id,
      performingProviderId: providerId,
      serviceDate: today,
      quantity: 1,
      unitPriceMinor: service.priceMinor,
      priceOverrideReason: null,
      toothNumber: null,
      surfaces: [],
      arch: null,
      quadrant: null,
    })).id;

    const invoicedProcedure = await perform();
    await perform();
    const invoiceId = await createInvoiceFromProcedures(ctx, createdPatient.id, {
      procedureIds: [invoicedProcedure],
      issueNow: true,
      dueDate: today,
    });
    expect(await getOperationalNotifications(ctx)).toEqual([
      { kind: "billingReady", count: 1, href: "/invoices", priority: "attention" },
      { kind: "invoicePaymentsDue", count: 1, href: "/invoices?state=open", priority: "urgent" },
    ]);

    await recordPayment(ctx, {
      patientId: createdPatient.id,
      amountMinor: service.priceMinor,
      method: "card",
      receivedOn: today,
      idempotencyKey: randomUUID(),
      allocateTo: invoiceId,
    });
    expect(await getOperationalNotifications(ctx)).toEqual([
      { kind: "billingReady", count: 1, href: "/invoices", priority: "attention" },
      { kind: "honorariaPayable", count: 1, href: "/honoraires", priority: "attention" },
    ]);
  });
});
