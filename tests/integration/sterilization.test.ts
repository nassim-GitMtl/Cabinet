import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createPatient } from "@/features/patients/server";
import {
  createInstrumentSet, createSterilizer, failSterilizationCycle, getPatientSterilization,
  getSterilizationCycle, getSterilizationDashboard, linkSterilizationPack, recallSterilizationCycle,
  recordBiologicalResult, recordSterilizationCycle, releaseSterilizationCycle,
} from "@/features/sterilization/server";
import { ForbiddenError } from "@/server/auth/context";
import { sterilizationCycles, sterilizers } from "@/server/db/schema";
import { withDbContext } from "@/server/db/tenant";
import { contextFor, expectDbError, makeClinic } from "../support/factories";

const patientInput = {
  firstName: "Amina", lastName: "Stérile", firstNameAr: null, lastNameAr: null, sex: undefined,
  birthDate: null, birthDatePrecision: "exact" as const, phone: null, phoneAlt: null, email: null,
  addressLine: null, city: null, region: null, preferredLocale: "fr" as const, emergencyName: null,
  emergencyRelationship: null, emergencyPhone: null, referralSource: null, referredBy: null,
  administrativeNotes: null, assignedProviderId: null,
};

async function setup(name: string) {
  const ctx = await makeClinic(name); const dashboard = await getSterilizationDashboard(ctx);
  const branchId = dashboard.branches.find((x) => x.active)!.id;
  const sterilizerId = await createSterilizer(ctx, { branchId, name: "Autoclave A", serialNumber: "SN-001" });
  const setId = await createInstrumentSet(ctx, { code: "EX-01", name: "Extraction", contents: "Davier, élévateur" });
  return { ctx, branchId, sterilizerId, setId };
}

function cycleInput(f: Awaited<ReturnType<typeof setup>>, overrides: Record<string, unknown> = {}) {
  return {
    branchId: f.branchId, sterilizerId: f.sterilizerId, reference: "CYCLE-001", program: "134 °C",
    startedDate: "2026-11-19", startedTime: "09:00", startedAt: new Date("2026-11-19T08:00:00Z"),
    temperatureC: "134", pressureBar: "2.1", holdMinutes: "18", chemicalIndicator: "pass" as const,
    airRemovalTest: "pass" as const, biologicalIndicator: "not_used" as const, notes: null,
    packs: [{ instrumentSetId: f.setId, label: null, expiresOn: "2027-05-19", quantity: 2 }], ...overrides,
  };
}

describe("sterilization traceability", () => {
  it("records numbered packs, requires authorized release, and traces use to a patient", async () => {
    const f = await setup("Cabinet Stérilisation A");
    const assistant = contextFor(f.ctx, "assistant");
    const cycleId = await recordSterilizationCycle(assistant, cycleInput(f));
    let cycle = (await getSterilizationCycle(f.ctx, cycleId))!;
    expect(cycle.cycle.status).toBe("pending_release");
    expect(cycle.packs.map((x) => x.pack.code)).toEqual(["ST-2026-000001", "ST-2026-000002"]);
    await expect(releaseSterilizationCycle(assistant, cycleId, null)).rejects.toBeInstanceOf(ForbiddenError);
    await releaseSterilizationCycle(contextFor(f.ctx, "dentist"), cycleId, "Paramètres conformes");
    cycle = (await getSterilizationCycle(f.ctx, cycleId))!;
    expect(cycle.cycle.status).toBe("released");

    const patient = await createPatient(f.ctx, patientInput, { confirmNotDuplicate: true });
    if (patient.status !== "created") throw new Error("patient fixture failed");
    const packId = cycle.packs[0]!.pack.id;
    await linkSterilizationPack(assistant, { packId, patientId: patient.id, performedProcedureId: null, usedOn: "2026-11-19" });
    const trace = (await getPatientSterilization(assistant, patient.id))!;
    expect(trace.uses).toHaveLength(1);
    expect(trace.uses[0]!.pack.code).toBe("ST-2026-000001");
    await expect(linkSterilizationPack(assistant, { packId, patientId: patient.id, performedProcedureId: null, usedOn: "2026-11-19" })).rejects.toThrow();
  });

  it("blocks failed indicators, preserves cycle facts, and recalls a released load after a failed biological result", async () => {
    const f = await setup("Cabinet Stérilisation B");
    const failedId = await recordSterilizationCycle(f.ctx, cycleInput(f, { reference: "FAIL-1", chemicalIndicator: "fail" }));
    await expect(releaseSterilizationCycle(f.ctx, failedId, null)).rejects.toMatchObject({ code: "failedIndicator" });
    await failSterilizationCycle(f.ctx, failedId, "Indicateur chimique non conforme");
    expect((await getSterilizationCycle(f.ctx, failedId))!.cycle.status).toBe("failed");

    const bioId = await recordSterilizationCycle(f.ctx, cycleInput(f, { reference: "BIO-1", biologicalIndicator: "pending", packs: [{ instrumentSetId: f.setId, label: null, expiresOn: null, quantity: 1 }] }));
    await releaseSterilizationCycle(f.ctx, bioId, null);
    await recordBiologicalResult(f.ctx, bioId, "fail", "Culture positive");
    const bio = (await getSterilizationCycle(f.ctx, bioId))!.cycle;
    expect(bio).toMatchObject({ status: "recalled", biologicalIndicator: "fail", recallReason: "Culture positive" });
    await expect(recallSterilizationCycle(f.ctx, bioId, "again")).rejects.toMatchObject({ code: "cycleNotReleased" });

    const db = { organizationId: f.ctx.organizationId, userId: f.ctx.userId, actorType: "staff" as const };
    await expectDbError(withDbContext(db, (tx) => tx.update(sterilizationCycles).set({ reference: "CHANGED" }).where(eq(sterilizationCycles.id, bioId))), /recorded cycle data is immutable/);
  });

  it("enforces read permissions and cross-tenant isolation", async () => {
    const f = await setup("Cabinet Stérilisation C");
    await expect(getSterilizationDashboard(contextFor(f.ctx, "accountant"))).rejects.toBeInstanceOf(ForbiddenError);
    const other = await makeClinic("Cabinet Stérilisation D");
    expect((await getSterilizationDashboard(other)).sterilizers).toHaveLength(0);
    const otherDb = { organizationId: other.organizationId, userId: other.userId, actorType: "staff" as const };
    await expectDbError(withDbContext(otherDb, (tx) => tx.insert(sterilizers).values({ organizationId: f.ctx.organizationId, branchId: f.branchId, name: "Cross", createdByUserId: other.userId })), /row-level security|same clinic/);
  });
});
