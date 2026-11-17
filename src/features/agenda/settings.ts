import "server-only";
import { and, asc, count, desc, eq, gt, lt } from "drizzle-orm";
import { audit } from "@/server/audit";
import { requirePermission, tenantTx, type ClinicContext } from "@/server/auth/context";
import { appointments, appointmentTypes, branches, chairs, memberships, timeOff, workingHours } from "@/server/db/schema";
import { zonedToUtc } from "@/lib/dates";
import { AgendaError } from "./server";

const staff = (ctx: ClinicContext) => ({ organizationId: ctx.organizationId, actorType: "staff" as const, actorUserId: ctx.userId });
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export async function getAgendaSettings(ctx: ClinicContext) {
  requirePermission(ctx, "appointment.read");
  return tenantTx(ctx, async (tx) => {
    const chairRows = await tx.select().from(chairs).orderBy(asc(chairs.sortOrder), asc(chairs.name));
    const types = await tx.select().from(appointmentTypes).orderBy(desc(appointmentTypes.isActive), asc(appointmentTypes.defaultDurationMin));
    const providers = await tx
      .select({ id: memberships.id, displayName: memberships.displayName, title: memberships.title })
      .from(memberships)
      .where(and(eq(memberships.isProvider, true), eq(memberships.status, "active")))
      .orderBy(asc(memberships.displayName));
    const hours = await tx.select().from(workingHours).orderBy(asc(workingHours.weekday), asc(workingHours.startTime));
    const off = await tx
      .select({ t: timeOff, providerName: memberships.displayName, providerTitle: memberships.title })
      .from(timeOff)
      .leftJoin(memberships, eq(memberships.id, timeOff.providerId))
      .where(gt(timeOff.endsAt, new Date(Date.now() - 86_400_000)))
      .orderBy(asc(timeOff.startsAt));
    return { chairs: chairRows, types, providers, hours, timeOff: off };
  });
}

// --- Chairs -----------------------------------------------------------------

export async function createChair(ctx: ClinicContext, name: string) {
  requirePermission(ctx, "org.settings.manage");
  if (!name.trim()) throw new AgendaError("nameRequired");
  return tenantTx(ctx, async (tx) => {
    const [branch] = await tx.select({ id: branches.id }).from(branches).where(eq(branches.isActive, true)).orderBy(asc(branches.createdAt)).limit(1);
    const [n] = await tx.select({ n: count() }).from(chairs);
    const [c] = await tx.insert(chairs).values({ organizationId: ctx.organizationId, branchId: branch!.id, name: name.trim(), sortOrder: n?.n ?? 0 }).returning({ id: chairs.id });
    await audit(tx, { ...staff(ctx), action: "chair.created", entityType: "chair", entityId: c!.id });
  });
}

export async function setChairActive(ctx: ClinicContext, id: string, active: boolean) {
  requirePermission(ctx, "org.settings.manage");
  return tenantTx(ctx, async (tx) => {
    await tx.update(chairs).set({ isActive: active }).where(eq(chairs.id, id));
    await audit(tx, { ...staff(ctx), action: active ? "chair.activated" : "chair.deactivated", entityType: "chair", entityId: id });
  });
}

// --- Appointment types --------------------------------------------------------

export type TypeInput = { nameFr: string; nameEn: string | null; nameAr: string | null; durationMin: number; bookableOnline: boolean; active: boolean };

function validateType(input: TypeInput) {
  if (!input.nameFr.trim()) throw new AgendaError("nameRequired");
  if (!Number.isInteger(input.durationMin) || input.durationMin < 5 || input.durationMin > 480) throw new AgendaError("invalidDuration");
}

const typeName = (i: TypeInput) => ({ fr: i.nameFr.trim(), ...(i.nameEn?.trim() ? { en: i.nameEn.trim() } : {}), ...(i.nameAr?.trim() ? { ar: i.nameAr.trim() } : {}) });

export async function createAppointmentType(ctx: ClinicContext, input: TypeInput) {
  requirePermission(ctx, "org.settings.manage");
  validateType(input);
  return tenantTx(ctx, async (tx) => {
    const code = `T${Date.now().toString(36).toUpperCase()}`;
    const [t] = await tx
      .insert(appointmentTypes)
      .values({ organizationId: ctx.organizationId, code, name: typeName(input), defaultDurationMin: input.durationMin, isBookableOnline: input.bookableOnline, isActive: input.active })
      .returning({ id: appointmentTypes.id });
    await audit(tx, { ...staff(ctx), action: "appointment_type.created", entityType: "appointment_type", entityId: t!.id });
    return t!.id;
  });
}

/** Changing a type never alters existing appointments (they keep their own times). */
export async function updateAppointmentType(ctx: ClinicContext, id: string, input: TypeInput) {
  requirePermission(ctx, "org.settings.manage");
  validateType(input);
  return tenantTx(ctx, async (tx) => {
    await tx
      .update(appointmentTypes)
      .set({ name: typeName(input), defaultDurationMin: input.durationMin, isBookableOnline: input.bookableOnline, isActive: input.active })
      .where(eq(appointmentTypes.id, id));
    await audit(tx, { ...staff(ctx), action: "appointment_type.updated", entityType: "appointment_type", entityId: id });
  });
}

// --- Working hours --------------------------------------------------------------

export type HoursInterval = { weekday: number; start: string; end: string };

/** Pure validation: HH:MM, start < end, no overlap within a weekday. */
export function validateIntervals(intervals: HoursInterval[]) {
  for (const i of intervals) {
    if (i.weekday < 1 || i.weekday > 7 || !HHMM.test(i.start) || !HHMM.test(i.end) || i.start >= i.end) throw new AgendaError("invalidHours");
  }
  for (let wd = 1; wd <= 7; wd++) {
    const day = intervals.filter((i) => i.weekday === wd).sort((a, b) => a.start.localeCompare(b.start));
    for (let k = 1; k < day.length; k++) if (day[k]!.start < day[k - 1]!.end) throw new AgendaError("overlappingHours");
  }
}

/** Replaces a clinician's weekly hours. Existing appointments are kept as they are. */
export async function setWorkingHours(ctx: ClinicContext, providerId: string, intervals: HoursInterval[]) {
  requirePermission(ctx, "org.settings.manage");
  validateIntervals(intervals);
  return tenantTx(ctx, async (tx) => {
    const [provider] = await tx.select({ id: memberships.id }).from(memberships).where(and(eq(memberships.id, providerId), eq(memberships.isProvider, true)));
    if (!provider) throw new AgendaError("providerUnavailable");
    const [branch] = await tx.select({ id: branches.id }).from(branches).where(eq(branches.isActive, true)).orderBy(asc(branches.createdAt)).limit(1);
    await tx.delete(workingHours).where(eq(workingHours.providerId, providerId));
    if (intervals.length) {
      await tx.insert(workingHours).values(
        intervals.map((i) => ({ organizationId: ctx.organizationId, providerId, branchId: branch!.id, weekday: i.weekday, startTime: i.start, endTime: i.end })),
      );
    }
    await audit(tx, { ...staff(ctx), action: "working_hours.updated", entityType: "membership", entityId: providerId, metadata: { intervals: intervals.length } });
  });
}

// --- Time off -------------------------------------------------------------------

export type TimeOffInput = {
  providerId: string | null;
  kind: "leave" | "holiday" | "blocked";
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  reason: string | null;
};

/** Adds leave / holiday / blocked time. Returns how many booked appointments now overlap it (to reschedule). */
export async function addTimeOff(ctx: ClinicContext, input: TimeOffInput) {
  requirePermission(ctx, "appointment.manage");
  if (!HHMM.test(input.startTime) || !HHMM.test(input.endTime)) throw new AgendaError("invalidHours");
  const startsAt = zonedToUtc(input.startDate, input.startTime, ctx.organization.timezone);
  const endsAt = zonedToUtc(input.endDate, input.endTime, ctx.organization.timezone);
  if (endsAt <= startsAt) throw new AgendaError("invalidHours");
  return tenantTx(ctx, async (tx) => {
    const [t] = await tx
      .insert(timeOff)
      .values({ organizationId: ctx.organizationId, providerId: input.providerId, kind: input.kind, startsAt, endsAt, reason: input.reason?.trim() || null, createdByUserId: ctx.userId })
      .returning({ id: timeOff.id });
    const [overlap] = await tx
      .select({ n: count() })
      .from(appointments)
      .where(
        and(
          eq(appointments.schedulingStatus, "booked"),
          lt(appointments.startsAt, endsAt),
          gt(appointments.endsAt, startsAt),
          input.providerId ? eq(appointments.providerId, input.providerId) : undefined,
        ),
      );
    await audit(tx, { ...staff(ctx), action: "time_off.added", entityType: "time_off", entityId: t!.id, metadata: { kind: input.kind, overlapping: overlap?.n ?? 0 } });
    return { id: t!.id, overlappingAppointments: overlap?.n ?? 0 };
  });
}

export async function deleteTimeOff(ctx: ClinicContext, id: string) {
  requirePermission(ctx, "appointment.manage");
  return tenantTx(ctx, async (tx) => {
    await tx.delete(timeOff).where(eq(timeOff.id, id));
    await audit(tx, { ...staff(ctx), action: "time_off.deleted", entityType: "time_off", entityId: id });
  });
}

