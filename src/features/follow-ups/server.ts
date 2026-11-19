import "server-only";

import { and, asc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { safeHttpsUrl } from "@/features/public-page/helpers";
import { addDays, zonedToUtc } from "@/lib/dates";
import { normalizePhone } from "@/lib/phone";
import { audit } from "@/server/audit";
import { can, requirePermission, tenantTx, type ClinicContext } from "@/server/auth/context";
import { appointments, bookingLinks, branches, organizations, patientContacts, patients, serviceCategories, treatmentPlans } from "@/server/db/schema";
import type { ContactChannel, ContactOutcome, FollowUpReason, MessageLocale } from "./messages";
import { asMessageLocale } from "./messages";
import type { FollowUpSettingsInput, LogContactInput } from "./schemas";

export class FollowUpError extends Error {
  constructor(public readonly code: string, public readonly fieldErrors?: Record<string, string>) { super(code); }
}

export const DEFAULT_RECALL_MONTHS = 6;
/** A patient contacted for the same reason is hidden for this many days (recall: longer). */
const SNOOZE_DAYS: Record<Exclude<FollowUpReason, "appointment_reminder" | "after_visit" | "referral_thanks">, number> = { recall: 30, treatment_followup: 14, estimate_followup: 14, no_show: 14 };
/** Referrers are thanked for patients created within this window. */
const THANKS_WINDOW_DAYS = 60;
/** Plans become follow-ups only after this many days without a booked appointment. */
const PLAN_GRACE_DAYS = 3;
const LIMIT = 100;

const staff = (ctx: ClinicContext) => ({ organizationId: ctx.organizationId, actorType: "staff" as const, actorUserId: ctx.userId });

export type LastContact = { at: string; channel: ContactChannel; outcome: ContactOutcome; by: string } | null;
export type FollowUpPatient = {
  patientId: string; patientNumber: string; firstName: string; lastName: string; firstNameAr: string | null;
  phone: string | null; locale: MessageLocale; contactAllowed: boolean; lastContact: LastContact;
};
export type ReminderRow = FollowUpPatient & { appointmentId: string; branchId: string; date: string; time: string; provider: string; confirmation: string };
export type RecallRow = FollowUpPatient & { lastVisit: string };
export type PlanRow = FollowUpPatient & { planId: string; since: string; title: string | null; totalMinor: number | null; currency: string; remaining: number };
export type NoShowRow = FollowUpPatient & { appointmentId: string; branchId: string; date: string; time: string; provider: string };
export type AfterVisitRow = FollowUpPatient & { visitDate: string; categoryIds: string[] };
export type ThanksRow = FollowUpPatient & { referredCount: number; latestReferral: string };

type RawPatient = {
  patient_id: string; patient_number: string; first_name: string; last_name: string; first_name_ar: string | null;
  phone: string | null; preferred_locale: string; contact_allowed: boolean;
  contact_at: string | null; contact_channel: ContactChannel | null; contact_outcome: ContactOutcome | null; contact_by: string | null;
};

const patientCols = sql`p.id as patient_id, p.patient_number, p.first_name, p.last_name, p.first_name_ar, p.phone,
  p.preferred_locale, coalesce((p.communication_prefs->>'transactionalAllowed')::boolean, true) as contact_allowed,
  lc.at as contact_at, lc.channel as contact_channel, lc.outcome as contact_outcome, lc.by_name as contact_by`;

/** Latest contact for this patient, reason and (optional) appointment/plan, as `lc`. */
function lastContactJoin(tz: string, reason: FollowUpReason, ref: SQL) {
  return sql`left join lateral (
    select to_char(c.created_at at time zone ${tz}, 'YYYY-MM-DD HH24:MI') as at, c.channel::text as channel,
           c.outcome::text as outcome, u.full_name as by_name, c.created_at as created
      from patient_contacts c join users u on u.id = c.created_by_user_id
     where c.patient_id = p.id and c.reason = ${reason}::follow_up_reason and ${ref}
     order by c.created_at desc limit 1) lc on true`;
}

/** Hidden while recently contacted, and for 6 months after the patient declined. */
function notSnoozed(days: number) {
  return sql`(lc.created is null or (lc.created < now() - make_interval(days => ${days})
    and not (lc.outcome = 'declined' and lc.created > now() - interval '180 days')))`;
}

const noFutureAppointment = sql`not exists (select 1 from appointments fa
  where fa.patient_id = p.id and fa.scheduling_status = 'booked' and fa.starts_at >= now())`;
const contactAllowed = sql`coalesce((p.communication_prefs->>'transactionalAllowed')::boolean, true)`;

function mapPatient(r: RawPatient): FollowUpPatient {
  return {
    patientId: r.patient_id, patientNumber: r.patient_number, firstName: r.first_name, lastName: r.last_name,
    firstNameAr: r.first_name_ar, phone: r.phone, locale: asMessageLocale(r.preferred_locale), contactAllowed: r.contact_allowed,
    lastContact: r.contact_at ? { at: r.contact_at, channel: r.contact_channel!, outcome: r.contact_outcome!, by: r.contact_by ?? "" } : null,
  };
}

/** First day after today (within a week) that has booked appointments; tomorrow when there are none. */
export async function suggestReminderDate(ctx: ClinicContext, today: string) {
  requirePermission(ctx, "patient.followup");
  const tz = ctx.organization.timezone;
  const from = zonedToUtc(addDays(today, 1), "00:00", tz).toISOString();
  const to = zonedToUtc(addDays(today, 8), "00:00", tz).toISOString();
  const [row] = await tenantTx(ctx, (tx) => tx.execute<{ day: string | null }>(sql`
    select to_char(min(starts_at) at time zone ${tz}, 'YYYY-MM-DD') as day from appointments
     where scheduling_status = 'booked' and starts_at >= ${from}::timestamptz and starts_at < ${to}::timestamptz`));
  return row?.day ?? addDays(today, 1);
}

export async function getFollowUps(ctx: ClinicContext, opts: { today: string; reminderDate: string; visitDate?: string }) {
  requirePermission(ctx, "patient.followup");
  const tz = ctx.organization.timezone;
  const recallMonths = ctx.organization.settings.followUps?.recallMonths ?? DEFAULT_RECALL_MONTHS;
  const from = zonedToUtc(opts.reminderDate, "00:00", tz).toISOString();
  const to = zonedToUtc(addDays(opts.reminderDate, 1), "00:00", tz).toISOString();
  const cutoff = sql`(${opts.today}::date - make_interval(months => ${recallMonths}))::date`;
  const showPlans = can(ctx, "treatment_plan.read");

  return tenantTx(ctx, async (tx) => {
    const reminders = await tx.execute<RawPatient & { appointment_id: string; branch_id: string; local_date: string; local_time: string; provider: string; confirmation: string }>(sql`
      select a.id as appointment_id, a.branch_id, to_char(a.starts_at at time zone ${tz}, 'YYYY-MM-DD') as local_date,
             to_char(a.starts_at at time zone ${tz}, 'HH24:MI') as local_time, m.display_name as provider,
             a.confirmation_status::text as confirmation, ${patientCols}
        from appointments a
        join patients p on p.id = a.patient_id
        join memberships m on m.id = a.provider_id
        ${lastContactJoin(tz, "appointment_reminder", sql`c.appointment_id = a.id`)}
       where a.scheduling_status = 'booked' and a.starts_at >= ${from}::timestamptz and a.starts_at < ${to}::timestamptz
       order by a.starts_at, p.last_name`);

    const recall = await tx.execute<RawPatient & { last_visit: string }>(sql`
      select to_char(lv.last_visit, 'YYYY-MM-DD') as last_visit, ${patientCols}
        from patients p
        cross join lateral (select greatest(
          (select max(pp.service_date) from performed_procedures pp where pp.patient_id = p.id and pp.status = 'completed'),
          (select max((va.starts_at at time zone ${tz})::date) from appointments va where va.patient_id = p.id and va.visit_status = 'completed')
        ) as last_visit) lv
        ${lastContactJoin(tz, "recall", sql`true`)}
       where p.status = 'active' and lv.last_visit is not null and lv.last_visit <= ${cutoff}
         and ${noFutureAppointment} and ${contactAllowed} and ${notSnoozed(SNOOZE_DAYS.recall)}
       order by lv.last_visit desc, p.last_name limit ${LIMIT}`);

    const plans = async (status: "accepted" | "proposed", reason: "treatment_followup" | "estimate_followup") =>
      tx.execute<RawPatient & { plan_id: string; since: string; title: string; total_minor: string; currency: string; remaining: number }>(sql`
        select tp.id as plan_id, to_char(tp.updated_at at time zone ${tz}, 'YYYY-MM-DD') as since, v.title,
               v.total_minor::text as total_minor, v.currency,
               (select count(*) from treatment_plan_items i where i.version_id = v.id
                  and not exists (select 1 from treatment_plan_conversions cv where cv.item_id = i.id))::int as remaining,
               ${patientCols}
          from treatment_plans tp
          join treatment_plan_versions v on v.plan_id = tp.id and v.version_number = tp.current_version
          join patients p on p.id = tp.patient_id
          ${lastContactJoin(tz, reason, sql`c.treatment_plan_id = tp.id`)}
         where tp.status = ${status}::treatment_plan_status and p.status = 'active'
           and tp.updated_at < now() - make_interval(days => ${PLAN_GRACE_DAYS})
           and ${noFutureAppointment} and ${contactAllowed} and ${notSnoozed(SNOOZE_DAYS[reason])}
         order by tp.updated_at limit ${LIMIT}`);
    const treatments = await plans("accepted", "treatment_followup");
    const estimates = await plans("proposed", "estimate_followup");

    const noShows = await tx.execute<RawPatient & { appointment_id: string; branch_id: string; local_date: string; local_time: string; provider: string }>(sql`
      select distinct on (p.id) a.id as appointment_id, a.branch_id, to_char(a.starts_at at time zone ${tz}, 'YYYY-MM-DD') as local_date,
             to_char(a.starts_at at time zone ${tz}, 'HH24:MI') as local_time, m.display_name as provider, ${patientCols}
        from appointments a
        join patients p on p.id = a.patient_id
        join memberships m on m.id = a.provider_id
        ${lastContactJoin(tz, "no_show", sql`c.appointment_id = a.id`)}
       where a.scheduling_status = 'no_show' and a.starts_at >= now() - interval '30 days' and p.status = 'active'
         and ${noFutureAppointment} and ${contactAllowed} and ${notSnoozed(SNOOZE_DAYS.no_show)}
       order by p.id, a.starts_at desc limit ${LIMIT}`);

    // Visits = days with completed procedures (with or without an appointment); one row per patient.
    const afterVisit = await tx.execute<RawPatient & { visit_date: string; category_ids: string[] }>(sql`
      select to_char(v.service_date, 'YYYY-MM-DD') as visit_date, v.category_ids, ${patientCols}
        from (select pp.patient_id, pp.service_date, array_agg(distinct s.category_id::text) as category_ids
                from performed_procedures pp join services s on s.id = pp.service_id
               where pp.status = 'completed' and pp.service_date = ${opts.visitDate ?? opts.today}::date
               group by 1, 2) v
        join patients p on p.id = v.patient_id
        ${lastContactJoin(tz, "after_visit", sql`c.visit_date = v.service_date`)}
       where p.status in ('active', 'inactive')
       order by p.last_name, p.first_name`);

    // Patients who recommended someone recently; hidden once thanked after their latest referral.
    const thanks = await tx.execute<RawPatient & { referred_count: number; latest_referral: string }>(sql`
      select ref.n as referred_count, to_char(ref.latest at time zone ${tz}, 'YYYY-MM-DD') as latest_referral, ${patientCols}
        from (select referred_by_patient_id as id, count(*)::int as n, max(created_at) as latest from patients
               where referred_by_patient_id is not null and created_at >= now() - make_interval(days => ${THANKS_WINDOW_DAYS})
               group by 1) ref
        join patients p on p.id = ref.id
        ${lastContactJoin(tz, "referral_thanks", sql`true`)}
       where p.status = 'active' and ${contactAllowed} and (lc.created is null or lc.created < ref.latest)
       order by ref.latest desc limit ${LIMIT}`);

    const planRow = (r: RawPatient & { plan_id: string; since: string; title: string; total_minor: string; currency: string; remaining: number }): PlanRow => ({
      ...mapPatient(r), planId: r.plan_id, since: r.since, remaining: Number(r.remaining), currency: r.currency,
      title: showPlans ? r.title : null, totalMinor: showPlans ? Number(r.total_minor) : null,
    });
    return {
      recallMonths,
      reminders: reminders.map((r): ReminderRow => ({ ...mapPatient(r), appointmentId: r.appointment_id, branchId: r.branch_id, date: r.local_date, time: r.local_time, provider: r.provider, confirmation: r.confirmation })),
      recall: recall.map((r): RecallRow => ({ ...mapPatient(r), lastVisit: r.last_visit })),
      treatments: treatments.map(planRow),
      estimates: estimates.map(planRow),
      afterVisit: afterVisit.map((r): AfterVisitRow => ({ ...mapPatient(r), visitDate: r.visit_date, categoryIds: r.category_ids ?? [] })),
      thanks: thanks.map((r): ThanksRow => ({ ...mapPatient(r), referredCount: Number(r.referred_count), latestReferral: r.latest_referral })),
      noShows: noShows
        .map((r): NoShowRow => ({ ...mapPatient(r), appointmentId: r.appointment_id, branchId: r.branch_id, date: r.local_date, time: r.local_time, provider: r.provider }))
        .sort((a, b) => `${b.date}${b.time}`.localeCompare(`${a.date}${a.time}`)),
    };
  });
}

/** Clinic name, phones per branch and the first active booking link, for message templates. */
export async function getMessageContext(ctx: ClinicContext) {
  requirePermission(ctx, "patient.followup");
  return tenantTx(ctx, async (tx) => {
    const [branchRows, [link]] = await Promise.all([
      tx.select({ id: branches.id, phone: branches.phone }).from(branches).where(eq(branches.isActive, true)).orderBy(asc(branches.createdAt)),
      tx.select({ token: bookingLinks.token }).from(bookingLinks).where(eq(bookingLinks.isActive, true)).orderBy(asc(bookingLinks.createdAt)).limit(1),
    ]);
    return {
      clinicName: ctx.organization.name,
      phones: new Map(branchRows.map((b) => [b.id, b.phone])),
      defaultPhone: branchRows.find((b) => b.phone)?.phone ?? null,
      bookingToken: link?.token ?? null,
    };
  });
}

export async function logPatientContact(ctx: ClinicContext, input: LogContactInput) {
  requirePermission(ctx, "patient.followup");
  return tenantTx(ctx, async (tx) => {
    const [patient] = await tx.select({ id: patients.id }).from(patients).where(eq(patients.id, input.patientId)).limit(1);
    if (!patient) throw new FollowUpError("patientUnavailable");
    if (input.appointmentId) {
      const [a] = await tx.select({ id: appointments.id }).from(appointments)
        .where(and(eq(appointments.id, input.appointmentId), eq(appointments.patientId, input.patientId))).limit(1);
      if (!a) throw new FollowUpError("referenceUnavailable");
    }
    if (input.reason === "after_visit") {
      const [visit] = await tx.execute<{ ok: number }>(sql`select 1 as ok from performed_procedures
        where patient_id = ${input.patientId} and service_date = ${input.visitDate}::date and status = 'completed' limit 1`);
      if (!visit) throw new FollowUpError("referenceUnavailable");
    }
    if (input.treatmentPlanId) {
      const [p] = await tx.select({ id: treatmentPlans.id }).from(treatmentPlans)
        .where(and(eq(treatmentPlans.id, input.treatmentPlanId), eq(treatmentPlans.patientId, input.patientId))).limit(1);
      if (!p) throw new FollowUpError("referenceUnavailable");
    }
    const [row] = await tx.insert(patientContacts).values({
      organizationId: ctx.organizationId, patientId: input.patientId, reason: input.reason, channel: input.channel,
      outcome: input.outcome, appointmentId: input.appointmentId, treatmentPlanId: input.treatmentPlanId, visitDate: input.visitDate ?? null, note: input.note,
      createdByUserId: ctx.userId,
    }).returning({ id: patientContacts.id });
    await audit(tx, {
      ...staff(ctx), action: "patient.contact_logged", entityType: "patient_contact", entityId: row!.id, patientId: input.patientId,
      metadata: { reason: input.reason, channel: input.channel, outcome: input.outcome },
    });
    return row!.id;
  });
}

export async function getFollowUpSettings(ctx: ClinicContext) {
  requirePermission(ctx, "org.settings.manage");
  const [branchRows, categories] = await tenantTx(ctx, (tx) => Promise.all([
    tx.select({ id: branches.id, name: branches.name, phone: branches.phone }).from(branches).where(eq(branches.isActive, true)).orderBy(asc(branches.createdAt)),
    tx.select({ id: serviceCategories.id, name: serviceCategories.name }).from(serviceCategories).where(eq(serviceCategories.isActive, true)).orderBy(asc(serviceCategories.sortOrder)),
  ]));
  const saved = ctx.organization.settings.followUps;
  return {
    recallMonths: saved?.recallMonths ?? DEFAULT_RECALL_MONTHS, templates: saved?.templates ?? {}, branches: branchRows,
    reviewUrl: saved?.reviewUrl ?? "", aftercare: saved?.aftercare ?? {}, categories,
  };
}

export async function saveFollowUpSettings(ctx: ClinicContext, input: FollowUpSettingsInput) {
  requirePermission(ctx, "org.settings.manage");
  const phones = input.branchPhones.map((b, index) => {
    const phone = b.phone ? normalizePhone(b.phone) : null;
    if (b.phone && !phone) throw new FollowUpError("invalidPhone", { [`branchPhones.${index}`]: "invalidPhone" });
    return { branchId: b.branchId, phone };
  });
  // Empty template = built-in default (kept out of settings so wording updates reach the clinic).
  const templates = Object.fromEntries(Object.entries(input.templates).map(([reason, byLocale]) => [
    reason, Object.fromEntries(Object.entries(byLocale).filter(([, text]) => text.trim())),
  ]).filter(([, byLocale]) => Object.keys(byLocale as object).length));
  const reviewUrl = input.reviewUrl ? safeHttpsUrl(input.reviewUrl) : null;
  if (input.reviewUrl && !reviewUrl) throw new FollowUpError("invalidUrl", { reviewUrl: "followUps.errors.invalidUrl" });
  const aftercare = Object.fromEntries(input.aftercare
    .map((a) => [a.categoryId, Object.fromEntries((["fr", "en", "ar"] as const).filter((l) => a[l]).map((l) => [l, a[l]]))] as const)
    .filter(([, texts]) => Object.keys(texts).length));
  const followUps = { recallMonths: input.recallMonths, templates, reviewUrl, aftercare };
  return tenantTx(ctx, async (tx) => {
    const categoryIds = Object.keys(aftercare);
    if (categoryIds.length) {
      const found = await tx.select({ id: serviceCategories.id }).from(serviceCategories).where(inArray(serviceCategories.id, categoryIds));
      if (found.length !== categoryIds.length) throw new FollowUpError("categoryUnavailable");
    }
    for (const b of phones) {
      const [updated] = await tx.update(branches).set({ phone: b.phone }).where(eq(branches.id, b.branchId)).returning({ id: branches.id });
      if (!updated) throw new FollowUpError("branchUnavailable");
    }
    await tx.update(organizations)
      .set({ settings: sql`${organizations.settings} || ${JSON.stringify({ followUps })}::jsonb` })
      .where(eq(organizations.id, ctx.organizationId));
    await audit(tx, {
      ...staff(ctx), action: "org.follow_up_settings", entityType: "organization", entityId: ctx.organizationId,
      metadata: { recallMonths: input.recallMonths, customTemplates: Object.keys(templates).length },
    });
  });
}
