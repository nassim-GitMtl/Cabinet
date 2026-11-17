import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getAgendaSetup } from "@/features/agenda/server";
import {
  approveBookingRequest,
  BookingError,
  createBookingLink,
  createPatientFromRequest,
  declineBookingRequest,
  getPublicAvailability,
  getPublicBookingInfo,
  getRequestStatus,
  listBookingRequests,
  setBookingLinkActive,
  submitBookingRequest,
  listBookingLinks,
} from "@/features/booking/server";
import { addDays, isoWeekday, todayInZone } from "@/lib/dates";
import { ForbiddenError } from "@/server/auth/context";
import { appointments } from "@/server/db/schema";
import { withDbContext } from "@/server/db/tenant";
import { contextFor, makeClinic } from "../support/factories";

function nextWorkday(tz: string) {
  let d = addDays(todayInZone(tz), 2);
  while (![7, 1, 2, 3, 4].includes(isoWeekday(d))) d = addDays(d, 1);
  return d;
}

async function setup(name: string) {
  const ctx = await makeClinic(name);
  const token = await createBookingLink(ctx, "Site web");
  const info = (await getPublicBookingInfo(token))!;
  const type = info.types.find((t) => t.durationMin === 20) ?? info.types[0]!;
  const day = nextWorkday(ctx.organization.timezone);
  const request = (phone: string, time = "10:00", providerId = info.providers[0]!.id) =>
    submitBookingRequest(
      token,
      { typeId: type.id, providerId, date: day, time, contactName: "Samia Kherbouche", contactPhone: phone, contactEmail: null, declaresExistingPatient: false, message: "Douleur", locale: "fr" },
      "203.0.113.7",
    );
  return { ctx, token, info, type, day, request };
}

const appointmentCount = async (ctx: Awaited<ReturnType<typeof makeClinic>>) =>
  (await withDbContext({ organizationId: ctx.organizationId, actorType: "staff" }, (tx) => tx.select().from(appointments).where(and(eq(appointments.organizationId, ctx.organizationId))))).length;

describe("public booking with mandatory staff approval", () => {
  it("shows real availability and creates a pending request, never an appointment", async () => {
    const f = await setup("Cabinet Résa A");
    expect(f.info.clinicName).toBe("Cabinet Résa A");
    const avail = (await getPublicAvailability(f.token, f.type.id, f.day))!;
    expect(avail.days).toContain(f.day);
    expect(avail.slots[0]!.times).toContain("10:00");

    const ref = await f.request("0550 11 22 33");
    expect(await appointmentCount(f.ctx)).toBe(0);
    const status = (await getRequestStatus(ref))!;
    expect(status.status).toBe("submitted");
    expect(status.clinicName).toBe("Cabinet Résa A");
    expect(await getRequestStatus("not-a-real-reference-token")).toBeNull();
  });

  it("one approval books one confirmed appointment; a second approval is refused", async () => {
    const f = await setup("Cabinet Résa B");
    await f.request("0550 11 22 34");
    const [req] = await listBookingRequests(f.ctx, "pending");
    const created = await createPatientFromRequest(f.ctx, req!.r.id);
    expect(created.status).toBe("created");
    const patientId = created.status === "created" ? created.id : "";

    const results = await Promise.allSettled([approveBookingRequest(f.ctx, req!.r.id, patientId), approveBookingRequest(f.ctx, req!.r.id, patientId)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason).toMatchObject({ code: "alreadyDecided" });
    expect(await appointmentCount(f.ctx)).toBe(1);
    expect((await listBookingRequests(f.ctx, "decided"))[0]!.r.status).toBe("approved");
  });

  it("competing requests for the same slot: only one can be approved", async () => {
    const f = await setup("Cabinet Résa C");
    await f.request("0550 11 22 35");
    await f.request("0661 11 22 35");
    const pending = await listBookingRequests(f.ctx, "pending");
    expect(pending).toHaveLength(2);
    const ids = await Promise.all(pending.map(async (p) => {
      const c = await createPatientFromRequest(f.ctx, p.r.id, { confirmNotDuplicate: true });
      return c.status === "created" ? c.id : "";
    }));
    await approveBookingRequest(f.ctx, pending[0]!.r.id, ids[0]!);
    await expect(approveBookingRequest(f.ctx, pending[1]!.r.id, ids[1]!)).rejects.toMatchObject({ code: "slotTaken" });
    // The losing request stays pending for staff to decline or propose another time.
    expect((await listBookingRequests(f.ctx, "pending")).map((p) => p.r.id)).toEqual([pending[1]!.r.id]);
    // The booked slot no longer appears to the public.
    const avail = (await getPublicAvailability(f.token, f.type.id, f.day))!;
    expect(avail.slots.flatMap((s) => s.times)).not.toContain("10:00");
    await expect(f.request("0770 11 22 35")).rejects.toMatchObject({ code: "slotUnavailable" });
  });

  it("declines with a patient-safe reason; limits abuse; deactivated links stop working", async () => {
    const f = await setup("Cabinet Résa D");
    const ref = await f.request("0550 11 22 36", "09:00");
    const [req] = await listBookingRequests(f.ctx, "pending");
    await declineBookingRequest(f.ctx, req!.r.id, "Praticien absent ce jour");
    const status = (await getRequestStatus(ref))!;
    expect(status.status).toBe("declined");
    expect(status.declineReason).toBe("Praticien absent ce jour");

    await f.request("0550 11 22 37", "11:00");
    await f.request("0550 11 22 37", "11:30");
    await f.request("0550 11 22 37", "13:00");
    await expect(f.request("0550 11 22 37", "14:00")).rejects.toMatchObject({ code: "tooManyRequests" });

    const [link] = await listBookingLinks(f.ctx);
    await setBookingLinkActive(f.ctx, link!.id, false);
    expect(await getPublicBookingInfo(f.token)).toBeNull();
    await expect(f.request("0699 00 00 00", "15:00")).rejects.toBeInstanceOf(BookingError);
  });

  it("only authorized staff approve; tenants are isolated", async () => {
    const f = await setup("Cabinet Résa E");
    await f.request("0550 11 22 38");
    const [req] = await listBookingRequests(f.ctx, "pending");
    await expect(approveBookingRequest(contextFor(f.ctx, "accountant"), req!.r.id, req!.r.id)).rejects.toBeInstanceOf(ForbiddenError);
    const other = await makeClinic("Cabinet Résa F");
    expect(await listBookingRequests(other, "pending")).toHaveLength(0);
    const setupData = await getAgendaSetup(f.ctx);
    expect(setupData.types.filter((t) => t.isBookableOnline).length).toBeGreaterThanOrEqual(3);
  });
});
