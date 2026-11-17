import { describe, expect, it } from "vitest";
import {
  AgendaError,
  cancelAppointment,
  createAppointment,
  getAgendaSetup,
  listAppointments,
  listPatientAppointments,
  rescheduleAppointment,
  setVisitStatus,
  type AppointmentInput,
} from "@/features/agenda/server";
import { createPatient } from "@/features/patients/server";
import { addDays, isoWeekday, todayInZone, zonedToUtc } from "@/lib/dates";
import { ForbiddenError } from "@/server/auth/context";
import { contextFor, makeClinic } from "../support/factories";

const blank = {
  firstNameAr: null, lastNameAr: null, sex: undefined, birthDate: null, birthDatePrecision: "exact" as const, phone: null, phoneAlt: null,
  email: null, addressLine: null, city: null, region: null, preferredLocale: "fr" as const, emergencyName: null, emergencyRelationship: null,
  emergencyPhone: null, referralSource: null, referredBy: null, administrativeNotes: null, assignedProviderId: null,
};

/** Next working day (Sun–Thu) at least one day ahead, in the clinic timezone. */
function nextWorkday(tz: string) {
  let d = addDays(todayInZone(tz), 1);
  while (![7, 1, 2, 3, 4].includes(isoWeekday(d))) d = addDays(d, 1);
  return d;
}

async function setup(name: string) {
  const ctx = await makeClinic(name);
  const mk = async (first: string) => {
    const r = await createPatient(ctx, { ...blank, firstName: first, lastName: "Agenda" }, { confirmNotDuplicate: true });
    if (r.status !== "created") throw new Error("fixture");
    return r.id;
  };
  const setupData = await getAgendaSetup(ctx);
  const day = nextWorkday(ctx.organization.timezone);
  const base = (patientId: string, time: string, extra: Partial<AppointmentInput> = {}): AppointmentInput => ({
    patientId,
    providerId: setupData.providers[0]!.id,
    chairId: setupData.chairs[0]!.id,
    appointmentTypeId: setupData.types[0]!.id,
    date: day,
    time,
    durationMin: 30,
    notes: null,
    outsideHoursOverride: false,
    ...extra,
  });
  return { ctx, mk, setupData, day, base };
}

describe("agenda", () => {
  it("seeds defaults for a new clinic (chair, types, Sun–Thu hours)", async () => {
    const f = await setup("Cabinet Agenda A");
    expect(f.setupData.chairs).toHaveLength(1);
    expect(f.setupData.types.length).toBeGreaterThanOrEqual(5);
    expect(new Set(f.setupData.hours.map((h) => h.weekday))).toEqual(new Set([7, 1, 2, 3, 4]));
  });

  it("prevents double booking in the database, even concurrently", async () => {
    const f = await setup("Cabinet Agenda B");
    const [p1, p2] = [await f.mk("Un"), await f.mk("Deux")];
    const results = await Promise.allSettled([createAppointment(f.ctx, f.base(p1, "09:00")), createAppointment(f.ctx, f.base(p2, "09:15"))]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(AgendaError);
    expect(["conflictProvider", "conflictChair"]).toContain(rejected.reason.code);

    // Back-to-back is fine; the same patient cannot be in two places.
    await createAppointment(f.ctx, f.base(p2, "09:30", { chairId: null }));
    await expect(createAppointment(f.ctx, f.base(p2, "09:45", { providerId: f.setupData.providers[0]!.id, chairId: null, time: "09:40" }))).rejects.toBeInstanceOf(AgendaError);
  });

  it("respects working hours unless explicitly overridden, and cancellation frees the slot", async () => {
    const f = await setup("Cabinet Agenda C");
    const p = await f.mk("Trois");
    await expect(createAppointment(f.ctx, f.base(p, "12:15"))).rejects.toMatchObject({ code: "outsideHours" });
    const id = await createAppointment(f.ctx, f.base(p, "12:15", { outsideHoursOverride: true }));
    await cancelAppointment(f.ctx, id, "Patient indisponible", "cancelled");
    const p2 = await f.mk("Quatre");
    await createAppointment(f.ctx, f.base(p2, "12:15", { outsideHoursOverride: true }));
    const from = zonedToUtc(f.day, "00:00", "Africa/Algiers");
    const list = await listAppointments(f.ctx, from, new Date(from.getTime() + 86_400_000));
    expect(list).toHaveLength(1);
  });

  it("reschedules with optimistic locking and runs the reception visit flow", async () => {
    const f = await setup("Cabinet Agenda D");
    const p = await f.mk("Cinq");
    const id = await createAppointment(f.ctx, f.base(p, "10:00"));
    await rescheduleAppointment(f.ctx, id, f.base(p, "14:00"), 1);
    await expect(rescheduleAppointment(f.ctx, id, f.base(p, "15:00"), 1)).rejects.toMatchObject({ code: "staleVersion" });
    await setVisitStatus(f.ctx, id, "arrived");
    await setVisitStatus(f.ctx, id, "in_treatment");
    await expect(setVisitStatus(f.ctx, id, "arrived")).rejects.toMatchObject({ code: "invalidState" });
    await setVisitStatus(f.ctx, id, "completed");
    const mine = await listPatientAppointments(f.ctx, p);
    expect(mine.upcoming).toHaveLength(0);
    expect(mine.past[0]?.visitStatus).toBe("completed");
  });

  it("is tenant-isolated and permission-checked", async () => {
    const f = await setup("Cabinet Agenda E");
    const p = await f.mk("Six");
    await createAppointment(f.ctx, f.base(p, "11:00"));
    const other = await makeClinic("Cabinet Agenda F");
    const from = zonedToUtc(f.day, "00:00", "Africa/Algiers");
    expect(await listAppointments(other, from, new Date(from.getTime() + 86_400_000))).toHaveLength(0);
    await expect(createAppointment(contextFor(f.ctx, "accountant"), f.base(p, "15:00"))).rejects.toBeInstanceOf(ForbiddenError);
  });
});
