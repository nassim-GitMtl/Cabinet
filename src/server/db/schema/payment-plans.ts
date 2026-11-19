import { sql } from "drizzle-orm";
import { bigint, check, date, index, integer, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, organizationId } from "./_shared";
import { payments } from "./finance";
import { patients } from "./patients";
import { organizations, users } from "./platform";
import { treatmentPlans, treatmentPlanVersions } from "./treatment";

/** Immutable installment schedule for one exact, accepted estimate version. */
export const paymentSchedules = pgTable(
  "payment_schedules",
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id),
    patientId: uuid("patient_id").notNull().references(() => patients.id),
    planId: uuid("plan_id").notNull().references(() => treatmentPlans.id),
    versionId: uuid("version_id").notNull().references(() => treatmentPlanVersions.id),
    supersedesScheduleId: uuid("supersedes_schedule_id"),
    currency: text("currency").notNull(),
    totalMinor: bigint("total_minor", { mode: "number" }).notNull(),
    createdByUserId: uuid("created_by_user_id").notNull().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    check("payment_schedules_total_positive", sql`${t.totalMinor} > 0`),
    uniqueIndex("payment_schedules_supersedes_uq").on(t.supersedesScheduleId),
    index("payment_schedules_plan_idx").on(t.organizationId, t.planId, t.createdAt),
    index("payment_schedules_patient_idx").on(t.organizationId, t.patientId, t.createdAt),
  ],
);

export const paymentScheduleInstallments = pgTable(
  "payment_schedule_installments",
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id),
    scheduleId: uuid("schedule_id").notNull().references(() => paymentSchedules.id),
    patientId: uuid("patient_id").notNull().references(() => patients.id),
    installmentNumber: integer("installment_number").notNull(),
    dueDate: date("due_date", { mode: "string" }).notNull(),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    createdByUserId: uuid("created_by_user_id").notNull().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    check("payment_schedule_installments_number_positive", sql`${t.installmentNumber} > 0`),
    check("payment_schedule_installments_amount_positive", sql`${t.amountMinor} > 0`),
    uniqueIndex("payment_schedule_installments_order_uq").on(t.scheduleId, t.installmentNumber),
    index("payment_schedule_installments_due_idx").on(t.organizationId, t.dueDate),
  ],
);

/** Classifies a real receipt against an installment; cash remains in the payment ledger. */
export const paymentInstallmentReceipts = pgTable(
  "payment_installment_receipts",
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id),
    scheduleId: uuid("schedule_id").notNull().references(() => paymentSchedules.id),
    installmentId: uuid("installment_id").notNull().references(() => paymentScheduleInstallments.id),
    paymentId: uuid("payment_id").notNull().references(() => payments.id),
    patientId: uuid("patient_id").notNull().references(() => patients.id),
    createdByUserId: uuid("created_by_user_id").notNull().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("payment_installment_receipts_payment_uq").on(t.paymentId),
    index("payment_installment_receipts_installment_idx").on(t.organizationId, t.installmentId),
  ],
);
