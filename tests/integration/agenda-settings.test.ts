import { describe, expect, it } from "vitest";
import { AgendaError, createAppointment, getAgendaSetup, type AppointmentInput } from "@/features/agenda/server";
import {
  addTimeOff,
  createAppointmentType,
  createChair,
  getAgendaSettings,
  setChairActive,
  setWorkingHours,
  updateAppointmentType,
  validateIntervals,
} from "@/features/agenda/settings";
import { createBookingLink, getPublicBookingInfo } from "@/features/booking/server";
import { createPatient } from "@/features/patients/server";
import { addDays, isoWeekday, todayInZone } from "@/lib/dates";
import { ForbiddenError } from "@/server/auth/context";
import { contextFor, makeClinic } from "../support/factories";

const blank = {
  firstNameAr: null, lastNameAr: null, sex: undefined, birthDate: null, birthDatePrecision: "exact" as const, phone: null, phoneAlt: null,
  email: null, addressLine: null, city: null, region: null, preferredLocale: "fr" as const, emergencyName: null, emergencyRelationship: null,
  emergencyPhone: null, referralSource: null, referredBy: null, administrativeNotes: null, assignedProviderId: null,
};

function next(tz: string, weekday: number) {
  let d = addDays(todayInZone(tz), 1);
  while (isoWeekday(d) !== weekday) d = addDays(d, 1);
  return d;
}

async function setup(name: string) {
  const ctx = await makeClinic(name);
  const p = await createPatient(ctx, { ...blank, firstName: "Réglage", lastName: "Test" }, { confirmNotDuplicate: true });
  if (p.status !== "created") throw new Error("fixture");
  const s = await getAgendaSetup(ctx);
  const input = (date: string, time: string): AppointmentInput => ({
    patientId: p.id, providerId: s.providers[0]!.id, chairId: null, appointmentTypeId: null, date, time, durationMin: 30, notes: null, outsideHoursOverride: false,
  });
  return { ctx, providerId: s.providers[0]!.id, input };
}

describe("agenda settings", () => {
  it("validates working-hour intervals", () => {
    expect(() => validateIntervals([{ weekday: 1, start: "08:00", end: "12:00" }, { weekday: 1, start: "13:00", end: "17:00" }])).not.toThrow();
    expect(() => validateIntervals([{ weekday: 1, start: "12:00", end: "08:00" }])).toThrow(AgendaError);
    expect(() => validateIntervals([{ weekday: 1, start: "08:00", end: "12:00" }, { weekday: 1, start: "11:00", end: "14:00" }])).toThrow(/overlappingHours/);
  });

  it("new working hours change what can be booked", async () => {
    const f = await setup("Cabinet Réglages A");
    const saturday = next(f.ctx.organization.timezone, 6);
    await expect(createAppointment(f.ctx, f.input(saturday, "09:00"))).rejects.toMatchObject({ code: "outsideHours" });
    await setWorkingHours(f.ctx, f.providerId, [{ weekday: 6, start: "09:00", end: "13:00" }]);
    await createAppointment(f.ctx, f.input(saturday, "09:00"));
    const sunday = next(f.ctx.organization.timezone, 7);
    await expect(createAppointment(f.ctx, f.input(sunday, "09:00"))).rejects.toMatchObject({ code: "outsideHours" });
  });

  it("time off blocks booking and reports overlapping appointments", async () => {
    const f = await setup("Cabinet Réglages B");
    const monday = next(f.ctx.organization.timezone, 1);
    await createAppointment(f.ctx, f.input(monday, "10:00"));
    const r = await addTimeOff(f.ctx, { providerId: f.providerId, kind: "leave", startDate: monday, startTime: "00:00", endDate: monday, endTime: "23:59", reason: "Formation" });
    expect(r.overlappingAppointments).toBe(1);
    await expect(createAppointment(f.ctx, f.input(monday, "14:00"))).rejects.toMatchObject({ code: "timeOff" });
    const clinicClosed = await addTimeOff(f.ctx, { providerId: null, kind: "holiday", startDate: addDays(monday, 1), startTime: "00:00", endDate: addDays(monday, 1), endTime: "23:59", reason: null });
    expect(clinicClosed.overlappingAppointments).toBe(0);
    await expect(createAppointment(f.ctx, f.input(addDays(monday, 1), "09:00"))).rejects.toMatchObject({ code: "timeOff" });
    expect((await getAgendaSettings(f.ctx)).timeOff).toHaveLength(2);
  });

  it("chairs and types: deactivation hides them; online flag drives the public page", async () => {
    const f = await setup("Cabinet Réglages C");
    await createChair(f.ctx, "Fauteuil 2");
    let s = await getAgendaSettings(f.ctx);
    const chair2 = s.chairs.find((c) => c.name === "Fauteuil 2")!;
    await setChairActive(f.ctx, chair2.id, false);
    expect((await getAgendaSetup(f.ctx)).chairs.map((c) => c.name)).toEqual(["Fauteuil 1"]);

    const id = await createAppointmentType(f.ctx, { nameFr: "Bilan orthodontique", nameEn: null, nameAr: null, durationMin: 45, bookableOnline: true, active: true });
    const token = await createBookingLink(f.ctx, "Site");
    // Links snapshot the bookable types at creation; the new type is included.
    expect((await getPublicBookingInfo(token))!.types.some((t) => t.id === id)).toBe(true);
    await updateAppointmentType(f.ctx, id, { nameFr: "Bilan orthodontique", nameEn: null, nameAr: null, durationMin: 45, bookableOnline: false, active: true });
    expect((await getPublicBookingInfo(token))!.types.some((t) => t.id === id)).toBe(false);
    s = await getAgendaSettings(f.ctx);
    expect(s.types.find((t) => t.id === id)!.defaultDurationMin).toBe(45);
  });

  it("only authorized staff change settings", async () => {
    const f = await setup("Cabinet Réglages D");
    await expect(createChair(contextFor(f.ctx, "receptionist"), "X")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(setWorkingHours(contextFor(f.ctx, "dentist"), f.providerId, [])).rejects.toBeInstanceOf(ForbiddenError);
    await addTimeOff(contextFor(f.ctx, "assistant"), { providerId: f.providerId, kind: "blocked", startDate: next(f.ctx.organization.timezone, 2), startTime: "08:00", endDate: next(f.ctx.organization.timezone, 2), endTime: "09:00", reason: null });
  });
});
