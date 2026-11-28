import "server-only";
import { and, asc, desc, eq, inArray, isNotNull, lt, sql } from "drizzle-orm";
import { audit } from "@/server/audit";
import { requirePermission, tenantTx, type ClinicContext } from "@/server/auth/context";
import { branches, organizations, outboundMessages, patients, type ReminderParams } from "@/server/db/schema";
import { withDbContext } from "@/server/db/tenant";
import { sendWhatsAppTemplate, templateLanguage, whatsAppConfig, type SendResult, type WhatsAppConfig, type WhatsAppStatusEvent } from "@/server/whatsapp";
import { addDays, timeInZone, todayInZone, zonedToUtc } from "@/lib/dates";
import { formatPhone, normalizePhone } from "@/lib/phone";
import { asMessageLocale, messageDate } from "@/features/follow-ups/messages";

/**
 * Automatic WhatsApp appointment reminders (module `whatsapp_reminders`). Once a day (Vercel Cron, see vercel.json)
 * every clinic that switched them on gets one message per booked appointment of the next day, through the platform's
 * WhatsApp Cloud API account and an approved template. One row per message in `outbound_messages`: never sent twice
 * for the same appointment time, never sent to a patient who opted out, shown as sent only once WhatsApp accepted it.
 */

export const MAX_ATTEMPTS = 3;
/** Never send (or retry) a reminder for an appointment starting sooner than this. */
const MIN_LEAD_MS = 2 * 3_600_000;

export class ReminderError extends Error {
  constructor(public readonly code: "notConfigured" | "noClinicPhone" | "invalidPhone" | "sendFailed") {
    super(code);
  }
}

const staff = (ctx: ClinicContext) => ({ organizationId: ctx.organizationId, actorType: "staff" as const, actorUserId: ctx.userId });

/** Template variables in order: {{1}} first name, {{2}} clinic, {{3}} date, {{4}} time, {{5}} clinic phone. */
export const reminderParamList = (p: ReminderParams) => [p.firstName, p.clinic, p.date, p.time, p.clinicPhone];

export async function getAutoReminders(ctx: ClinicContext) {
  requirePermission(ctx, "reminders.auto.manage");
  return tenantTx(ctx, async (tx) => {
    const [org] = await tx.select({ settings: organizations.settings }).from(organizations).where(eq(organizations.id, ctx.organizationId)).limit(1);
    const [phones, recent, counts] = await Promise.all([
      tx.select({ id: branches.id, name: branches.name, phone: branches.phone }).from(branches).where(eq(branches.isActive, true)).orderBy(asc(branches.createdAt)),
      tx
        .select({ m: outboundMessages, firstName: patients.firstName, lastName: patients.lastName })
        .from(outboundMessages)
        .innerJoin(patients, eq(patients.id, outboundMessages.patientId))
        .orderBy(desc(outboundMessages.createdAt))
        .limit(60),
      tx
        .select({ status: outboundMessages.status, n: sql<number>`count(*)::int` })
        .from(outboundMessages)
        .where(sql`${outboundMessages.createdAt} > now() - interval '30 days'`)
        .groupBy(outboundMessages.status),
    ]);
    return {
      configured: whatsAppConfig() !== null,
      enabled: org?.settings.autoReminders?.enabled === true,
      branches: phones,
      hasPhone: phones.some((b) => normalizePhone(b.phone, ctx.organization.countryCode)),
      recent: recent.map((r) => ({ ...r.m, patientName: `${r.lastName} ${r.firstName}` })),
      last30Days: Object.fromEntries(counts.map((c) => [c.status, c.n])) as Partial<Record<"queued" | "sent" | "delivered" | "read" | "failed", number>>,
    };
  });
}

export async function setAutoReminders(ctx: ClinicContext, enabled: boolean) {
  requirePermission(ctx, "reminders.auto.manage");
  return tenantTx(ctx, async (tx) => {
    if (enabled) {
      const phones = await tx.select({ phone: branches.phone }).from(branches).where(eq(branches.isActive, true));
      if (!phones.some((b) => normalizePhone(b.phone, ctx.organization.countryCode))) throw new ReminderError("noClinicPhone");
    }
    await tx
      .update(organizations)
      .set({ settings: sql`${organizations.settings} || ${JSON.stringify({ autoReminders: { enabled } })}::jsonb` })
      .where(eq(organizations.id, ctx.organizationId));
    await audit(tx, { ...staff(ctx), action: enabled ? "reminders.auto_enabled" : "reminders.auto_disabled", entityType: "organization", entityId: ctx.organizationId });
  });
}

/** Sends the reminder template with sample values to a number the owner types, to check the setup end to end. */
export async function sendTestReminder(ctx: ClinicContext, phoneInput: string, fetchImpl?: typeof fetch) {
  requirePermission(ctx, "reminders.auto.manage");
  const config = whatsAppConfig();
  if (!config) throw new ReminderError("notConfigured");
  const to = normalizePhone(phoneInput, ctx.organization.countryCode);
  if (!to) throw new ReminderError("invalidPhone");
  const tz = ctx.organization.timezone;
  const locale = asMessageLocale(ctx.user.locale);
  const clinicPhone = await tenantTx(ctx, async (tx) => {
    const rows = await tx.select({ phone: branches.phone }).from(branches).where(eq(branches.isActive, true)).orderBy(asc(branches.createdAt));
    return rows.map((r) => normalizePhone(r.phone, ctx.organization.countryCode)).find(Boolean) ?? null;
  });
  if (!clinicPhone) throw new ReminderError("noClinicPhone");
  const params: ReminderParams = {
    firstName: ctx.user.fullName.split(/\s+/)[0] || ctx.user.fullName,
    clinic: ctx.organization.name,
    date: messageDate(addDays(todayInZone(tz), 1), locale),
    time: "10:00",
    clinicPhone: formatPhone(clinicPhone, ctx.organization.countryCode),
  };
  const result = await sendWhatsAppTemplate(config, { toE164: to, language: templateLanguage(config, locale), params: reminderParamList(params) }, fetchImpl);
  await tenantTx(ctx, (tx) => audit(tx, { ...staff(ctx), action: "reminders.test_sent", entityType: "organization", entityId: ctx.organizationId, metadata: { ok: result.ok, code: result.ok ? null : result.code } }));
  if (!result.ok) return { ok: false as const, code: result.code, title: result.title };
  return { ok: true as const };
}

type Sender = (config: WhatsAppConfig, input: { toE164: string; language: string; params: string[] }) => Promise<SendResult>;

/**
 * The daily run (cron). For each clinic with reminders on: queue tomorrow's reminders (once per appointment time),
 * then send what is queued. Retries a failed send (network, throttling) on later runs while the appointment is
 * more than two hours away, up to MAX_ATTEMPTS. Returns counts only.
 */
export async function runAutoReminders(opts: { now?: Date; send?: Sender; config?: WhatsAppConfig | null } = {}) {
  const now = opts.now ?? new Date();
  const config = opts.config === undefined ? whatsAppConfig() : opts.config;
  const send: Sender = opts.send ?? ((c, input) => sendWhatsAppTemplate(c, input));
  const summary = { clinics: 0, queued: 0, sent: 0, failed: 0, skipped: 0, notConfigured: config === null };
  if (!config) return summary;
  const clinics = await withDbContext({ actorType: "system" }, (tx) =>
    tx.execute<{ organization_id: string; name: string; timezone: string }>(sql`select * from app_private.auto_reminder_clinics()`));

  for (const clinic of clinics) {
    summary.clinics += 1;
    const tz = clinic.timezone;
    const tomorrow = addDays(todayInZone(tz, now), 1);
    await withDbContext({ organizationId: clinic.organization_id, actorType: "system" }, async (tx) => {
      const [org] = await tx.select({ countryCode: organizations.countryCode }).from(organizations).where(eq(organizations.id, clinic.organization_id)).limit(1);
      const country = org?.countryCode ?? "DZ";
      const branchRows = await tx.select({ id: branches.id, phone: branches.phone, createdAt: branches.createdAt }).from(branches).orderBy(asc(branches.createdAt));
      const fallbackPhone = branchRows.map((b) => normalizePhone(b.phone, country)).find(Boolean) ?? null;
      const phoneOf = (branchId: string) => normalizePhone(branchRows.find((b) => b.id === branchId)?.phone, country) ?? fallbackPhone;

      const due = await tx.execute<{ appointment_id: string; starts_at: Date; branch_id: string; patient_id: string; first_name: string; phone: string; preferred_locale: string | null }>(sql`
        select a.id as appointment_id, a.starts_at, a.branch_id, p.id as patient_id, p.first_name, p.phone, p.preferred_locale
          from appointments a
          join patients p on p.id = a.patient_id
         where a.scheduling_status = 'booked' and a.confirmation_status <> 'declined'
           and a.starts_at >= ${zonedToUtc(tomorrow, "00:00", tz).toISOString()}::timestamptz
           and a.starts_at < ${zonedToUtc(addDays(tomorrow, 1), "00:00", tz).toISOString()}::timestamptz
           and p.status = 'active' and p.phone is not null
           and coalesce((p.communication_prefs->>'transactionalAllowed')::boolean, true)
         order by a.starts_at`);
      for (const a of due) {
        const to = normalizePhone(a.phone, country);
        const clinicPhone = phoneOf(a.branch_id);
        if (!to || !clinicPhone) {
          summary.skipped += 1;
          continue;
        }
        const locale = asMessageLocale(a.preferred_locale);
        const startsAt = new Date(a.starts_at);
        const params: ReminderParams = {
          firstName: a.first_name,
          clinic: clinic.name,
          date: messageDate(tomorrow, locale),
          time: timeInZone(startsAt, tz),
          clinicPhone: formatPhone(clinicPhone, country),
        };
        const inserted = await tx
          .insert(outboundMessages)
          .values({
            organizationId: clinic.organization_id,
            patientId: a.patient_id,
            appointmentId: a.appointment_id,
            kind: "appointment_reminder",
            channel: "whatsapp",
            appointmentStartsAt: startsAt,
            toE164: to,
            locale: templateLanguage(config, locale),
            templateName: config.template,
            params,
          })
          .onConflictDoNothing()
          .returning({ id: outboundMessages.id });
        summary.queued += inserted.length;
      }

      // Send everything still queued whose appointment is still booked at the same time and far enough away.
      const pending = await tx
        .select({ m: outboundMessages, schedulingStatus: sql<string>`a.scheduling_status`, startsAt: sql<Date>`a.starts_at`, allowed: sql<boolean>`coalesce((p.communication_prefs->>'transactionalAllowed')::boolean, true) and p.status = 'active'` })
        .from(outboundMessages)
        .innerJoin(sql`appointments a`, sql`a.id = ${outboundMessages.appointmentId}`)
        .innerJoin(sql`patients p`, sql`p.id = ${outboundMessages.patientId}`)
        .where(and(eq(outboundMessages.status, "queued"), lt(outboundMessages.attempts, MAX_ATTEMPTS), isNotNull(outboundMessages.appointmentId)))
        .orderBy(asc(outboundMessages.createdAt));
      for (const { m, schedulingStatus, startsAt, allowed } of pending) {
        const moved = new Date(startsAt).getTime() !== m.appointmentStartsAt?.getTime();
        if (schedulingStatus !== "booked" || moved || !allowed || new Date(startsAt).getTime() - now.getTime() < MIN_LEAD_MS) {
          await tx
            .update(outboundMessages)
            .set({ status: "failed", failedAt: now, updatedAt: now, errorCode: !allowed ? "opted_out" : moved || schedulingStatus !== "booked" ? "appointment_changed" : "too_late", errorTitle: null })
            .where(eq(outboundMessages.id, m.id));
          summary.skipped += 1;
          continue;
        }
        const result = await send(config, { toE164: m.toE164, language: m.locale, params: reminderParamList(m.params) });
        const attempts = m.attempts + 1;
        if (result.ok) {
          await tx.update(outboundMessages).set({ status: "sent", providerMessageId: result.providerMessageId, attempts, sentAt: now, updatedAt: now, errorCode: null, errorTitle: null }).where(eq(outboundMessages.id, m.id));
          summary.sent += 1;
        } else if (result.retryable && attempts < MAX_ATTEMPTS) {
          await tx.update(outboundMessages).set({ attempts, updatedAt: now, errorCode: result.code, errorTitle: result.title }).where(eq(outboundMessages.id, m.id));
        } else {
          await tx.update(outboundMessages).set({ status: "failed", attempts, failedAt: now, updatedAt: now, errorCode: result.code, errorTitle: result.title }).where(eq(outboundMessages.id, m.id));
          summary.failed += 1;
        }
      }
    });
  }
  return summary;
}

/** Applies delivery receipts from the WhatsApp webhook (sent / delivered / read / failed). */
export async function applyWhatsAppStatuses(events: WhatsAppStatusEvent[]) {
  let matched = 0;
  for (const e of events) {
    const rows = await withDbContext({ actorType: "system" }, (tx) =>
      tx.execute<{ ok: boolean }>(sql`select app_private.whatsapp_status_update(${e.providerMessageId}, ${e.status}, ${e.at.toISOString()}::timestamptz, ${e.errorCode}, ${e.errorTitle}) as ok`));
    if (rows[0]?.ok) matched += 1;
  }
  return matched;
}

/** Latest automatic reminder per appointment, for the follow-up cards (status only). */
export async function autoReminderStatuses(ctx: ClinicContext, appointmentIds: string[]) {
  requirePermission(ctx, "patient.followup");
  if (!appointmentIds.length) return new Map<string, { status: string; at: Date }>();
  return tenantTx(ctx, async (tx) => {
    const rows = await tx
      .select({ appointmentId: outboundMessages.appointmentId, status: outboundMessages.status, at: outboundMessages.updatedAt })
      .from(outboundMessages)
      .where(inArray(outboundMessages.appointmentId, appointmentIds))
      .orderBy(asc(outboundMessages.createdAt));
    const map = new Map<string, { status: string; at: Date }>();
    for (const r of rows) if (r.appointmentId) map.set(r.appointmentId, { status: r.status, at: r.at });
    return map;
  });
}
