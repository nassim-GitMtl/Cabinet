import "server-only";
import type { AcquisitionChannel } from "@/lib/acquisition";
import { createHash, randomBytes } from "node:crypto";
import { and, asc, count, desc, eq, gt, gte, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { audit } from "@/server/audit";
import { requirePermission, tenantTx, type ClinicContext } from "@/server/auth/context";
import { db } from "@/server/db/client";
import type { Tx } from "@/server/db/client";
import {
  appointments,
  appointmentTypes,
  bookingLinks,
  bookingRequests,
  chairs,
  memberships,
  organizations,
  patients,
  timeOff,
  workingHours,
} from "@/server/db/schema";
import { withDbContext } from "@/server/db/tenant";
import { addDays, timeInZone, todayInZone, zonedToUtc } from "@/lib/dates";
import { normalizePhone } from "@/lib/phone";
import { AgendaError, bookInTx, conflictFrom, validateAppointmentSlot } from "@/features/agenda/server";
import { dateRange, freeSlots, type Interval } from "./slots";
import type { LocalizedText } from "@/server/db/schema/_shared";

export class BookingError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}

const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");
const MAX_PER_PHONE_PER_DAY = 3;
const MAX_PER_IP_PER_HOUR = 10;

// ---------------------------------------------------------------------------
// Public side (no session). Org is resolved from the link token only.
// ---------------------------------------------------------------------------

async function resolveLink(token: string) {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return null;
  const rows = await db.execute<{ link_id: string; organization_id: string }>(sql`select * from app_private.resolve_booking_link(${token})`);
  const row = rows[0];
  return row ? { linkId: row.link_id, organizationId: row.organization_id } : null;
}

function publicTx<T>(organizationId: string, fn: (tx: Tx) => Promise<T>) {
  return withDbContext({ organizationId, actorType: "system" }, fn);
}

async function loadLinkData(tx: Tx, linkId: string) {
  const [link] = await tx.select().from(bookingLinks).where(eq(bookingLinks.id, linkId));
  const [org] = await tx.select({ name: organizations.name, timezone: organizations.timezone, locale: organizations.defaultLocale, enabledModules: organizations.enabledModules }).from(organizations);
  const types = await tx
    .select({ id: appointmentTypes.id, name: appointmentTypes.name, durationMin: appointmentTypes.defaultDurationMin })
    .from(appointmentTypes)
    .where(and(inArray(appointmentTypes.id, link!.appointmentTypeIds), eq(appointmentTypes.isActive, true), eq(appointmentTypes.isBookableOnline, true)))
    .orderBy(asc(appointmentTypes.defaultDurationMin));
  const providers = await tx
    .select({ id: memberships.id, displayName: memberships.displayName, title: memberships.title })
    .from(memberships)
    .where(and(eq(memberships.isProvider, true), eq(memberships.status, "active"), link!.providerIds?.length ? inArray(memberships.id, link!.providerIds) : undefined))
    .orderBy(asc(memberships.displayName));
  return { link: link!, org: org!, types, providers };
}

/** Clinic identity, bookable types and clinicians for a public link (no patient data). */
export async function getPublicBookingInfo(token: string) {
  const r = await resolveLink(token);
  if (!r) return null;
  return publicTx(r.organizationId, async (tx) => {
    const d = await loadLinkData(tx, r.linkId);
    if (!d.org.enabledModules.includes("online_booking") && d.org.enabledModules.length > 0) return null;
    return {
      clinicName: d.org.name,
      timezone: d.org.timezone,
      label: d.link.label,
      types: d.types,
      providers: d.providers.map((p) => ({ id: p.id, name: [p.title, p.displayName].filter(Boolean).join(" ") })),
    };
  });
}

type SlotsByProvider = { providerId: string; times: string[] }[];

/** Free start times per clinician for each date in range. Never exposes other patients. */
async function computeAvailability(tx: Tx, d: Awaited<ReturnType<typeof loadLinkData>>, typeId: string, dates: string[]) {
  const type = d.types.find((t) => t.id === typeId);
  if (!type || dates.length === 0) return new Map<string, SlotsByProvider>();
  const tz = d.org.timezone;
  const from = zonedToUtc(dates[0]!, "00:00", tz);
  const to = zonedToUtc(addDays(dates[dates.length - 1]!, 1), "00:00", tz);
  const providerIds = d.providers.map((p) => p.id);
  if (!providerIds.length) return new Map<string, SlotsByProvider>();
  const hours = await tx.select().from(workingHours).where(inArray(workingHours.providerId, providerIds));
  const booked = await tx
    .select({ providerId: appointments.providerId, start: appointments.startsAt, end: appointments.endsAt })
    .from(appointments)
    .where(and(inArray(appointments.providerId, providerIds), eq(appointments.schedulingStatus, "booked"), lt(appointments.startsAt, to), gt(appointments.endsAt, from)));
  const off = await tx
    .select({ providerId: timeOff.providerId, start: timeOff.startsAt, end: timeOff.endsAt })
    .from(timeOff)
    .where(and(lt(timeOff.startsAt, to), gt(timeOff.endsAt, from), or(isNull(timeOff.providerId), inArray(timeOff.providerId, providerIds))));
  const notBefore = new Date(Date.now() + d.link.minNoticeHours * 3_600_000);
  const result = new Map<string, SlotsByProvider>();
  for (const date of dates) {
    const perProvider: SlotsByProvider = [];
    for (const pid of providerIds) {
      const busy: Interval[] = [...booked.filter((b) => b.providerId === pid), ...off.filter((o) => o.providerId === null || o.providerId === pid)];
      const times = freeSlots({ date, timeZone: tz, hours: hours.filter((h) => h.providerId === pid), busy, durationMin: type.durationMin, notBefore });
      if (times.length) perProvider.push({ providerId: pid, times });
    }
    result.set(date, perProvider);
  }
  return result;
}

export async function getPublicAvailability(token: string, typeId: string, date: string | null) {
  const r = await resolveLink(token);
  if (!r) return null;
  return publicTx(r.organizationId, async (tx) => {
    const d = await loadLinkData(tx, r.linkId);
    if (!d.org.enabledModules.includes("online_booking") && d.org.enabledModules.length > 0) return null;
    const today = todayInZone(d.org.timezone);
    const dates = dateRange(today, Math.min(Math.max(d.link.horizonDays, 1), 60));
    const all = await computeAvailability(tx, d, typeId, dates);
    const days = dates.filter((x) => (all.get(x) ?? []).length > 0);
    const selected = date && days.includes(date) ? date : null;
    return { days, selected, slots: selected ? all.get(selected)! : [] };
  });
}

export type SubmitInput = {
  typeId: string;
  providerId: string;
  date: string;
  time: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string | null;
  declaresExistingPatient: boolean;
  message: string | null;
  locale: string;
  acquisitionChannel?: AcquisitionChannel | null;
};

/** Creates a request (never an appointment). Returns the secret status token. */
export async function submitBookingRequest(token: string, input: SubmitInput, ipAddress: string | null) {
  const r = await resolveLink(token);
  if (!r) throw new BookingError("linkInvalid");
  const phone = normalizePhone(input.contactPhone);
  if (!phone) throw new BookingError("invalidPhone");
  if (input.contactName.trim().length < 3) throw new BookingError("nameRequired");
  return publicTx(r.organizationId, async (tx) => {
    const d = await loadLinkData(tx, r.linkId);
    if (!d.org.enabledModules.includes("online_booking") && d.org.enabledModules.length > 0) throw new BookingError("linkInvalid");
    const type = d.types.find((t) => t.id === input.typeId);
    if (!type || !d.providers.some((p) => p.id === input.providerId)) throw new BookingError("slotUnavailable");
    // Abuse limits, counted from stored requests.
    const ipHash = ipAddress ? sha256(`${r.organizationId}:${ipAddress}`) : null;
    const [byPhone] = await tx.select({ n: count() }).from(bookingRequests).where(and(eq(bookingRequests.contactPhone, phone), gte(bookingRequests.createdAt, new Date(Date.now() - 86_400_000))));
    if ((byPhone?.n ?? 0) >= MAX_PER_PHONE_PER_DAY) throw new BookingError("tooManyRequests");
    if (ipHash) {
      const [byIp] = await tx.select({ n: count() }).from(bookingRequests).where(and(eq(bookingRequests.ipHash, ipHash), gte(bookingRequests.createdAt, new Date(Date.now() - 3_600_000))));
      if ((byIp?.n ?? 0) >= MAX_PER_IP_PER_HOUR) throw new BookingError("tooManyRequests");
    }
    // The slot must still be free right now (staff approval re-checks again).
    const avail = await computeAvailability(tx, d, input.typeId, [input.date]);
    const free = (avail.get(input.date) ?? []).find((p) => p.providerId === input.providerId)?.times.includes(input.time);
    if (!free) throw new BookingError("slotUnavailable");
    const startsAt = zonedToUtc(input.date, input.time, d.org.timezone);
    const endsAt = new Date(startsAt.getTime() + type.durationMin * 60_000);
    const ref = randomBytes(18).toString("base64url");
    const [req] = await tx
      .insert(bookingRequests)
      .values({
        organizationId: r.organizationId,
        linkId: r.linkId,
        refHash: sha256(ref),
        contactName: input.contactName.trim(),
        contactPhone: phone,
        contactEmail: input.contactEmail?.trim() || null,
        declaresExistingPatient: input.declaresExistingPatient,
        acquisitionChannel: input.acquisitionChannel ?? null,
        preferredLocale: input.locale,
        appointmentTypeId: input.typeId,
        providerId: input.providerId,
        requestedStartsAt: startsAt,
        requestedEndsAt: endsAt,
        message: input.message?.trim() || null,
        ipHash,
        expiresAt: startsAt,
      })
      .returning({ id: bookingRequests.id });
    await audit(tx, { organizationId: r.organizationId, actorType: "system", action: "booking_request.submitted", entityType: "booking_request", entityId: req!.id });
    return ref;
  });
}

/** Status page data (non-identifying), via the secret token only. */
export async function getRequestStatus(ref: string) {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(ref)) return null;
  const rows = await db.execute<{ clinic_name: string; status: string; requested_starts_at: string; decline_reason: string | null; type_name: LocalizedText; timezone: string }>(
    sql`select * from app_private.booking_request_status(${sha256(ref)})`,
  );
  const row = rows[0];
  if (!row) return null;
  const startsAt = new Date(row.requested_starts_at);
  const pending = row.status === "submitted" || row.status === "under_review";
  return {
    clinicName: row.clinic_name,
    status: pending && startsAt.getTime() < Date.now() ? "expired" : row.status,
    startsAt,
    timezone: row.timezone,
    declineReason: row.decline_reason,
    typeName: row.type_name,
  };
}

// ---------------------------------------------------------------------------
// Staff side
// ---------------------------------------------------------------------------

const staff = (ctx: ClinicContext) => ({ organizationId: ctx.organizationId, actorType: "staff" as const, actorUserId: ctx.userId });

export async function listBookingRequests(ctx: ClinicContext, view: "pending" | "decided") {
  requirePermission(ctx, "appointment.read");
  return tenantTx(ctx, async (tx) => {
    const pendingStatuses = ["submitted", "under_review", "awaiting_information", "alternative_proposed"] as const;
    return tx
      .select({
        r: bookingRequests,
        typeName: appointmentTypes.name,
        providerName: memberships.displayName,
        providerTitle: memberships.title,
        patientNumber: patients.patientNumber,
        patientFirstName: patients.firstName,
        patientLastName: patients.lastName,
      })
      .from(bookingRequests)
      .innerJoin(appointmentTypes, eq(appointmentTypes.id, bookingRequests.appointmentTypeId))
      .innerJoin(memberships, eq(memberships.id, bookingRequests.providerId))
      .leftJoin(patients, eq(patients.id, bookingRequests.patientId))
      .where(
        view === "pending"
          ? inArray(bookingRequests.status, [...pendingStatuses])
          : sql`${bookingRequests.status} not in ('submitted','under_review','awaiting_information','alternative_proposed')`,
      )
      .orderBy(view === "pending" ? asc(bookingRequests.createdAt) : desc(bookingRequests.decidedAt))
      .limit(100);
  });
}

export async function countPendingRequests(ctx: ClinicContext) {
  if (!ctx.permissions.includes("appointment.read")) return 0;
  return tenantTx(ctx, async (tx) => {
    const [r] = await tx.select({ n: count() }).from(bookingRequests).where(inArray(bookingRequests.status, ["submitted", "under_review"]));
    return r?.n ?? 0;
  });
}

async function lockPending(tx: Tx, id: string) {
  const [req] = await tx.select().from(bookingRequests).where(eq(bookingRequests.id, id)).for("update");
  if (!req) throw new BookingError("notFound");
  if (!["submitted", "under_review", "awaiting_information", "alternative_proposed"].includes(req.status)) throw new BookingError("alreadyDecided");
  return req;
}

export type UpdateBookingRequestInput = {
  appointmentTypeId: string;
  providerId: string;
  date: string;
  time: string;
  durationMin: number;
};

/** Corrects a pending request without creating an appointment. Approval still performs the final booking check. */
export async function updateBookingRequest(ctx: ClinicContext, id: string, input: UpdateBookingRequestInput, expectedVersion: number) {
  requirePermission(ctx, "booking.approve");
  requirePermission(ctx, "appointment.manage");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || !/^\d{2}:\d{2}$/.test(input.time)) throw new BookingError("invalidSlot");
  if (!Number.isInteger(input.durationMin) || input.durationMin < 5 || input.durationMin > 480) throw new BookingError("invalidDuration");
  const startsAt = zonedToUtc(input.date, input.time, ctx.organization.timezone);
  if (startsAt.getTime() <= Date.now()) throw new BookingError("requestExpired");
  const endsAt = new Date(startsAt.getTime() + input.durationMin * 60_000);
  try {
    return await tenantTx(ctx, async (tx) => {
      const current = await lockPending(tx, id);
      if (current.version !== expectedVersion) throw new BookingError("staleVersion");
      const [type] = await tx.select({ id: appointmentTypes.id }).from(appointmentTypes)
        .where(and(eq(appointmentTypes.id, input.appointmentTypeId), eq(appointmentTypes.isActive, true))).limit(1);
      if (!type) throw new BookingError("typeUnavailable");
      await validateAppointmentSlot(tx, ctx, {
        patientId: id,
        providerId: input.providerId,
        chairId: null,
        appointmentTypeId: input.appointmentTypeId,
        date: input.date,
        time: input.time,
        durationMin: input.durationMin,
        notes: null,
        outsideHoursOverride: false,
      }, startsAt, endsAt);
      const [conflict] = await tx.select({ id: appointments.id }).from(appointments).where(and(
        eq(appointments.providerId, input.providerId),
        eq(appointments.schedulingStatus, "booked"),
        lt(appointments.startsAt, endsAt),
        gt(appointments.endsAt, startsAt),
      )).limit(1);
      if (conflict) throw new BookingError("slotTaken");
      const updated = await tx.update(bookingRequests).set({
        appointmentTypeId: input.appointmentTypeId,
        providerId: input.providerId,
        requestedStartsAt: startsAt,
        requestedEndsAt: endsAt,
        expiresAt: startsAt,
        status: "under_review",
        version: sql`${bookingRequests.version} + 1`,
        updatedAt: new Date(),
      }).where(and(eq(bookingRequests.id, id), eq(bookingRequests.version, expectedVersion))).returning({ id: bookingRequests.id });
      if (!updated.length) throw new BookingError("staleVersion");
      await audit(tx, {
        ...staff(ctx), action: "booking_request.updated", entityType: "booking_request", entityId: id,
        metadata: { from: current.requestedStartsAt.toISOString(), to: startsAt.toISOString(), fromProvider: current.providerId, toProvider: input.providerId, appointmentTypeId: input.appointmentTypeId },
      });
    });
  } catch (error) {
    if (error instanceof AgendaError) {
      if (["providerUnavailable", "timeOff", "outsideHours"].includes(error.code)) throw new BookingError(error.code);
      throw new BookingError("invalidSlot");
    }
    throw error;
  }
}

/**
 * Approves a request for an existing clinic patient chosen by staff. Locks the
 * request (one approval only) and books through the same availability checks
 * and exclusion constraints as staff booking; a taken slot leaves it pending.
 */
export async function approveBookingRequest(ctx: ClinicContext, id: string, patientId: string) {
  requirePermission(ctx, "booking.approve");
  requirePermission(ctx, "appointment.manage");
  try {
    return await tenantTx(ctx, async (tx) => {
      const req = await lockPending(tx, id);
      const tz = ctx.organization.timezone;
      const [chair] = await tx.select({ id: chairs.id }).from(chairs).where(eq(chairs.isActive, true)).orderBy(asc(chairs.sortOrder), asc(chairs.name)).limit(1);
      const appointmentId = await bookInTx(tx, ctx, {
        patientId,
        providerId: req.providerId,
        chairId: chair?.id ?? null,
        appointmentTypeId: req.appointmentTypeId,
        date: todayInZone(tz, req.requestedStartsAt),
        time: timeInZone(req.requestedStartsAt, tz),
        durationMin: Math.round((req.requestedEndsAt.getTime() - req.requestedStartsAt.getTime()) / 60_000),
        notes: req.message,
        outsideHoursOverride: false,
      });
      await tx
        .update(bookingRequests)
        .set({ status: "approved", patientId, appointmentId, decidedByUserId: ctx.userId, decidedAt: new Date() })
        .where(eq(bookingRequests.id, id));
      // Staff confirmed the slot with the patient's own request: confirmation is recorded.
      await tx.update(appointments).set({ confirmationStatus: "confirmed" }).where(eq(appointments.id, appointmentId));
      await audit(tx, { ...staff(ctx), action: "booking_request.approved", entityType: "booking_request", entityId: id, patientId, metadata: { appointmentId } });
      return appointmentId;
    });
  } catch (err) {
    const conflict = conflictFrom(err);
    if (conflict) throw new BookingError("slotTaken");
    if (err instanceof AgendaError) throw new BookingError(err.code === "pastDate" ? "requestExpired" : "slotTaken");
    throw err;
  }
}

export async function declineBookingRequest(ctx: ClinicContext, id: string, reason: string) {
  requirePermission(ctx, "booking.approve");
  if (!reason.trim()) throw new BookingError("reasonRequired");
  return tenantTx(ctx, async (tx) => {
    await lockPending(tx, id);
    await tx.update(bookingRequests).set({ status: "declined", declineReason: reason.trim(), decidedByUserId: ctx.userId, decidedAt: new Date() }).where(eq(bookingRequests.id, id));
    await audit(tx, { ...staff(ctx), action: "booking_request.declined", entityType: "booking_request", entityId: id });
  });
}

export async function listBookingLinks(ctx: ClinicContext) {
  requirePermission(ctx, "appointment.read");
  return tenantTx(ctx, (tx) => tx.select().from(bookingLinks).orderBy(desc(bookingLinks.createdAt)));
}

export async function createBookingLink(ctx: ClinicContext, label: string) {
  requirePermission(ctx, "appointment.manage");
  if (!ctx.organization.enabledModules.includes("online_booking") && ctx.organization.enabledModules.length > 0) throw new BookingError("moduleDisabled");
  return tenantTx(ctx, async (tx) => {
    const types = await tx.select({ id: appointmentTypes.id }).from(appointmentTypes).where(and(eq(appointmentTypes.isActive, true), eq(appointmentTypes.isBookableOnline, true)));
    if (!types.length) throw new BookingError("noBookableTypes");
    const token = randomBytes(18).toString("base64url");
    const [l] = await tx
      .insert(bookingLinks)
      .values({ organizationId: ctx.organizationId, token, label: label.trim() || ctx.organization.name, appointmentTypeIds: types.map((t) => t.id), createdByUserId: ctx.userId })
      .returning({ id: bookingLinks.id });
    await audit(tx, { ...staff(ctx), action: "booking_link.created", entityType: "booking_link", entityId: l!.id });
    return token;
  });
}

export async function setBookingLinkActive(ctx: ClinicContext, id: string, active: boolean) {
  requirePermission(ctx, "appointment.manage");
  return tenantTx(ctx, async (tx) => {
    await tx.update(bookingLinks).set({ isActive: active }).where(eq(bookingLinks.id, id));
    await audit(tx, { ...staff(ctx), action: active ? "booking_link.activated" : "booking_link.deactivated", entityType: "booking_link", entityId: id });
  });
}

/**
 * Creates a clinic patient from the request contact details. Runs the usual
 * clinic-local duplicate check; staff picks an existing record when offered.
 * (The patient's self-declaration "already a patient" is never used to match.)
 */
export async function createPatientFromRequest(ctx: ClinicContext, id: string, opts: { confirmNotDuplicate?: boolean } = {}) {
  requirePermission(ctx, "patient.create");
  const req = await tenantTx(ctx, async (tx) => (await tx.select().from(bookingRequests).where(eq(bookingRequests.id, id)))[0]);
  if (!req) throw new BookingError("notFound");
  const parts = req.contactName.trim().split(/\s+/);
  const lastName = parts.length > 1 ? parts[parts.length - 1]! : parts[0]!;
  const firstName = parts.length > 1 ? parts.slice(0, -1).join(" ") : "—";
  const { createPatient } = await import("@/features/patients/server");
  return createPatient(
    ctx,
    {
      firstName,
      lastName,
      firstNameAr: null,
      lastNameAr: null,
      sex: undefined,
      birthDate: null,
      birthDatePrecision: "exact",
      phone: req.contactPhone,
      phoneAlt: null,
      email: req.contactEmail,
      addressLine: null,
      city: null,
      region: null,
      preferredLocale: (["fr", "en", "ar"] as const).find((l) => l === req.preferredLocale) ?? "fr",
      emergencyName: null,
      emergencyRelationship: null,
      emergencyPhone: null,
      acquisitionChannel: req.acquisitionChannel,
      referralSource: "Réservation en ligne",
      referredBy: null,
      administrativeNotes: null,
      assignedProviderId: null,
    },
    opts,
  );
}
