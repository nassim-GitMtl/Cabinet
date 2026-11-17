import "server-only";
import { and, asc, desc, eq, gt, gte, isNull, lt, ne, or, sql } from "drizzle-orm";
import { audit } from "@/server/audit";
import { requirePermission, tenantTx, type ClinicContext } from "@/server/auth/context";
import type { Tx } from "@/server/db/client";
import { appointments, appointmentTypes, branches, chairs, memberships, patients, timeOff, workingHours } from "@/server/db/schema";
import { isoWeekday, timeInZone, todayInZone, zonedToUtc } from "@/lib/dates";

export class AgendaError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}

const staff = (ctx: ClinicContext) => ({ organizationId: ctx.organizationId, actorType: "staff" as const, actorUserId: ctx.userId });

/** Maps PostgreSQL exclusion violations (23P01) to a specific conflict code. */
function conflictFrom(err: unknown): AgendaError | null {
  const cause = (err as { cause?: { code?: string; constraint_name?: string } }).cause ?? (err as { code?: string; constraint_name?: string });
  if (cause?.code !== "23P01") return null;
  const name = cause.constraint_name ?? "";
  return new AgendaError(name.includes("chair") ? "conflictChair" : name.includes("patient") ? "conflictPatient" : "conflictProvider");
}

export async function getAgendaSetup(ctx: ClinicContext) {
  requirePermission(ctx, "appointment.read");
  return tenantTx(ctx, async (tx) => {
    const [providers, chairRows, types, branchRows, hours] = [
      await tx.select({ id: memberships.id, displayName: memberships.displayName, title: memberships.title }).from(memberships).where(and(eq(memberships.isProvider, true), eq(memberships.status, "active"))).orderBy(asc(memberships.displayName)),
      await tx.select().from(chairs).where(eq(chairs.isActive, true)).orderBy(asc(chairs.sortOrder), asc(chairs.name)),
      await tx.select().from(appointmentTypes).where(eq(appointmentTypes.isActive, true)).orderBy(asc(appointmentTypes.defaultDurationMin)),
      await tx.select({ id: branches.id, name: branches.name }).from(branches).where(eq(branches.isActive, true)),
      await tx.select().from(workingHours).orderBy(asc(workingHours.weekday), asc(workingHours.startTime)),
    ];
    return { providers, chairs: chairRows, types, branches: branchRows, hours };
  });
}

export type AppointmentInput = {
  patientId: string;
  providerId: string;
  chairId: string | null;
  appointmentTypeId: string | null;
  date: string; // clinic-local YYYY-MM-DD
  time: string; // clinic-local HH:MM
  durationMin: number;
  notes: string | null;
  outsideHoursOverride: boolean;
};

async function validateSlot(tx: Tx, ctx: ClinicContext, input: AppointmentInput, startsAt: Date, endsAt: Date) {
  if (input.durationMin < 5 || input.durationMin > 480) throw new AgendaError("invalidDuration");
  const [provider] = await tx.select({ id: memberships.id }).from(memberships).where(and(eq(memberships.id, input.providerId), eq(memberships.isProvider, true), eq(memberships.status, "active")));
  if (!provider) throw new AgendaError("providerUnavailable");
  if (input.chairId) {
    const [chair] = await tx.select({ id: chairs.id }).from(chairs).where(and(eq(chairs.id, input.chairId), eq(chairs.isActive, true)));
    if (!chair) throw new AgendaError("chairUnavailable");
  }
  if (input.outsideHoursOverride) return;
  // Within one working-hours interval of that weekday (if the provider has hours configured).
  const hours = await tx.select().from(workingHours).where(eq(workingHours.providerId, input.providerId));
  if (hours.length) {
    const wd = isoWeekday(input.date);
    const start = timeInZone(startsAt, ctx.organization.timezone);
    const end = timeInZone(endsAt, ctx.organization.timezone);
    const fits = hours.some((h) => h.weekday === wd && h.startTime.slice(0, 5) <= start && end <= h.endTime.slice(0, 5) && end > start);
    if (!fits) throw new AgendaError("outsideHours");
  }
  const off = await tx
    .select({ id: timeOff.id })
    .from(timeOff)
    .where(and(or(isNull(timeOff.providerId), eq(timeOff.providerId, input.providerId)), lt(timeOff.startsAt, endsAt), gt(timeOff.endsAt, startsAt)))
    .limit(1);
  if (off.length) throw new AgendaError("timeOff");
}

function slot(ctx: ClinicContext, input: AppointmentInput) {
  if (input.date < todayInZone(ctx.organization.timezone)) throw new AgendaError("pastDate");
  const startsAt = zonedToUtc(input.date, input.time, ctx.organization.timezone);
  const endsAt = new Date(startsAt.getTime() + input.durationMin * 60_000);
  return { startsAt, endsAt };
}

export async function createAppointment(ctx: ClinicContext, input: AppointmentInput) {
  requirePermission(ctx, "appointment.manage");
  const { startsAt, endsAt } = slot(ctx, input);
  try {
    return await tenantTx(ctx, async (tx) => {
      const [patient] = await tx.select({ id: patients.id, status: patients.status }).from(patients).where(eq(patients.id, input.patientId));
      if (!patient || patient.status === "archived" || patient.status === "deceased") throw new AgendaError("patientUnavailable");
      await validateSlot(tx, ctx, input, startsAt, endsAt);
      const [branch] = await tx.select({ id: branches.id }).from(branches).where(eq(branches.isActive, true)).orderBy(asc(branches.createdAt)).limit(1);
      const [a] = await tx
        .insert(appointments)
        .values({
          organizationId: ctx.organizationId,
          branchId: branch!.id,
          patientId: input.patientId,
          providerId: input.providerId,
          chairId: input.chairId,
          appointmentTypeId: input.appointmentTypeId,
          startsAt,
          endsAt,
          notes: input.notes,
          outsideHoursOverride: input.outsideHoursOverride,
          createdByUserId: ctx.userId,
        })
        .returning({ id: appointments.id });
      await audit(tx, { ...staff(ctx), action: "appointment.booked", entityType: "appointment", entityId: a!.id, patientId: input.patientId, metadata: { startsAt: startsAt.toISOString(), override: input.outsideHoursOverride } });
      return a!.id;
    });
  } catch (err) {
    throw conflictFrom(err) ?? err;
  }
}

/** Moves an appointment (time, provider, chair). Optimistic locking; history in the audit trail. */
export async function rescheduleAppointment(ctx: ClinicContext, id: string, input: AppointmentInput, expectedVersion: number) {
  requirePermission(ctx, "appointment.manage");
  const { startsAt, endsAt } = slot(ctx, input);
  try {
    return await tenantTx(ctx, async (tx) => {
      const [current] = await tx.select().from(appointments).where(eq(appointments.id, id)).for("update");
      if (!current) throw new AgendaError("notFound");
      if (current.schedulingStatus !== "booked" || current.visitStatus !== "not_arrived") throw new AgendaError("invalidState");
      await validateSlot(tx, ctx, input, startsAt, endsAt);
      const updated = await tx
        .update(appointments)
        .set({
          startsAt,
          endsAt,
          providerId: input.providerId,
          chairId: input.chairId,
          appointmentTypeId: input.appointmentTypeId,
          notes: input.notes,
          outsideHoursOverride: input.outsideHoursOverride,
          confirmationStatus: "pending",
          updatedAt: new Date(),
          version: sql`${appointments.version} + 1`,
        })
        .where(and(eq(appointments.id, id), eq(appointments.version, expectedVersion)))
        .returning({ id: appointments.id });
      if (!updated.length) throw new AgendaError("staleVersion");
      await audit(tx, {
        ...staff(ctx),
        action: "appointment.rescheduled",
        entityType: "appointment",
        entityId: id,
        patientId: current.patientId,
        metadata: { from: current.startsAt.toISOString(), to: startsAt.toISOString(), fromProvider: current.providerId, toProvider: input.providerId },
      });
    });
  } catch (err) {
    throw conflictFrom(err) ?? err;
  }
}

export async function cancelAppointment(ctx: ClinicContext, id: string, reason: string, kind: "cancelled" | "no_show") {
  requirePermission(ctx, "appointment.manage");
  if (kind === "cancelled" && !reason.trim()) throw new AgendaError("reasonRequired");
  return tenantTx(ctx, async (tx) => {
    const [a] = await tx.select().from(appointments).where(eq(appointments.id, id)).for("update");
    if (!a) throw new AgendaError("notFound");
    if (a.schedulingStatus !== "booked" || a.visitStatus === "in_treatment" || a.visitStatus === "completed") throw new AgendaError("invalidState");
    await tx
      .update(appointments)
      .set({ schedulingStatus: kind, cancellationReason: reason.trim() || null, cancelledAt: new Date(), updatedAt: new Date(), version: sql`${appointments.version} + 1` })
      .where(eq(appointments.id, id));
    await audit(tx, { ...staff(ctx), action: `appointment.${kind}`, entityType: "appointment", entityId: id, patientId: a.patientId });
  });
}

export async function setConfirmation(ctx: ClinicContext, id: string, status: "pending" | "confirmed" | "declined" | "reschedule_requested") {
  requirePermission(ctx, "appointment.manage");
  return tenantTx(ctx, async (tx) => {
    const [a] = await tx
      .update(appointments)
      .set({ confirmationStatus: status, updatedAt: new Date(), version: sql`${appointments.version} + 1` })
      .where(and(eq(appointments.id, id), eq(appointments.schedulingStatus, "booked")))
      .returning({ patientId: appointments.patientId });
    if (!a) throw new AgendaError("invalidState");
    await audit(tx, { ...staff(ctx), action: "appointment.confirmation", entityType: "appointment", entityId: id, patientId: a.patientId, metadata: { status } });
  });
}

const VISIT_FLOW = ["not_arrived", "arrived", "waiting", "in_treatment", "completed"] as const;
export type VisitStatus = (typeof VISIT_FLOW)[number];

/** Reception workflow: forward-only visit states with timestamps. Independent of billing. */
export async function setVisitStatus(ctx: ClinicContext, id: string, next: VisitStatus) {
  requirePermission(ctx, "appointment.manage");
  return tenantTx(ctx, async (tx) => {
    const [a] = await tx.select().from(appointments).where(eq(appointments.id, id)).for("update");
    if (!a) throw new AgendaError("notFound");
    if (a.schedulingStatus !== "booked") throw new AgendaError("invalidState");
    if (VISIT_FLOW.indexOf(next) <= VISIT_FLOW.indexOf(a.visitStatus)) throw new AgendaError("invalidState");
    const now = new Date();
    await tx
      .update(appointments)
      .set({
        visitStatus: next,
        arrivedAt: a.arrivedAt ?? (next !== "not_arrived" ? now : null),
        treatmentStartedAt: next === "in_treatment" || next === "completed" ? (a.treatmentStartedAt ?? now) : a.treatmentStartedAt,
        completedAt: next === "completed" ? now : a.completedAt,
        updatedAt: now,
        version: sql`${appointments.version} + 1`,
      })
      .where(eq(appointments.id, id));
    await audit(tx, { ...staff(ctx), action: "appointment.visit_status", entityType: "appointment", entityId: id, patientId: a.patientId, metadata: { from: a.visitStatus, to: next } });
  });
}

const listSelect = {
  id: appointments.id,
  startsAt: appointments.startsAt,
  endsAt: appointments.endsAt,
  schedulingStatus: appointments.schedulingStatus,
  confirmationStatus: appointments.confirmationStatus,
  visitStatus: appointments.visitStatus,
  notes: appointments.notes,
  version: appointments.version,
  arrivedAt: appointments.arrivedAt,
  treatmentStartedAt: appointments.treatmentStartedAt,
  completedAt: appointments.completedAt,
  patientId: patients.id,
  patientNumber: patients.patientNumber,
  firstName: patients.firstName,
  lastName: patients.lastName,
  phone: patients.phone,
  providerId: appointments.providerId,
  providerName: memberships.displayName,
  providerTitle: memberships.title,
  chairId: appointments.chairId,
  chairName: chairs.name,
  typeId: appointments.appointmentTypeId,
  typeName: appointmentTypes.name,
  typeColor: appointmentTypes.color,
};

export async function listAppointments(ctx: ClinicContext, from: Date, to: Date, opts: { providerId?: string | null; includeCancelled?: boolean } = {}) {
  requirePermission(ctx, "appointment.read");
  return tenantTx(ctx, (tx) =>
    tx
      .select(listSelect)
      .from(appointments)
      .innerJoin(patients, eq(patients.id, appointments.patientId))
      .innerJoin(memberships, eq(memberships.id, appointments.providerId))
      .leftJoin(chairs, eq(chairs.id, appointments.chairId))
      .leftJoin(appointmentTypes, eq(appointmentTypes.id, appointments.appointmentTypeId))
      .where(
        and(
          lt(appointments.startsAt, to),
          gt(appointments.endsAt, from),
          opts.providerId ? eq(appointments.providerId, opts.providerId) : undefined,
          opts.includeCancelled ? undefined : eq(appointments.schedulingStatus, "booked"),
        ),
      )
      .orderBy(asc(appointments.startsAt)),
  );
}

export type AgendaItem = Awaited<ReturnType<typeof listAppointments>>[number];

export async function getAppointment(ctx: ClinicContext, id: string) {
  requirePermission(ctx, "appointment.read");
  return tenantTx(ctx, async (tx) => {
    const [row] = await tx
      .select({ ...listSelect, cancellationReason: appointments.cancellationReason, outsideHoursOverride: appointments.outsideHoursOverride })
      .from(appointments)
      .innerJoin(patients, eq(patients.id, appointments.patientId))
      .innerJoin(memberships, eq(memberships.id, appointments.providerId))
      .leftJoin(chairs, eq(chairs.id, appointments.chairId))
      .leftJoin(appointmentTypes, eq(appointmentTypes.id, appointments.appointmentTypeId))
      .where(eq(appointments.id, id));
    return row ?? null;
  });
}

/** Next booked appointment and recent history for the patient profile. */
export async function listPatientAppointments(ctx: ClinicContext, patientId: string) {
  requirePermission(ctx, "appointment.read");
  return tenantTx(ctx, async (tx) => {
    const now = new Date();
    const base = tx
      .select(listSelect)
      .from(appointments)
      .innerJoin(patients, eq(patients.id, appointments.patientId))
      .innerJoin(memberships, eq(memberships.id, appointments.providerId))
      .leftJoin(chairs, eq(chairs.id, appointments.chairId))
      .leftJoin(appointmentTypes, eq(appointmentTypes.id, appointments.appointmentTypeId));
    const upcoming = await base
      .where(and(
        eq(appointments.patientId, patientId),
        eq(appointments.schedulingStatus, "booked"),
        ne(appointments.visitStatus, "completed"),
        gte(appointments.endsAt, now),
      ))
      .orderBy(asc(appointments.startsAt))
      .limit(5);
    const past = await tx
      .select({ id: appointments.id, startsAt: appointments.startsAt, schedulingStatus: appointments.schedulingStatus, visitStatus: appointments.visitStatus })
      .from(appointments)
      .where(and(
        eq(appointments.patientId, patientId),
        or(
          lt(appointments.endsAt, now),
          ne(appointments.schedulingStatus, "booked"),
          eq(appointments.visitStatus, "completed"),
        ),
      ))
      .orderBy(desc(appointments.startsAt))
      .limit(10);
    return { upcoming, past };
  });
}
