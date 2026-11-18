import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getServicePickerData } from "@/features/catalog/server";
import { createOdontogramFinding, changeOdontogramFindingStatus, getOdontogram } from "@/features/odontogram/server";
import { createPatient } from "@/features/patients/server";
import { getProcedureEntrySupport, recordPerformedProcedure } from "@/features/procedures/server";
import { createTreatmentPlan, getTreatmentPlan } from "@/features/treatment-plans/server";
import { todayInZone } from "@/lib/dates";
import { ForbiddenError } from "@/server/auth/context";
import { odontogramFindings } from "@/server/db/schema";
import { withDbContext } from "@/server/db/tenant";
import { contextFor, expectDbError, makeClinic } from "../support/factories";

const patientInput = {
  firstName: "Samir", lastName: "Odontogramme", firstNameAr: null, lastNameAr: null,
  sex: undefined, birthDate: null, birthDatePrecision: "exact" as const, phone: null, phoneAlt: null,
  email: null, addressLine: null, city: null, region: null, preferredLocale: "fr" as const,
  emergencyName: null, emergencyRelationship: null, emergencyPhone: null, referralSource: null,
  referredBy: null, administrativeNotes: null, assignedProviderId: null,
};

async function setup(name: string) {
  const ctx = await makeClinic(name);
  const patient = await createPatient(ctx, patientInput, { confirmNotDuplicate: true });
  if (patient.status !== "created") throw new Error("patient fixture failed");
  const [picker, support] = await Promise.all([getServicePickerData(ctx), getProcedureEntrySupport(ctx)]);
  const service = picker.categories.flatMap((category) => category.services).find((row) => row.anatomy === "surface")!;
  const today = todayInZone(ctx.organization.timezone);
  return { ctx, patientId: patient.id, support, service, today };
}

describe("append-only odontogram", () => {
  it("derives current chart state and resolves findings with a superseding event", async () => {
    const f = await setup("Cabinet Odontogramme A");
    const findingId = await createOdontogramFinding(f.ctx, f.patientId, {
      toothNumber: "26", kind: "caries", surfaces: ["mesial", "occlusal"], note: "Lésion initiale",
      observedOn: f.today, providerId: f.support.providers[0]!.id, treatmentPlanItemId: null, performedProcedureId: null,
    });
    expect(await getOdontogram(f.ctx, f.patientId)).toMatchObject({ findings: [{ id: findingId, status: "active", toothNumber: "26" }] });

    const db = { organizationId: f.ctx.organizationId, userId: f.ctx.userId, actorType: "staff" as const };
    await expectDbError(withDbContext(db, (tx) => tx.insert(odontogramFindings).values({
      organizationId: f.ctx.organizationId, patientId: f.patientId, toothNumber: "26", kind: "crown",
      status: "resolved", observedOn: f.today, providerId: f.support.providers[0]!.id,
      supersedesId: findingId, createdByUserId: f.ctx.userId,
    })), /may only change status and note/);

    await changeOdontogramFindingStatus(f.ctx, findingId, { status: "resolved", reason: "Traitée" });
    const chart = await getOdontogram(f.ctx, f.patientId);
    expect(chart.findings).toMatchObject([{ status: "resolved", supersedesId: findingId }]);
    expect(chart.history).toHaveLength(2);
    await expectDbError(withDbContext(db, (tx) => tx.update(odontogramFindings).set({ note: "Réécrit" }).where(eq(odontogramFindings.id, findingId))), /permission denied/);
    await expectDbError(withDbContext(db, (tx) => tx.delete(odontogramFindings).where(eq(odontogramFindings.id, findingId))), /permission denied/);
    await expect(changeOdontogramFindingStatus(f.ctx, findingId, { status: "resolved", reason: "Deuxième" })).rejects.toMatchObject({ code: "findingUnavailable" });
  });

  it("links only same-patient, same-tooth planned and completed treatments and enforces permissions", async () => {
    const f = await setup("Cabinet Odontogramme B");
    const procedure = await recordPerformedProcedure(f.ctx, f.patientId, {
      serviceId: f.service.id, branchId: f.support.branches[0]!.id, performingProviderId: f.support.providers[0]!.id,
      serviceDate: f.today, quantity: 1, unitPriceMinor: f.service.priceMinor, priceOverrideReason: null,
      toothNumber: "26", surfaces: ["occlusal"], arch: null, quadrant: null,
    });
    const planId = await createTreatmentPlan(f.ctx, f.patientId, {
      title: "Traitement 26", notes: null,
      items: [{ serviceId: f.service.id, quantity: 1, toothNumber: "26", surfaces: ["occlusal"], arch: null, quadrant: null }],
    });
    const plan = (await getTreatmentPlan(f.ctx, planId))!;
    await createOdontogramFinding(f.ctx, f.patientId, {
      toothNumber: "26", kind: "existing_filling", surfaces: ["occlusal"], note: null,
      observedOn: f.today, providerId: f.support.providers[0]!.id,
      treatmentPlanItemId: plan.items[0]!.id, performedProcedureId: procedure.id,
    });
    const chart = await getOdontogram(f.ctx, f.patientId);
    expect(chart.findings[0]).toMatchObject({ treatmentPlanItemId: plan.items[0]!.id, performedProcedureId: procedure.id });
    expect(chart.planItems).toHaveLength(1);
    expect(chart.procedures).toHaveLength(1);
    await expectDbError(withDbContext({ organizationId: f.ctx.organizationId, userId: f.ctx.userId, actorType: "staff" }, (tx) =>
      tx.insert(odontogramFindings).values({
        organizationId: f.ctx.organizationId, patientId: f.patientId, toothNumber: "27", kind: "caries",
        observedOn: f.today, providerId: f.support.providers[0]!.id, performedProcedureId: procedure.id,
        createdByUserId: f.ctx.userId,
      })), /does not match finding/);

    const other = await setup("Cabinet Odontogramme C");
    await expect(createOdontogramFinding(other.ctx, f.patientId, {
      toothNumber: "26", kind: "caries", surfaces: [], note: null, observedOn: other.today,
      providerId: other.support.providers[0]!.id, treatmentPlanItemId: null, performedProcedureId: null,
    })).rejects.toMatchObject({ code: "patientUnavailable" });
    await expectDbError(withDbContext({ organizationId: other.ctx.organizationId, userId: other.ctx.userId, actorType: "staff" }, (tx) =>
      tx.insert(odontogramFindings).values({
        organizationId: f.ctx.organizationId, patientId: f.patientId, toothNumber: "26", kind: "caries",
        observedOn: f.today, providerId: f.support.providers[0]!.id, createdByUserId: other.ctx.userId,
      })), /row-level security/);
    await expect(getOdontogram(contextFor(f.ctx, "accountant"), f.patientId)).rejects.toBeInstanceOf(ForbiddenError);
  });
});
