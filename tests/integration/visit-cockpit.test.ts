import { describe, expect, it } from "vitest";
import { getAgendaSetup } from "@/features/agenda/server";
import { getServicePickerData } from "@/features/catalog/server";
import { createNote } from "@/features/notes/server";
import { addPatientAlert, createPatient } from "@/features/patients/server";
import { getProcedureEntrySupport, recordPerformedProcedure } from "@/features/procedures/server";
import { getVisitCockpit } from "@/features/visit-cockpit/server";
import { todayInZone } from "@/lib/dates";
import { ForbiddenError } from "@/server/auth/context";
import { contextFor, makeClinic } from "../support/factories";

const patientInput = {
  firstName: "Amel",
  lastName: "Séance",
  firstNameAr: null,
  lastNameAr: null,
  sex: undefined,
  birthDate: "1989-04-12",
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

describe("chairside visit cockpit", () => {
  it("assembles today’s safety, clinical and documentation work without duplicating source records", async () => {
    const ctx = await makeClinic("Cabinet Cockpit A");
    const created = await createPatient(ctx, patientInput, { confirmNotDuplicate: true });
    if (created.status !== "created") throw new Error("patient fixture failed");
    const today = todayInZone(ctx.organization.timezone);
    const [picker, support, agenda] = await Promise.all([
      getServicePickerData(ctx),
      getProcedureEntrySupport(ctx),
      getAgendaSetup(ctx),
    ]);
    const service = picker.categories.flatMap((category) => category.services).find((item) => item.code === "CONS-01")!;
    const provider = support.providers[0]!;

    await addPatientAlert(ctx, created.id, {
      kind: "allergy",
      severity: "critical",
      label: "Allergie de test",
      details: "Vérification clinique requise",
    });
    const noteId = await createNote(ctx, created.id, {
      kind: "progress",
      serviceDate: today,
      providerId: agenda.providers[0]!.id,
      templateId: null,
    });
    const procedure = await recordPerformedProcedure(ctx, created.id, {
      serviceId: service.id,
      branchId: support.branches[0]!.id,
      performingProviderId: provider.id,
      serviceDate: today,
      quantity: 1,
      unitPriceMinor: service.priceMinor,
      priceOverrideReason: null,
      toothNumber: null,
      surfaces: [],
      arch: null,
      quadrant: null,
    });

    const cockpit = await getVisitCockpit(ctx, created.id, today);
    expect(cockpit?.patient).toMatchObject({ id: created.id, firstName: "Amel" });
    expect(cockpit?.alerts).toEqual([expect.objectContaining({ label: "Allergie de test", severity: "critical" })]);
    expect(cockpit?.notes).toEqual([expect.objectContaining({ id: noteId, status: "draft", serviceDate: today })]);
    expect(cockpit?.procedures).toEqual([expect.objectContaining({ id: procedure.id, categoryId: service.categoryId })]);
  });

  it("requires clinical read access and cannot see a patient from another clinic", async () => {
    const ctx = await makeClinic("Cabinet Cockpit B");
    const created = await createPatient(ctx, patientInput, { confirmNotDuplicate: true });
    if (created.status !== "created") throw new Error("patient fixture failed");
    const today = todayInZone(ctx.organization.timezone);

    await expect(getVisitCockpit(contextFor(ctx, "accountant"), created.id, today)).rejects.toBeInstanceOf(ForbiddenError);

    const other = await makeClinic("Cabinet Cockpit C");
    expect(await getVisitCockpit(other, created.id, today)).toBeNull();
  });
});
