import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { BillingError, recordPayment } from "@/features/billing/server";
import { getServicePickerData } from "@/features/catalog/server";
import { composeMessage, resolveTemplates } from "@/features/follow-ups/compose";
import { getFollowUps, getMessageContext, logPatientContact } from "@/features/follow-ups/server";
import { createPatient } from "@/features/patients/server";
import { createPaymentSchedule, getPlanPaymentSchedule, listPatientPaymentSchedules, PaymentScheduleError } from "@/features/payment-plans/server";
import { createTreatmentPlan, decideTreatmentPlan, getTreatmentPlan, proposeTreatmentPlan } from "@/features/treatment-plans/server";
import { addDays, todayInZone } from "@/lib/dates";
import { ForbiddenError } from "@/server/auth/context";
import { paymentScheduleInstallments } from "@/server/db/schema";
import { withDbContext } from "@/server/db/tenant";
import { contextFor, expectDbError, makeClinic } from "../support/factories";

const blank = {
  firstNameAr: null, lastNameAr: null, sex: undefined, birthDate: null, birthDatePrecision: "exact" as const, phone: "0550 77 88 99", phoneAlt: null,
  email: null, addressLine: null, city: null, region: null, preferredLocale: "fr" as const, emergencyName: null, emergencyRelationship: null,
  emergencyPhone: null, referralSource: null, referredBy: null, administrativeNotes: null, assignedProviderId: null,
};

async function setup(name: string, accept = true) {
  const ctx = await makeClinic(name);
  const created = await createPatient(ctx, { ...blank, firstName: "Salima", lastName: "Échéance" }, { confirmNotDuplicate: true });
  if (created.status !== "created") throw new Error("fixture");
  const service = (await getServicePickerData(ctx)).categories.flatMap((c) => c.services).find((s) => s.code === "CONS-01")!;
  const planId = await createTreatmentPlan(ctx, created.id, {
    title: "Plan Salima", notes: null, items: [{ serviceId: service.id, quantity: 3, toothNumber: null, surfaces: [], arch: null, quadrant: null }],
  });
  await proposeTreatmentPlan(ctx, planId, (await getTreatmentPlan(ctx, planId))!.version);
  if (accept) await decideTreatmentPlan(ctx, planId, { expectedVersion: (await getTreatmentPlan(ctx, planId))!.version, decision: "accepted", method: "verbal", note: null });
  const total = service.priceMinor * 3;
  const today = todayInZone(ctx.organization.timezone);
  const pay = (amountMinor: number, installmentId: string | null, allocateTo: "auto" | null = null) =>
    recordPayment(ctx, { patientId: created.id, amountMinor, method: "cash", receivedOn: today, idempotencyKey: randomUUID(), allocateTo, installmentId });
  return { ctx, patientId: created.id, planId, total, today, pay };
}

describe("payment schedules for accepted estimates", () => {
  it("splits the exact accepted total, records receipts per installment and locks a schedule once paid", async () => {
    const f = await setup("Cabinet Échéancier A");
    const first = Math.floor(f.total / 2);
    const twoParts = [{ dueDate: f.today, amountMinor: first }, { dueDate: addDays(f.today, 30), amountMinor: f.total - first }];

    await expect(createPaymentSchedule(f.ctx, f.planId, [{ dueDate: f.today, amountMinor: f.total - 1 }])).rejects.toMatchObject({ code: "invalidSchedule" });
    await expect(createPaymentSchedule(f.ctx, f.planId, [{ dueDate: f.today, amountMinor: first }, { dueDate: f.today, amountMinor: f.total - first }]))
      .rejects.toMatchObject({ code: "invalidSchedule" });
    await expect(createPaymentSchedule(contextFor(f.ctx, "receptionist"), f.planId, twoParts)).rejects.toBeInstanceOf(ForbiddenError);

    // A schedule can be replaced while nothing has been received on it.
    await createPaymentSchedule(f.ctx, f.planId, [{ dueDate: f.today, amountMinor: f.total }]);
    await createPaymentSchedule(f.ctx, f.planId, twoParts);
    let schedule = (await getPlanPaymentSchedule(f.ctx, f.planId))!;
    expect(schedule.installments.map((i) => [i.number, i.amountMinor, i.paidMinor])).toEqual([[1, first, 0], [2, f.total - first, 0]]);

    // Receipts stay patient deposits classified against one installment, never above what is left.
    const one = schedule.installments[0]!;
    await expect(f.pay(first + 1, one.id)).rejects.toBeInstanceOf(BillingError);
    await expect(f.pay(first, one.id, "auto")).rejects.toBeInstanceOf(BillingError);
    await f.pay(first, one.id);
    schedule = (await getPlanPaymentSchedule(f.ctx, f.planId))!;
    expect(schedule.installments[0]).toMatchObject({ paidMinor: first, remainingMinor: 0 });
    expect((await listPatientPaymentSchedules(f.ctx, f.patientId))[0]!.id).toBe(schedule.id);

    await expect(createPaymentSchedule(f.ctx, f.planId, twoParts)).rejects.toMatchObject({ code: "cannotReplacePaid" });
    // The database keeps installments tied to the current schedule and their sum equal to its total.
    await expectDbError(withDbContext({ organizationId: f.ctx.organizationId, userId: f.ctx.userId, actorType: "staff" }, (tx) =>
      tx.insert(paymentScheduleInstallments).values({
        organizationId: f.ctx.organizationId, scheduleId: schedule.id, patientId: f.patientId, installmentNumber: 3,
        dueDate: addDays(f.today, 60), amountMinor: 100, createdByUserId: f.ctx.userId,
      })), /installment total must equal/);
  });

  it("only schedules accepted estimates of the same clinic", async () => {
    const proposed = await setup("Cabinet Échéancier B", false);
    await expect(createPaymentSchedule(proposed.ctx, proposed.planId, [{ dueDate: proposed.today, amountMinor: proposed.total }]))
      .rejects.toBeInstanceOf(PaymentScheduleError);
    const other = await setup("Cabinet Échéancier C");
    await expect(createPaymentSchedule(other.ctx, proposed.planId, [{ dueDate: other.today, amountMinor: proposed.total }]))
      .rejects.toMatchObject({ code: "planUnavailable" });
    expect(await getPlanPaymentSchedule(other.ctx, proposed.planId)).toBeNull();
  });

  it("lists due and late installments in follow-ups with a ready reminder", async () => {
    const f = await setup("Cabinet Échéancier D");
    const first = Math.floor(f.total / 2);
    await createPaymentSchedule(f.ctx, f.planId, [
      { dueDate: addDays(f.today, 3), amountMinor: first }, { dueDate: addDays(f.today, 40), amountMinor: f.total - first },
    ]);
    let lists = await getFollowUps(f.ctx, { today: f.today, reminderDate: f.today });
    expect(lists.installments).toMatchObject([{ patientId: f.patientId, number: 1, remainingMinor: first, dueDate: addDays(f.today, 3) }]);
    const message = composeMessage(resolveTemplates(f.ctx), "installment_due", { ...lists.installments[0]!, date: lists.installments[0]!.dueDate, amount: "1 234,00 DA" }, {
      ...(await getMessageContext(f.ctx)), recallMonths: 6, bookingUrl: null,
    });
    expect(message).toContain("1 234,00 DA");

    // Amounts are financial: without payment.read the list stays empty.
    const followUpOnly = { ...contextFor(f.ctx, "receptionist"), permissions: ["patient.followup" as const] };
    expect((await getFollowUps(followUpOnly, { today: f.today, reminderDate: f.today })).installments).toEqual([]);

    await logPatientContact(f.ctx, {
      patientId: f.patientId, reason: "installment_due", channel: "whatsapp", outcome: "message_prepared",
      appointmentId: null, treatmentPlanId: null, installmentId: lists.installments[0]!.installmentId, note: null,
    });
    lists = await getFollowUps(f.ctx, { today: f.today, reminderDate: f.today });
    expect(lists.installments).toEqual([]);
  });
});
