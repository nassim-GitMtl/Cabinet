import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createBookingLink, createPatientFromRequest, getPublicBookingInfo, listBookingRequests, submitBookingRequest } from "@/features/booking/server";
import { getServicePickerData } from "@/features/catalog/server";
import { createPatient, getPatient, PatientReferralError, updatePatient } from "@/features/patients/server";
import { getProcedureEntrySupport, recordPerformedProcedure } from "@/features/procedures/server";
import { getAcquisitionReport, periodMonths } from "@/features/reports/acquisition";
import { addDays, isoWeekday, todayInZone } from "@/lib/dates";
import { ForbiddenError } from "@/server/auth/context";
import { patients } from "@/server/db/schema";
import { withDbContext } from "@/server/db/tenant";
import { contextFor, expectDbError, makeClinic } from "../support/factories";

const blank = {
  firstNameAr: null, lastNameAr: null, sex: undefined, birthDate: null, birthDatePrecision: "exact" as const, phone: null, phoneAlt: null,
  email: null, addressLine: null, city: null, region: null, preferredLocale: "fr" as const, emergencyName: null, emergencyRelationship: null,
  emergencyPhone: null, referralSource: null, referredBy: null, administrativeNotes: null, assignedProviderId: null,
};
type Extra = { acquisitionChannel?: "facebook" | "instagram" | "google" | "patient_referral" | null; referredByPatientId?: string | null };

async function setup(name: string) {
  const ctx = await makeClinic(name);
  const add = async (firstName: string, extra: Extra = {}) => {
    const r = await createPatient(ctx, { ...blank, firstName, lastName: "Source", ...extra }, { confirmNotDuplicate: true });
    if (r.status !== "created") throw new Error("fixture");
    return r.id;
  };
  return { ctx, add, today: todayInZone(ctx.organization.timezone) };
}

describe("where new patients come from", () => {
  it("stores the channel and the referring patient, with same-clinic and no-self rules", async () => {
    const f = await setup("Cabinet Sources A");
    const amel = await f.add("Amel", { acquisitionChannel: "facebook" });
    // Choosing a referrer implies the "recommended by a patient" channel.
    const sofiane = await f.add("Sofiane", { referredByPatientId: amel });
    let data = (await getPatient(f.ctx, sofiane))!;
    expect(data.patient).toMatchObject({ acquisitionChannel: "patient_referral", referredByPatientId: amel });
    expect(data.referrer).toMatchObject({ id: amel, firstName: "Amel" });
    expect((await getPatient(f.ctx, amel))!.referredCount).toBe(1);

    // Changing the channel clears the referrer; omitting both fields keeps what was stored.
    await updatePatient(f.ctx, sofiane, { ...blank, firstName: "Sofiane", lastName: "Source", acquisitionChannel: "instagram" }, 1);
    data = (await getPatient(f.ctx, sofiane))!;
    expect(data.patient).toMatchObject({ acquisitionChannel: "instagram", referredByPatientId: null });
    await updatePatient(f.ctx, sofiane, { ...blank, firstName: "Sofiane", lastName: "Source" }, 2);
    expect((await getPatient(f.ctx, sofiane))!.patient.acquisitionChannel).toBe("instagram");

    await expect(updatePatient(f.ctx, sofiane, { ...blank, firstName: "Sofiane", lastName: "Source", referredByPatientId: sofiane }, 3)).rejects.toBeInstanceOf(PatientReferralError);
    const other = await setup("Cabinet Sources B");
    const stranger = await other.add("Externe");
    await expect(f.add("Lyes", { referredByPatientId: stranger })).rejects.toBeInstanceOf(PatientReferralError);
    await expectDbError(
      withDbContext({ organizationId: f.ctx.organizationId, userId: f.ctx.userId, actorType: "staff" }, (tx) =>
        tx.update(patients).set({ referredByPatientId: stranger }).where(eq(patients.id, amel))),
      /same organization/,
    );
  });

  it("reports new patients by source and month, treated share, production and top referrers", async () => {
    const f = await setup("Cabinet Sources C");
    const [picker, support] = await Promise.all([getServicePickerData(f.ctx), getProcedureEntrySupport(f.ctx)]);
    const service = picker.categories.flatMap((c) => c.services).find((s) => s.code === "CONS-01")!;
    const amel = await f.add("Amel", { acquisitionChannel: "facebook" });
    await f.add("Bachir", { acquisitionChannel: "facebook" });
    await f.add("Chafia", { referredByPatientId: amel });
    await f.add("Dalila", { referredByPatientId: amel });
    await f.add("Elias");
    await recordPerformedProcedure(f.ctx, amel, {
      serviceId: service.id, branchId: support.branches[0]!.id, performingProviderId: support.providers[0]!.id, serviceDate: f.today,
      quantity: 2, unitPriceMinor: service.priceMinor, priceOverrideReason: null, toothNumber: null, surfaces: [], arch: null, quadrant: null,
    });

    const report = await getAcquisitionReport(f.ctx, { today: f.today, months: 3 });
    expect(report.months).toEqual(periodMonths(f.today, 3));
    expect(report).toMatchObject({ total: 5, unknown: 1, treated: 1 });
    const facebook = report.channels.find((c) => c.channel === "facebook")!;
    expect(facebook).toMatchObject({ newPatients: 2, treated: 1, productionMinor: service.priceMinor * 2 });
    expect(facebook.perMonth.at(-1)).toBe(2);
    expect(report.channels.find((c) => c.channel === "patient_referral")!.newPatients).toBe(2);
    expect(report.referrers).toMatchObject([{ id: amel, count: 2 }]);

    // A receptionist sees counts but not amounts; a role without operational reports is refused.
    const receptionist = await getAcquisitionReport(contextFor(f.ctx, "receptionist"), { today: f.today, months: 3 });
    expect(receptionist.channels.find((c) => c.channel === "facebook")!.productionMinor).toBeNull();
    await expect(getAcquisitionReport(contextFor(f.ctx, "accountant"), { today: f.today, months: 3 })).rejects.toBeInstanceOf(ForbiddenError);
    // Another clinic's report never counts these patients.
    const other = await setup("Cabinet Sources D");
    expect((await getAcquisitionReport(other.ctx, { today: other.today, months: 3 })).total).toBe(0);
  });

  it("keeps the answer from online booking and copies it to the patient created on approval", async () => {
    const f = await setup("Cabinet Sources E");
    const token = await createBookingLink(f.ctx, "Page Facebook");
    const info = (await getPublicBookingInfo(token))!;
    let day = addDays(f.today, 2);
    while (![7, 1, 2, 3, 4].includes(isoWeekday(day))) day = addDays(day, 1);
    await submitBookingRequest(token, {
      typeId: info.types[0]!.id, providerId: info.providers[0]!.id, date: day, time: "10:00", contactName: "Nawel Haddad",
      contactPhone: "0550 44 55 66", contactEmail: null, declaresExistingPatient: false, message: null, locale: "fr", acquisitionChannel: "google",
    }, "203.0.113.9");
    const [request] = await listBookingRequests(f.ctx, "pending");
    expect(request!.r.acquisitionChannel).toBe("google");
    const created = await createPatientFromRequest(f.ctx, request!.r.id, { confirmNotDuplicate: true });
    if (created.status !== "created") throw new Error("expected a new patient");
    expect((await getPatient(f.ctx, created.id))!.patient.acquisitionChannel).toBe("google");
    expect((await getAcquisitionReport(f.ctx, { today: f.today, months: 3 })).bookings).toMatchObject({ received: 1, pending: 1 });
  });
});
