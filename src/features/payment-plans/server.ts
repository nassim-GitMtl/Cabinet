import "server-only";

import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import { audit } from "@/server/audit";
import { requirePermission, tenantTx, type ClinicContext } from "@/server/auth/context";
import type { Tx } from "@/server/db/client";
import {
  paymentScheduleInstallments,
  paymentSchedules,
  treatmentPlans,
  treatmentPlanVersions,
} from "@/server/db/schema";

export class PaymentScheduleError extends Error {
  constructor(public readonly code: "planUnavailable" | "invalidSchedule" | "cannotReplacePaid") { super(code); }
}

export type InstallmentInput = { dueDate: string; amountMinor: number };
export type PaymentScheduleView = {
  id: string; planId: string; versionId: string; patientId: string; currency: string; totalMinor: number; createdAt: Date;
  installments: Array<{ id: string; number: number; dueDate: string; amountMinor: number; paidMinor: number; remainingMinor: number }>;
};

// `where` is raw SQL on the `s` alias (Drizzle columns would print the unaliased table name).
const scheduleRows = async (tx: Tx, where: SQL) => {
  const rows = await tx.execute<{
    schedule_id: string; plan_id: string; version_id: string; patient_id: string; currency: string;
    total_minor: string; created_at: Date; installment_id: string; installment_number: number;
    due_date: string; amount_minor: string; paid_minor: string;
  }>(sql`
    select s.id schedule_id, s.plan_id, s.version_id, s.patient_id, s.currency, s.total_minor::text,
           s.created_at, i.id installment_id, i.installment_number, i.due_date::text,
           i.amount_minor::text,
           coalesce((select sum(case when p.status = 'posted' then p.amount_minor
             - coalesce((select sum(r.amount_minor) from refunds r where r.payment_id = p.id), 0) else 0 end)
             from payment_installment_receipts x join payments p on p.id = x.payment_id
            where x.installment_id = i.id), 0)::text paid_minor
      from payment_schedules s join payment_schedule_installments i on i.schedule_id = s.id
     where ${where} and not exists (select 1 from payment_schedules n where n.supersedes_schedule_id = s.id)
     order by s.created_at desc, i.installment_number`);
  const grouped = new Map<string, PaymentScheduleView>();
  for (const row of rows) {
    const schedule = grouped.get(row.schedule_id) ?? {
      id: row.schedule_id, planId: row.plan_id, versionId: row.version_id, patientId: row.patient_id,
      currency: row.currency, totalMinor: Number(row.total_minor), createdAt: row.created_at, installments: [],
    };
    const paidMinor = Number(row.paid_minor);
    const amountMinor = Number(row.amount_minor);
    schedule.installments.push({ id: row.installment_id, number: row.installment_number, dueDate: row.due_date,
      amountMinor, paidMinor, remainingMinor: Math.max(0, amountMinor - paidMinor) });
    grouped.set(row.schedule_id, schedule);
  }
  return [...grouped.values()];
};

export async function createPaymentSchedule(ctx: ClinicContext, planId: string, installments: InstallmentInput[]) {
  requirePermission(ctx, "treatment_plan.manage");
  if (!installments.length || installments.length > 24 || installments.some((x) => !/^\d{4}-\d{2}-\d{2}$/.test(x.dueDate) || !Number.isSafeInteger(x.amountMinor) || x.amountMinor <= 0)) {
    throw new PaymentScheduleError("invalidSchedule");
  }
  const sorted = [...installments].sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  if (sorted.some((x, i) => i > 0 && x.dueDate <= sorted[i - 1]!.dueDate)) throw new PaymentScheduleError("invalidSchedule");
  return tenantTx(ctx, async (tx) => {
    const [plan] = await tx.select({ patientId: treatmentPlans.patientId, status: treatmentPlans.status,
      currentVersion: treatmentPlans.currentVersion, versionId: treatmentPlanVersions.id,
      currency: treatmentPlanVersions.currency, totalMinor: treatmentPlanVersions.totalMinor })
      .from(treatmentPlans).innerJoin(treatmentPlanVersions, and(eq(treatmentPlanVersions.planId, treatmentPlans.id), eq(treatmentPlanVersions.versionNumber, treatmentPlans.currentVersion)))
      .where(eq(treatmentPlans.id, planId)).for("update", { of: treatmentPlans }).limit(1);
    if (!plan || !["accepted", "completed"].includes(plan.status)) throw new PaymentScheduleError("planUnavailable");
    if (sorted.reduce((sum, x) => sum + x.amountMinor, 0) !== plan.totalMinor) throw new PaymentScheduleError("invalidSchedule");
    const [current] = await tx.select({ id: paymentSchedules.id }).from(paymentSchedules)
      .where(and(eq(paymentSchedules.planId, planId), sql`not exists (select 1 from payment_schedules n where n.supersedes_schedule_id = ${paymentSchedules.id})`))
      .orderBy(desc(paymentSchedules.createdAt)).limit(1);
    if (current) {
      const [used] = await tx.execute<{ used: boolean }>(sql`select exists(select 1 from payment_installment_receipts where schedule_id = ${current.id}) used`);
      if (used?.used) throw new PaymentScheduleError("cannotReplacePaid");
    }
    const [schedule] = await tx.insert(paymentSchedules).values({
      organizationId: ctx.organizationId, patientId: plan.patientId, planId, versionId: plan.versionId,
      supersedesScheduleId: current?.id ?? null, currency: plan.currency, totalMinor: plan.totalMinor, createdByUserId: ctx.userId,
    }).returning({ id: paymentSchedules.id });
    await tx.insert(paymentScheduleInstallments).values(sorted.map((x, index) => ({
      organizationId: ctx.organizationId, scheduleId: schedule!.id, patientId: plan.patientId,
      installmentNumber: index + 1, dueDate: x.dueDate, amountMinor: x.amountMinor, createdByUserId: ctx.userId,
    })));
    await audit(tx, { organizationId: ctx.organizationId, actorType: "staff", actorUserId: ctx.userId,
      action: current ? "payment_schedule.replaced" : "payment_schedule.created", entityType: "payment_schedule",
      entityId: schedule!.id, patientId: plan.patientId, metadata: { planId, versionId: plan.versionId, installmentCount: sorted.length } });
    return { id: schedule!.id, patientId: plan.patientId };
  });
}

export async function getPlanPaymentSchedule(ctx: ClinicContext, planId: string) {
  requirePermission(ctx, "treatment_plan.read");
  return tenantTx(ctx, async (tx) => (await scheduleRows(tx, sql`s.plan_id = ${planId}`))[0] ?? null);
}

export async function listPatientPaymentSchedules(ctx: ClinicContext, patientId: string) {
  requirePermission(ctx, "payment.read");
  return tenantTx(ctx, (tx) => scheduleRows(tx, sql`s.patient_id = ${patientId}`));
}
