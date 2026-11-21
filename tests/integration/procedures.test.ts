import { asc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getServicePickerData, setServiceFavorite, updateService } from "@/features/catalog/server";
import { getDashboardStats } from "@/features/dashboard/server";
import { createPatient } from "@/features/patients/server";
import {
  changePerformedProcedureStatus,
  getProcedureEntrySupport,
  listPerformedProcedures,
  ProcedureReferenceError,
  ProcedureValidationError,
  recordPerformedProcedure,
} from "@/features/procedures/server";
import { todayInZone } from "@/lib/dates";
import { ForbiddenError } from "@/server/auth/context";
import {
  auditEvents,
  encounters,
  performedProcedures,
} from "@/server/db/schema";
import { withDbContext } from "@/server/db/tenant";
import { ConflictError } from "@/server/errors";
import { contextFor, expectDbError, makeClinic } from "../support/factories";

const patientInput = {
  firstName: "Leïla",
  lastName: "Test",
  firstNameAr: null,
  lastNameAr: null,
  sex: undefined,
  birthDate: "1992-05-10",
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

async function setup(name: string) {
  const ctx = await makeClinic(name);
  const patient = await createPatient(ctx, patientInput, { confirmNotDuplicate: true });
  if (patient.status !== "created") throw new Error("patient fixture failed");
  const [picker, support] = await Promise.all([
    getServicePickerData(ctx),
    getProcedureEntrySupport(ctx),
  ]);
  const service = picker.categories.flatMap((category) => category.services).find((item) => item.code === "CONS-01")!;
  const provider = support.providers[0]!;
  const branch = support.branches[0]!;
  const input = {
    serviceId: service.id,
    branchId: branch.id,
    performingProviderId: provider.id,
    serviceDate: todayInZone(ctx.organization.timezone),
    quantity: 1,
    unitPriceMinor: service.priceMinor,
    priceOverrideReason: null,
    toothNumber: null,
    surfaces: [],
    arch: null,
    quadrant: null,
  };
  return { ctx, patientId: patient.id, picker, support, service, input };
}

describe("visits and completed procedures", () => {
  it("creates a completed encounter and keeps the catalog snapshot unchanged", async () => {
    const fixture = await setup("Cabinet Actes A");
    const created = await recordPerformedProcedure(fixture.ctx, fixture.patientId, fixture.input);

    await updateService(
      fixture.ctx,
      fixture.service.id,
      {
        categoryId: fixture.service.categoryId,
        code: fixture.service.code,
        nameFr: "Consultation modifiée",
        nameEn: "Changed consultation",
        pricingUnit: "procedure",
        anatomy: "none",
        defaultDurationMin: fixture.service.defaultDurationMin,
        priceMinor: fixture.service.priceMinor + 50000,
        priceChangeReason: "Test snapshot",
      },
      fixture.service.version,
    );

    const procedures = await listPerformedProcedures(fixture.ctx, fixture.patientId);
    expect(procedures).toHaveLength(1);
    expect(procedures[0]).toMatchObject({
      id: created.id,
      encounterId: created.encounterId,
      unitPriceMinor: fixture.service.priceMinor,
      status: "completed",
    });
    expect(procedures[0]!.serviceSnapshot.name.fr).toBe(fixture.service.name.fr);

    const dashboard = await getDashboardStats(fixture.ctx);
    expect(dashboard.clinicalStats).toEqual({ visits: 1, procedures: 1, patients: 1 });
    expect(dashboard.recentProcedures?.[0]).toMatchObject({
      id: created.id,
      patientId: fixture.patientId,
      patientFirstName: patientInput.firstName,
      status: "completed",
    });
    expect(dashboard.recentPatients?.[0]).toMatchObject({ id: fixture.patientId });

    const rows = await withDbContext(
      { organizationId: fixture.ctx.organizationId, userId: fixture.ctx.userId, actorType: "staff" },
      (tx) => tx.select().from(encounters).where(eq(encounters.id, created.encounterId)),
    );
    expect(rows[0]).toMatchObject({ patientId: fixture.patientId, status: "completed" });
  });

  it("enforces anatomy requirements from the selected catalog service", async () => {
    const fixture = await setup("Cabinet Actes B");
    const surfaceService = fixture.picker.categories
      .flatMap((category) => category.services)
      .find((service) => service.anatomy === "surface")!;
    const missing = { ...fixture.input, serviceId: surfaceService.id, unitPriceMinor: surfaceService.priceMinor };
    await expect(recordPerformedProcedure(fixture.ctx, fixture.patientId, missing)).rejects.toMatchObject({
      fieldErrors: { toothNumber: "required", surfaces: "required" },
    });

    await recordPerformedProcedure(fixture.ctx, fixture.patientId, {
      ...missing,
      toothNumber: "26",
      surfaces: ["mesial", "occlusal"],
    });
    const [row] = await listPerformedProcedures(fixture.ctx, fixture.patientId);
    expect(row).toMatchObject({ toothNumber: "26", surfaces: ["mesial", "occlusal"] });
  });

  it("requires price.override plus a reason and records the approver", async () => {
    const fixture = await setup("Cabinet Actes C");
    const changedPrice = fixture.service.priceMinor + 10000;
    await expect(
      recordPerformedProcedure(fixture.ctx, fixture.patientId, {
        ...fixture.input,
        unitPriceMinor: changedPrice,
      }),
    ).rejects.toBeInstanceOf(ProcedureValidationError);

    const assistant = contextFor(fixture.ctx, "assistant");
    await expect(
      recordPerformedProcedure(assistant, fixture.patientId, {
        ...fixture.input,
        unitPriceMinor: changedPrice,
        priceOverrideReason: "Remise clinique autorisée",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const created = await recordPerformedProcedure(fixture.ctx, fixture.patientId, {
      ...fixture.input,
      unitPriceMinor: changedPrice,
      priceOverrideReason: "Remise clinique autorisée",
    });
    const [row] = await withDbContext(
      { organizationId: fixture.ctx.organizationId, userId: fixture.ctx.userId, actorType: "staff" },
      (tx) => tx.select().from(performedProcedures).where(eq(performedProcedures.id, created.id)),
    );
    expect(row).toMatchObject({
      unitPriceMinor: changedPrice,
      priceOverrideReason: "Remise clinique autorisée",
      priceOverrideApprovedByUserId: fixture.ctx.userId,
    });
  });

  it("records reversals as audited status transitions and prevents a second correction", async () => {
    const fixture = await setup("Cabinet Actes D");
    const created = await recordPerformedProcedure(fixture.ctx, fixture.patientId, fixture.input);
    await changePerformedProcedureStatus(fixture.ctx, created.id, {
      status: "reversed",
      reason: "Acte annulé avant facturation",
    });
    expect((await listPerformedProcedures(fixture.ctx, fixture.patientId))[0]).toMatchObject({
      status: "reversed",
      statusReason: "Acte annulé avant facturation",
    });
    await expect(
      changePerformedProcedureStatus(fixture.ctx, created.id, {
        status: "entered_in_error",
        reason: "Deuxième correction",
      }),
    ).rejects.toBeInstanceOf(ConflictError);

    const events = await withDbContext(
      { organizationId: fixture.ctx.organizationId, userId: fixture.ctx.userId, actorType: "staff" },
      (tx) => tx.select().from(auditEvents).where(eq(auditEvents.entityId, created.id)).orderBy(asc(auditEvents.occurredAt), asc(auditEvents.id)),
    );
    expect(events.map((event) => event.action)).toEqual([
      "performed_procedure.created",
      "performed_procedure.reversed",
    ]);
    expect(events[1]!.metadata).not.toHaveProperty("reason");
  });

  it("persists favorites and derives recent services for the reusable picker", async () => {
    const fixture = await setup("Cabinet Actes E");
    await setServiceFavorite(fixture.ctx, fixture.service.id, true);
    await recordPerformedProcedure(fixture.ctx, fixture.patientId, fixture.input);
    const data = await getServicePickerData(fixture.ctx);
    expect(data.favoriteIds).toContain(fixture.service.id);
    expect(data.recentIds[0]).toBe(fixture.service.id);
    await setServiceFavorite(fixture.ctx, fixture.service.id, false);
    expect((await getServicePickerData(fixture.ctx)).favoriteIds).not.toContain(fixture.service.id);
  });

  it("keeps encounters and procedures isolated across clinics at the database boundary", async () => {
    const a = await setup("Cabinet Actes F");
    const b = await setup("Cabinet Actes G");
    const created = await recordPerformedProcedure(a.ctx, a.patientId, a.input);

    expect(await listPerformedProcedures(b.ctx, a.patientId)).toEqual([]);
    await expect(
      recordPerformedProcedure(b.ctx, a.patientId, {
        ...b.input,
        serviceId: a.service.id,
        unitPriceMinor: a.service.priceMinor,
      }),
    ).rejects.toBeInstanceOf(ProcedureReferenceError);
    expect(
      await withDbContext({ actorType: "staff" }, (tx) =>
        tx.select().from(performedProcedures).where(eq(performedProcedures.id, created.id)),
      ),
    ).toHaveLength(0);

    await expectDbError(
      withDbContext(
        { organizationId: b.ctx.organizationId, userId: b.ctx.userId, actorType: "staff" },
        (tx) =>
          tx.insert(encounters).values({
            organizationId: a.ctx.organizationId,
            patientId: a.patientId,
            branchId: a.input.branchId,
            primaryProviderId: a.input.performingProviderId,
            serviceDate: a.input.serviceDate,
            status: "completed",
            completedAt: new Date(),
            createdByUserId: b.ctx.userId,
          }),
      ),
      /row-level security/,
    );
  });

  it("enforces clinical permissions before accessing procedure data", async () => {
    const fixture = await setup("Cabinet Actes H");
    const accountant = contextFor(fixture.ctx, "accountant");
    await expect(listPerformedProcedures(accountant, fixture.patientId)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(recordPerformedProcedure(accountant, fixture.patientId, fixture.input)).rejects.toBeInstanceOf(ForbiddenError);
  });
});
