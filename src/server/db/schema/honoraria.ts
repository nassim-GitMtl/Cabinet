import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { createdAt, id, organizationId, updatedAt, version, type LocalizedText } from "./_shared";
import { services } from "./catalog";
import { invoiceLines, invoices, paymentMethod } from "./finance";
import { patients } from "./patients";
import { memberships, organizations, users } from "./platform";

/**
 * Practitioner fees ("honoraires"): the share of each billed act that goes to the dentist who did it.
 * Rules are configured per practitioner (default percentage) and per practitioner + service (specific price,
 * percentage or fixed amount per unit). The share is frozen in an append-only ledger when the invoice is issued.
 */
export const feeRuleType = pgEnum("fee_rule_type", ["percent", "fixed"]);
/** earned: frozen at invoice issue · backfill: assigned later to a line issued before the ledger existed ·
 * adjustment: signed correction of an earlier entry. */
export const honorariumEntryKind = pgEnum("honorarium_entry_kind", ["earned", "backfill", "adjustment"]);

export type ProviderSnapshot = { displayName: string; title: string | null; specialty: string | null };
export type FeeServiceSnapshot = { code: string; name: LocalizedText };

/** Current rule for one practitioner and one service. Every change is copied to the history table. */
export const providerServiceTerms = pgTable(
  "provider_service_terms",
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id),
    providerId: uuid("provider_id").notNull().references(() => memberships.id),
    serviceId: uuid("service_id").notNull().references(() => services.id),
    /** Price this practitioner charges for the service; null = the catalog price. */
    priceMinor: bigint("price_minor", { mode: "number" }),
    ruleType: feeRuleType("rule_type").notNull(),
    /** percent: basis points (3000 = 30%) · fixed: minor units per unit of quantity. */
    ruleValue: integer("rule_value").notNull(),
    changedByUserId: uuid("changed_by_user_id").notNull().references(() => users.id),
    updatedAt: updatedAt(),
    version: version(),
  },
  (t) => [
    uniqueIndex("provider_service_terms_pair_uq").on(t.organizationId, t.providerId, t.serviceId),
    check(
      "provider_service_terms_value_valid",
      sql`(${t.ruleType} = 'percent' and ${t.ruleValue} between 0 and 10000) or (${t.ruleType} = 'fixed' and ${t.ruleValue} >= 0)`,
    ),
    check("provider_service_terms_price_valid", sql`${t.priceMinor} is null or ${t.priceMinor} >= 0`),
  ],
);

/** Append-only: who changed a practitioner/service rule, to what, and why. */
export const providerServiceTermHistory = pgTable(
  "provider_service_term_history",
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id),
    termId: uuid("term_id").notNull().references(() => providerServiceTerms.id),
    providerId: uuid("provider_id").notNull().references(() => memberships.id),
    serviceId: uuid("service_id").notNull().references(() => services.id),
    priceMinor: bigint("price_minor", { mode: "number" }),
    ruleType: feeRuleType("rule_type").notNull(),
    ruleValue: integer("rule_value").notNull(),
    reason: text("reason").notNull(),
    changedByUserId: uuid("changed_by_user_id").notNull().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index("provider_service_term_history_term_idx").on(t.termId, t.createdAt)],
);

/**
 * Append-only practitioner-fee ledger. One base entry (earned or backfill) per invoice line, frozen with the
 * rule that applied; corrections are signed adjustment entries pointing at the entry they correct.
 * line amount = unit price x quantity - discount (before tax); base = line amount - lab fee when the service
 * deducts it; practitioner share + clinic share = line amount.
 */
export const honorariumEntries = pgTable(
  "honorarium_entries",
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id),
    invoiceId: uuid("invoice_id").notNull().references(() => invoices.id),
    invoiceLineId: uuid("invoice_line_id").notNull().references(() => invoiceLines.id),
    patientId: uuid("patient_id").notNull().references(() => patients.id),
    providerId: uuid("provider_id").notNull().references(() => memberships.id),
    providerSnapshot: jsonb("provider_snapshot").$type<ProviderSnapshot>().notNull(),
    serviceSnapshot: jsonb("service_snapshot").$type<FeeServiceSnapshot>().notNull(),
    kind: honorariumEntryKind("kind").notNull(),
    /** The entry being corrected (adjustments only). */
    adjustsEntryId: uuid("adjusts_entry_id").references((): AnyPgColumn => honorariumEntries.id),
    /** Day the fee counts in: the service date, or the day it was recorded when that month was already closed. */
    effectiveDate: date("effective_date", { mode: "string" }).notNull(),
    currency: text("currency").notNull(),
    unitPriceMinor: bigint("unit_price_minor", { mode: "number" }).notNull(),
    quantity: integer("quantity").notNull(),
    discountMinor: bigint("discount_minor", { mode: "number" }).notNull(),
    labFeeMinor: bigint("lab_fee_minor", { mode: "number" }).notNull(),
    deductLabBeforeShare: boolean("deduct_lab_before_share").notNull().default(false),
    baseMinor: bigint("base_minor", { mode: "number" }).notNull(),
    lineAmountMinor: bigint("line_amount_minor", { mode: "number" }).notNull(),
    ruleType: feeRuleType("rule_type").notNull(),
    ruleValue: integer("rule_value").notNull(),
    physicianShareMinor: bigint("physician_share_minor", { mode: "number" }).notNull(),
    clinicShareMinor: bigint("clinic_share_minor", { mode: "number" }).notNull(),
    reason: text("reason"),
    createdByUserId: uuid("created_by_user_id").notNull().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    index("honorarium_entries_provider_date_idx").on(t.organizationId, t.providerId, t.effectiveDate),
    index("honorarium_entries_invoice_idx").on(t.invoiceId),
    uniqueIndex("honorarium_entries_base_line_uq").on(t.invoiceLineId).where(sql`kind in ('earned', 'backfill')`),
    check("honorarium_entries_quantity_positive", sql`${t.quantity} > 0`),
    check(
      "honorarium_entries_base_nonnegative",
      sql`${t.kind} = 'adjustment' or (${t.baseMinor} >= 0 and ${t.physicianShareMinor} >= 0 and ${t.clinicShareMinor} >= 0)`,
    ),
    check("honorarium_entries_balanced", sql`${t.physicianShareMinor} + ${t.clinicShareMinor} = ${t.lineAmountMinor}`),
    check(
      "honorarium_entries_adjustment_link",
      sql`(${t.kind} = 'adjustment') = (${t.adjustsEntryId} is not null) and (${t.kind} <> 'adjustment' or length(trim(${t.reason})) > 0)`,
    ),
  ],
);

/**
 * Append-only: money handed to a practitioner. A mistake is corrected by a reversal row (negative amount)
 * pointing at the original; a payment can be reversed once.
 */
export const honorariumPayments = pgTable(
  "honorarium_payments",
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id),
    providerId: uuid("provider_id").notNull().references(() => memberships.id),
    paidOn: date("paid_on", { mode: "string" }).notNull(),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    currency: text("currency").notNull(),
    method: paymentMethod("method").notNull(),
    reference: text("reference"),
    note: text("note"),
    reversesPaymentId: uuid("reverses_payment_id").references((): AnyPgColumn => honorariumPayments.id),
    createdByUserId: uuid("created_by_user_id").notNull().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    index("honorarium_payments_provider_date_idx").on(t.organizationId, t.providerId, t.paidOn),
    uniqueIndex("honorarium_payments_reversal_uq").on(t.reversesPaymentId).where(sql`reverses_payment_id is not null`),
    check(
      "honorarium_payments_amount_valid",
      sql`(${t.reversesPaymentId} is null and ${t.amountMinor} > 0) or (${t.reversesPaymentId} is not null and ${t.amountMinor} < 0 and length(trim(${t.note})) > 0)`,
    ),
  ],
);

/** Append-only: a practitioner's month is final. Later fees and corrections are dated in an open month. */
export const honorariumPeriodClosures = pgTable(
  "honorarium_period_closures",
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id),
    providerId: uuid("provider_id").notNull().references(() => memberships.id),
    /** First day of the closed month. */
    periodMonth: date("period_month", { mode: "string" }).notNull(),
    closedAt: timestamp("closed_at", { withTimezone: true }).notNull().defaultNow(),
    closedByUserId: uuid("closed_by_user_id").notNull().references(() => users.id),
    note: text("note"),
  },
  (t) => [
    uniqueIndex("honorarium_period_closures_uq").on(t.organizationId, t.providerId, t.periodMonth),
    check("honorarium_period_closures_month_start", sql`extract(day from ${t.periodMonth}) = 1`),
  ],
);
