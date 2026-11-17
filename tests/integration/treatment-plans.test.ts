import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getServicePickerData, updateService } from "@/features/catalog/server";
import { createPatient } from "@/features/patients/server";
import { getProcedureEntrySupport, listPerformedProcedures } from "@/features/procedures/server";
import {
  convertTreatmentPlanItem,
  createTreatmentPlan,
  decideTreatmentPlan,
  getTreatmentPlan,
  listTreatmentPlans,
  proposeTreatmentPlan,
  reviseTreatmentPlan,
  TreatmentPlanReferenceError,
} from "@/features/treatment-plans/server";
import { todayInZone } from "@/lib/dates";
import { ForbiddenError } from "@/server/auth/context";
import { treatmentPlanVersions, treatmentPlans } from "@/server/db/schema";
import { withDbContext } from "@/server/db/tenant";
import { contextFor, expectDbError, makeClinic } from "../support/factories";

const patientInput = {
  firstName: "Nadia", lastName: "Plan", firstNameAr: null, lastNameAr: null,
  sex: undefined, birthDate: "1988-03-12", birthDatePrecision: "exact" as const,
  phone: null, phoneAlt: null, email: null, addressLine: null, city: null, region: null,
  preferredLocale: "fr" as const, emergencyName: null, emergencyRelationship: null,
  emergencyPhone: null, referralSource: null, referredBy: null, administrativeNotes: null,
  assignedProviderId: null,
};

async function setup(name: string) {
  const ctx = await makeClinic(name);
  const patient = await createPatient(ctx, patientInput, { confirmNotDuplicate: true });
  if (patient.status !== "created") throw new Error("patient fixture failed");
  const [picker, support] = await Promise.all([getServicePickerData(ctx), getProcedureEntrySupport(ctx)]);
  const service = picker.categories.flatMap((category) => category.services).find((row) => row.code === "CONS-01")!;
  const input = {
    title: "Plan initial",
    notes: "Deux étapes proposées",
    items: [{ serviceId: service.id, quantity: 2, toothNumber: null, surfaces: [], arch: null, quadrant: null }],
  };
  return { ctx, patientId: patient.id, service, support, input };
}

describe("treatment plans and versioned estimates", () => {
  it("keeps the accepted version immutable and converts accepted items to completed procedures", async () => {
    const f = await setup("Cabinet Plans A");
    const planId = await createTreatmentPlan(f.ctx, f.patientId, f.input);
    let plan = (await getTreatmentPlan(f.ctx, planId))!;
    expect(plan).toMatchObject({ currentVersion: 1, status: "draft", totalMinor: f.service.priceMinor * 2 });
    expect(plan.items[0]!.serviceSnapshot.name.fr).toBe(f.service.name.fr);

    await updateService(f.ctx, f.service.id, {
      categoryId: f.service.categoryId, code: f.service.code, nameFr: "Consultation modifiée",
      nameEn: "Changed consultation", pricingUnit: "procedure", anatomy: "none",
      defaultDurationMin: f.service.defaultDurationMin, priceMinor: f.service.priceMinor + 50000,
      priceChangeReason: "Test snapshot",
    }, f.service.version);
    expect((await getTreatmentPlan(f.ctx, planId))!.items[0]!.unitPriceMinor).toBe(f.service.priceMinor);

    await proposeTreatmentPlan(f.ctx, planId, plan.version);
    plan = (await getTreatmentPlan(f.ctx, planId))!;
    await decideTreatmentPlan(f.ctx, planId, { expectedVersion: plan.version, decision: "accepted", method: "signed_in_clinic", note: null });
    plan = (await getTreatmentPlan(f.ctx, planId))!;
    expect(plan).toMatchObject({ status: "accepted", decision: { decision: "accepted", method: "signed_in_clinic" } });

    await convertTreatmentPlanItem(f.ctx, planId, plan.items[0]!.id, {
      expectedVersion: plan.version,
      branchId: f.support.branches[0]!.id,
      performingProviderId: f.support.providers[0]!.id,
      serviceDate: todayInZone(f.ctx.organization.timezone),
    });
    plan = (await getTreatmentPlan(f.ctx, planId))!;
    expect(plan.status).toBe("completed");
    expect(plan.items[0]!.performedProcedureId).toBeTruthy();
    expect(await listPerformedProcedures(f.ctx, f.patientId)).toMatchObject([{ unitPriceMinor: f.service.priceMinor, quantity: 2 }]);

    await expectDbError(
      withDbContext({ organizationId: f.ctx.organizationId, userId: f.ctx.userId, actorType: "staff" }, (tx) =>
        tx.update(treatmentPlanVersions).set({ title: "Rewritten" }).where(eq(treatmentPlanVersions.planId, planId))),
      /permission denied/,
    );
  });

  it("creates a complete new version while preserving the prior patient decision", async () => {
    const f = await setup("Cabinet Plans B");
    const planId = await createTreatmentPlan(f.ctx, f.patientId, f.input);
    let plan = (await getTreatmentPlan(f.ctx, planId))!;
    await proposeTreatmentPlan(f.ctx, planId, plan.version);
    plan = (await getTreatmentPlan(f.ctx, planId))!;
    await decideTreatmentPlan(f.ctx, planId, { expectedVersion: plan.version, decision: "declined", method: "verbal", note: "Patient wishes to reconsider" });
    plan = (await getTreatmentPlan(f.ctx, planId))!;
    await reviseTreatmentPlan(f.ctx, planId, plan.version, { ...f.input, title: "Plan révisé", items: [{ ...f.input.items[0]!, quantity: 1 }] });
    plan = (await getTreatmentPlan(f.ctx, planId))!;
    expect(plan).toMatchObject({ status: "draft", currentVersion: 2, title: "Plan révisé", decision: null });
    expect(plan.history).toMatchObject([
      { versionNumber: 2, decision: null },
      { versionNumber: 1, decision: "declined" },
    ]);
  });

  it("enforces permissions and tenant isolation", async () => {
    const a = await setup("Cabinet Plans C");
    const b = await setup("Cabinet Plans D");
    const planId = await createTreatmentPlan(a.ctx, a.patientId, a.input);
    expect(await listTreatmentPlans(b.ctx, a.patientId)).toEqual([]);
    await expect(createTreatmentPlan(b.ctx, a.patientId, { ...b.input, items: [{ ...b.input.items[0]!, serviceId: a.service.id }] }))
      .rejects.toBeInstanceOf(TreatmentPlanReferenceError);
    await expectDbError(
      withDbContext({ organizationId: b.ctx.organizationId, userId: b.ctx.userId, actorType: "staff" }, (tx) =>
        tx.insert(treatmentPlans).values({ organizationId: a.ctx.organizationId, patientId: a.patientId, createdByUserId: b.ctx.userId, updatedByUserId: b.ctx.userId })),
      /row-level security/,
    );
    const accountant = contextFor(a.ctx, "accountant");
    await expect(getTreatmentPlan(accountant, planId)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createTreatmentPlan(accountant, a.patientId, a.input)).rejects.toBeInstanceOf(ForbiddenError);
  });
});
