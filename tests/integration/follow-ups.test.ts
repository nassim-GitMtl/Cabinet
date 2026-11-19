import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { cancelAppointment, createAppointment, getAgendaSetup } from "@/features/agenda/server";
import { getServicePickerData } from "@/features/catalog/server";
import { composeMessage, resolveTemplates } from "@/features/follow-ups/compose";
import { messageDate } from "@/features/follow-ups/messages";
import { FollowUpError, getFollowUpSettings, getFollowUps, getMessageContext, logPatientContact, saveFollowUpSettings, suggestReminderDate } from "@/features/follow-ups/server";
import { createPatient, updatePatient } from "@/features/patients/server";
import { getProcedureEntrySupport, recordPerformedProcedure } from "@/features/procedures/server";
import { createTreatmentPlan, decideTreatmentPlan, getTreatmentPlan, proposeTreatmentPlan } from "@/features/treatment-plans/server";
import { addDays, isoWeekday, todayInZone } from "@/lib/dates";
import { ForbiddenError } from "@/server/auth/context";
import { patientContacts } from "@/server/db/schema";
import { withDbContext } from "@/server/db/tenant";
import { contextFor, expectDbError, makeClinic } from "../support/factories";

const blank = {
  firstNameAr: null as string | null, lastNameAr: null, sex: undefined, birthDate: null, birthDatePrecision: "exact" as const, phone: null, phoneAlt: null,
  email: null, addressLine: null, city: null, region: null, preferredLocale: "fr" as "fr" | "en" | "ar", emergencyName: null, emergencyRelationship: null,
  emergencyPhone: null, referralSource: null, referredBy: null, administrativeNotes: null, assignedProviderId: null,
};

/** Runs SQL as the schema owner (test setup only: ageing rows, setting preferences). */
async function asOwner(run: (sql: import("postgres").Sql) => Promise<unknown>) {
  const postgres = (await import("postgres")).default;
  const sql = postgres(process.env.TEST_DATABASE_URL_ADMIN!, { max: 1 });
  try { await run(sql); } finally { await sql.end(); }
}

function nextWorkday(today: string) {
  let d = addDays(today, 1);
  while (![7, 1, 2, 3, 4].includes(isoWeekday(d))) d = addDays(d, 1);
  return d;
}

async function setup(name: string) {
  const ctx = await makeClinic(name);
  const [picker, support, agenda] = await Promise.all([getServicePickerData(ctx), getProcedureEntrySupport(ctx), getAgendaSetup(ctx)]);
  const service = picker.categories.flatMap((c) => c.services).find((s) => s.code === "CONS-01")!;
  const today = todayInZone(ctx.organization.timezone);
  const day = nextWorkday(today);
  const patient = async (firstName: string, extra: Partial<typeof blank> & { phone?: string | null; messagesOptOut?: boolean } = {}) => {
    const r = await createPatient(ctx, { ...blank, firstName, lastName: "Relance", phone: "0550 12 34 56", ...extra }, { confirmNotDuplicate: true });
    if (r.status !== "created") throw new Error("fixture");
    return r.id;
  };
  const visit = (patientId: string, daysAgo: number) =>
    recordPerformedProcedure(ctx, patientId, {
      serviceId: service.id, branchId: support.branches[0]!.id, performingProviderId: support.providers[0]!.id, serviceDate: addDays(today, -daysAgo),
      quantity: 1, unitPriceMinor: service.priceMinor, priceOverrideReason: null, toothNumber: null, surfaces: [], arch: null, quadrant: null,
    });
  const book = (patientId: string, time: string) =>
    createAppointment(ctx, {
      patientId, providerId: agenda.providers[0]!.id, chairId: agenda.chairs[0]!.id, appointmentTypeId: agenda.types[0]!.id,
      date: day, time, durationMin: 30, notes: null, outsideHoursOverride: false,
    });
  return { ctx, service, today, day, patient, visit, book };
}

describe("patient follow-ups", () => {
  it("builds reminder, recall and no-show lists from real visits and snoozes contacted patients", async () => {
    const f = await setup("Cabinet Relances A");
    const amina = await f.patient("Amina", { preferredLocale: "ar", firstNameAr: "أمينة" });
    const bilal = await f.patient("Bilal");
    const chahra = await f.patient("Chahra");
    const djamel = await f.patient("Djamel", { messagesOptOut: true });
    const fares = await f.patient("Fares");
    await f.visit(amina, 240);
    await f.visit(bilal, 240);
    await f.visit(chahra, 30);
    await f.visit(djamel, 240);
    const aminaAppointment = await f.book(amina, "09:00");
    const faresAppointment = await f.book(fares, "10:00");
    await cancelAppointment(f.ctx, faresAppointment, "", "no_show");

    expect(await suggestReminderDate(f.ctx, f.today)).toBe(f.day);
    let lists = await getFollowUps(f.ctx, { today: f.today, reminderDate: f.day });
    expect(lists.reminders).toMatchObject([{ patientId: amina, appointmentId: aminaAppointment, time: "09:00", confirmation: "pending", locale: "ar", lastContact: null }]);
    // Amina has an appointment, Chahra came recently, Djamel refused messages: only Bilal is due a check-up.
    expect(lists.recall.map((r) => r.patientId)).toEqual([bilal]);
    expect(lists.recall[0]!.lastVisit).toBe(addDays(f.today, -240));
    expect(lists.noShows.map((r) => r.patientId)).toEqual([fares]);

    const message = composeMessage(resolveTemplates(f.ctx), "appointment_reminder", lists.reminders[0]!, {
      ...(await getMessageContext(f.ctx)), recallMonths: lists.recallMonths, bookingUrl: null,
    });
    expect(message).toContain("أمينة");
    expect(message).toContain(messageDate(f.day, "ar"));
    expect(message).toContain("09:00");

    await logPatientContact(f.ctx, { patientId: bilal, reason: "recall", channel: "whatsapp", outcome: "message_prepared", appointmentId: null, treatmentPlanId: null, note: null });
    await logPatientContact(f.ctx, { patientId: amina, reason: "appointment_reminder", channel: "sms", outcome: "message_prepared", appointmentId: aminaAppointment, treatmentPlanId: null, note: null });
    await logPatientContact(f.ctx, { patientId: fares, reason: "no_show", channel: "phone", outcome: "no_answer", appointmentId: faresAppointment, treatmentPlanId: null, note: "Rappeler après 17 h" });
    lists = await getFollowUps(f.ctx, { today: f.today, reminderDate: f.day });
    expect(lists.recall).toEqual([]);
    expect(lists.noShows).toEqual([]);
    expect(lists.reminders[0]!.lastContact).toMatchObject({ channel: "sms", outcome: "message_prepared" });

    // Djamel changes his mind: unticking the opt-out on the patient form brings him back, and the
    // merge keeps any marketing consent evidence stored in the same preferences.
    await asOwner((sql) => sql`update patients set communication_prefs = communication_prefs || '{"marketingOptInAt": "2026-01-02"}'::jsonb where id = ${djamel}`);
    await updatePatient(f.ctx, djamel, { ...blank, firstName: "Djamel", lastName: "Relance", phone: "0550 12 34 56", messagesOptOut: false }, 1);
    expect((await getFollowUps(f.ctx, { today: f.today, reminderDate: f.day })).recall.map((r) => r.patientId)).toEqual([djamel]);
    let prefs: unknown;
    await asOwner(async (sql) => { [prefs] = await sql`select communication_prefs as v from patients where id = ${djamel}`; });
    expect((prefs as { v: unknown }).v).toEqual({ transactionalAllowed: true, marketingOptInAt: "2026-01-02" });
  });

  it("follows up unanswered estimates and accepted plans that are not finished", async () => {
    const f = await setup("Cabinet Relances B");
    const nadia = await f.patient("Nadia");
    const planId = await createTreatmentPlan(f.ctx, nadia, {
      title: "Plan Nadia", notes: null, items: [{ serviceId: f.service.id, quantity: 2, toothNumber: null, surfaces: [], arch: null, quadrant: null }],
    });
    await proposeTreatmentPlan(f.ctx, planId, (await getTreatmentPlan(f.ctx, planId))!.version);
    const age = () => asOwner((sql) => sql`update treatment_plans set updated_at = now() - interval '5 days' where id = ${planId}`);

    // Fresh proposals get a grace period before they appear.
    expect((await getFollowUps(f.ctx, { today: f.today, reminderDate: f.day })).estimates).toEqual([]);
    await age();
    let lists = await getFollowUps(f.ctx, { today: f.today, reminderDate: f.day });
    expect(lists.estimates).toMatchObject([{ planId, title: "Plan Nadia", totalMinor: f.service.priceMinor * 2, remaining: 1 }]);
    // A receptionist sees the follow-up; amounts stay hidden from a role without treatment-plan access.
    const custom = { ...contextFor(f.ctx, "receptionist"), permissions: ["patient.followup" as const] };
    expect((await getFollowUps(custom, { today: f.today, reminderDate: f.day })).estimates).toMatchObject([{ planId, title: null, totalMinor: null }]);

    await decideTreatmentPlan(f.ctx, planId, { expectedVersion: (await getTreatmentPlan(f.ctx, planId))!.version, decision: "accepted", method: "verbal", note: null });
    await age();
    lists = await getFollowUps(f.ctx, { today: f.today, reminderDate: f.day });
    expect(lists.estimates).toEqual([]);
    expect(lists.treatments).toMatchObject([{ planId, remaining: 1 }]);
    await logPatientContact(f.ctx, { patientId: nadia, reason: "treatment_followup", channel: "phone", outcome: "declined", appointmentId: null, treatmentPlanId: planId, note: null });
    expect((await getFollowUps(f.ctx, { today: f.today, reminderDate: f.day })).treatments).toEqual([]);
  });

  it("isolates clinics, checks permissions and references, and keeps contacts append-only", async () => {
    const a = await setup("Cabinet Relances C");
    const b = await setup("Cabinet Relances D");
    const yacine = await a.patient("Yacine");
    const lina = await a.patient("Lina");
    const appointment = await a.book(yacine, "11:00");

    expect((await getFollowUps(b.ctx, { today: b.today, reminderDate: a.day })).reminders).toEqual([]);
    await expect(logPatientContact(b.ctx, { patientId: yacine, reason: "recall", channel: "phone", outcome: "reached", appointmentId: null, treatmentPlanId: null, note: null }))
      .rejects.toMatchObject({ code: "patientUnavailable" });
    await expect(logPatientContact(a.ctx, { patientId: lina, reason: "appointment_reminder", channel: "sms", outcome: "message_prepared", appointmentId: appointment, treatmentPlanId: null, note: null }))
      .rejects.toBeInstanceOf(FollowUpError);

    const staff = { organizationId: a.ctx.organizationId, userId: a.ctx.userId, actorType: "staff" as const };
    const row = { organizationId: a.ctx.organizationId, reason: "appointment_reminder" as const, channel: "sms" as const, outcome: "message_prepared" as const, createdByUserId: a.ctx.userId };
    await expectDbError(withDbContext(staff, (tx) => tx.insert(patientContacts).values({ ...row, patientId: lina, appointmentId: appointment })), /appointment must belong/);
    await expectDbError(withDbContext(staff, (tx) => tx.insert(patientContacts).values({ ...row, patientId: yacine, appointmentId: appointment, createdByUserId: b.ctx.userId })), /staff actor/);
    await expectDbError(withDbContext({ ...staff, organizationId: b.ctx.organizationId, userId: b.ctx.userId }, (tx) =>
      tx.insert(patientContacts).values({ ...row, patientId: yacine, appointmentId: appointment, createdByUserId: b.ctx.userId })), /row-level security/);

    const id = await logPatientContact(a.ctx, { patientId: yacine, reason: "appointment_reminder", channel: "whatsapp", outcome: "message_prepared", appointmentId: appointment, treatmentPlanId: null, note: null });
    await expectDbError(withDbContext(staff, (tx) => tx.update(patientContacts).set({ outcome: "booked" }).where(eq(patientContacts.id, id))), /permission denied/);

    await expect(getFollowUps(contextFor(a.ctx, "accountant"), { today: a.today, reminderDate: a.day })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getFollowUps(contextFor(a.ctx, "receptionist"), { today: a.today, reminderDate: a.day })).resolves.toMatchObject({ reminders: [{ patientId: yacine }] });
  });

  it("saves the recall delay, clinic phone and custom wording (owner only)", async () => {
    const f = await setup("Cabinet Relances E");
    const settings = await getFollowUpSettings(f.ctx);
    const templates = Object.fromEntries((["appointment_reminder", "recall", "treatment_followup", "estimate_followup", "no_show"] as const)
      .map((r) => [r, { fr: r === "recall" ? "Salut {firstName}, contrôle au {clinic} ({clinicPhone})." : "", en: "", ar: "" }])) as never;
    const input = { recallMonths: 9, templates, branchPhones: [{ branchId: settings.branches[0]!.id, phone: "0661 22 33 44" }] };

    await expect(saveFollowUpSettings(contextFor(f.ctx, "receptionist"), input)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(saveFollowUpSettings(f.ctx, { ...input, branchPhones: [{ branchId: settings.branches[0]!.id, phone: "12" }] })).rejects.toMatchObject({ code: "invalidPhone" });
    await saveFollowUpSettings(f.ctx, input);

    const context = await getMessageContext(f.ctx);
    expect(context.defaultPhone).toBe("+213661223344");
    let saved: unknown;
    await asOwner(async (sql) => { [saved] = await sql`select settings->'followUps' as v from organizations where id = ${f.ctx.organizationId}`; });
    expect((saved as { v: unknown }).v).toEqual({ recallMonths: 9, templates: { recall: { fr: "Salut {firstName}, contrôle au {clinic} ({clinicPhone})." } } });

    const ctx = { ...f.ctx, organization: { ...f.ctx.organization, settings: { followUps: { recallMonths: 9, templates: { recall: { fr: "Salut {firstName}, contrôle au {clinic} ({clinicPhone})." } } } } } };
    const resolved = resolveTemplates(ctx);
    expect(resolved.recall.fr).toContain("Salut");
    expect(resolved.recall.en).toContain("Hello"); // untouched languages keep the default
    const patientRow = { patientId: "x", patientNumber: "P-1", firstName: "Sara", lastName: "R", firstNameAr: null, phone: null, locale: "fr" as const, contactAllowed: true, lastContact: null };
    expect(composeMessage(resolved, "recall", patientRow, { ...context, recallMonths: 9, bookingUrl: null })).toBe("Salut Sara, contrôle au Cabinet Relances E (0661 22 33 44).");
  });
});
