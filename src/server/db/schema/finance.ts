import { sql } from "drizzle-orm";

/** Who issued a financial document, as printed on it. Copied at issue time so later edits never change it. */
export type IssuerSnapshot = {
  clinicName: string;
  legalName: string;
  address: string | null;
  identifiers: Record<string, string>;
  phone: string | null;
  email: string | null;
};
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
} from "drizzle-orm/pg-core";
import { createdAt, id, organizationId, updatedAt, version, type LocalizedText } from "./_shared";
import { performedProcedures } from "./clinical";
import { services } from "./catalog";
import { patients } from "./patients";
import { branches, legalEntities, memberships, organizations, users } from "./platform";

/**
 * Financial subledger (§16). Rules enforced in PostgreSQL (migration 0006):
 * - issued invoices and their lines are immutable (only issued -> void);
 * - credit notes, payment allocations and refunds are append-only;
 * - allocations never exceed available payment value or the invoice charge;
 * - refunds never exceed the unapplied (unallocated, unrefunded) payment value.
 * All balances are derived from these rows; no stored running totals.
 */

export const invoiceStatus = pgEnum("invoice_status", ["draft", "issued", "void"]);

export const invoices = pgTable(
  "invoices",
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id),
    /** Issuer identity frozen when the document is issued (legal name, identifiers, address); null = draft. */
    issuerSnapshot: jsonb("issuer_snapshot").$type<IssuerSnapshot>(),
    legalEntityId: uuid("legal_entity_id")
      .notNull()
      .references(() => legalEntities.id),
    patientId: uuid("patient_id")
      .notNull()
      .references(() => patients.id),
    /** Assigned at issue: per legal entity and year, never reused. */
    number: text("number"),
    status: invoiceStatus("status").notNull().default("draft"),
    /** Accounting date of the document (set at issue). */
    documentDate: date("document_date", { mode: "string" }),
    dueDate: date("due_date", { mode: "string" }),
    currency: text("currency").notNull(),
    subtotalMinor: bigint("subtotal_minor", { mode: "number" }).notNull().default(0),
    discountMinor: bigint("discount_minor", { mode: "number" }).notNull().default(0),
    taxMinor: bigint("tax_minor", { mode: "number" }).notNull().default(0),
    totalMinor: bigint("total_minor", { mode: "number" }).notNull().default(0),
    notes: text("notes"),
    issuedAt: timestamp("issued_at", { withTimezone: true }),
    issuedByUserId: uuid("issued_by_user_id").references(() => users.id),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    voidedByUserId: uuid("voided_by_user_id").references(() => users.id),
    voidReason: text("void_reason"),
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    version: version(),
  },
  (t) => [
    uniqueIndex("invoices_entity_number_uq")
      .on(t.organizationId, t.legalEntityId, t.number)
      .where(sql`number is not null`),
    index("invoices_patient_idx").on(t.organizationId, t.patientId),
    index("invoices_document_date_idx").on(t.organizationId, t.documentDate),
    check("invoices_totals_nonnegative", sql`${t.totalMinor} >= 0 and ${t.subtotalMinor} >= 0`),
    check(
      "invoices_issued_has_number",
      sql`${t.status} = 'draft' or (${t.number} is not null and ${t.documentDate} is not null)`,
    ),
  ],
);

export type LineDescription = { code: string; name: LocalizedText };

export const invoiceLines = pgTable(
  "invoice_lines",
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.id, { onDelete: "cascade" }),
    performedProcedureId: uuid("performed_procedure_id").references(() => performedProcedures.id),
    serviceId: uuid("service_id").references(() => services.id),
    description: jsonb("description").$type<LineDescription>().notNull(),
    toothNumber: text("tooth_number"),
    surfaces: text("surfaces").array().notNull().default(sql`'{}'::text[]`),
    quantity: integer("quantity").notNull(),
    unitPriceMinor: bigint("unit_price_minor", { mode: "number" }).notNull(),
    discountMinor: bigint("discount_minor", { mode: "number" }).notNull().default(0),
    discountReason: text("discount_reason"),
    /** Laboratory cost of this act, entered at checkout; deducted from the fee base when the service says so. */
    labFeeMinor: bigint("lab_fee_minor", { mode: "number" }).notNull().default(0),
    /** Optional practitioner-share rule for this line only ("percent" in basis points, "fixed" per unit), with why. */
    honorariumRuleType: text("honorarium_rule_type"),
    honorariumRuleValue: integer("honorarium_rule_value"),
    honorariumOverrideReason: text("honorarium_override_reason"),
    taxRateBp: integer("tax_rate_bp"),
    taxMinor: bigint("tax_minor", { mode: "number" }).notNull().default(0),
    /** quantity * unit price - discount + tax */
    totalMinor: bigint("total_minor", { mode: "number" }).notNull(),
    serviceDate: date("service_date", { mode: "string" }).notNull(),
    providerId: uuid("provider_id").references(() => memberships.id),
    sortOrder: integer("sort_order").notNull().default(0),
    /** Set when the parent invoice is voided, releasing the procedure for re-billing. */
    released: boolean("released").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    index("invoice_lines_invoice_idx").on(t.invoiceId),
    // A completed procedure can be on at most one non-void invoice.
    uniqueIndex("invoice_lines_procedure_once_uq")
      .on(t.performedProcedureId)
      .where(sql`performed_procedure_id is not null and released = false`),
    check("invoice_lines_quantity_positive", sql`${t.quantity} > 0`),
    check("invoice_lines_amounts_valid", sql`${t.unitPriceMinor} >= 0 and ${t.discountMinor} >= 0 and ${t.discountMinor} <= ${t.quantity} * ${t.unitPriceMinor}`),
    check("invoice_lines_lab_fee_valid", sql`${t.labFeeMinor} >= 0 and ${t.labFeeMinor} <= ${t.quantity} * ${t.unitPriceMinor} - ${t.discountMinor}`),
    check(
      "invoice_lines_honorarium_override_valid",
      sql`(${t.honorariumRuleType} is null and ${t.honorariumRuleValue} is null and ${t.honorariumOverrideReason} is null)
        or (${t.honorariumRuleType} = 'percent' and ${t.honorariumRuleValue} between 0 and 10000 and length(trim(${t.honorariumOverrideReason})) > 0)
        or (${t.honorariumRuleType} = 'fixed' and ${t.honorariumRuleValue} >= 0 and length(trim(${t.honorariumOverrideReason})) > 0)`,
    ),
  ],
);

/** Reduces the charge of an issued invoice. Append-only. */
export const creditNotes = pgTable(
  "credit_notes",
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id),
    /** Issuer identity frozen when the document is issued (legal name, identifiers, address); null = draft. */
    issuerSnapshot: jsonb("issuer_snapshot").$type<IssuerSnapshot>(),
    legalEntityId: uuid("legal_entity_id")
      .notNull()
      .references(() => legalEntities.id),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.id),
    number: text("number").notNull(),
    documentDate: date("document_date", { mode: "string" }).notNull(),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    currency: text("currency").notNull(),
    reason: text("reason").notNull(),
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("credit_notes_entity_number_uq").on(t.organizationId, t.legalEntityId, t.number),
    index("credit_notes_invoice_idx").on(t.invoiceId),
    check("credit_notes_amount_positive", sql`${t.amountMinor} > 0`),
  ],
);

export const paymentMethod = pgEnum("payment_method", ["cash", "card", "bank_transfer", "cheque", "other"]);
export const paymentStatus = pgEnum("payment_status", ["posted", "reversed"]);
export const paymentPurpose = pgEnum("payment_purpose", ["invoice_payment", "advance_deposit"]);

/** Money received once. Applying it to invoices never creates a new receipt. */
export const payments = pgTable(
  "payments",
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id),
    /** Site (branch) whose cash drawer this belongs to; null only on rows older than multi-site = the first site. */
    branchId: uuid("branch_id").references(() => branches.id),
    /** Issuer identity frozen when the document is issued (legal name, identifiers, address); null = draft. */
    issuerSnapshot: jsonb("issuer_snapshot").$type<IssuerSnapshot>(),
    legalEntityId: uuid("legal_entity_id")
      .notNull()
      .references(() => legalEntities.id),
    patientId: uuid("patient_id")
      .notNull()
      .references(() => patients.id),
    /** Third-party payer name when someone other than the patient pays. */
    payerName: text("payer_name"),
    purpose: paymentPurpose("purpose").notNull().default("invoice_payment"),
    method: paymentMethod("method").notNull(),
    reference: text("reference"),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    currency: text("currency").notNull(),
    /** Receipt date (cash basis). */
    receivedOn: date("received_on", { mode: "string" }).notNull(),
    receiptNumber: text("receipt_number").notNull(),
    status: paymentStatus("status").notNull().default("posted"),
    reversedAt: timestamp("reversed_at", { withTimezone: true }),
    reversedByUserId: uuid("reversed_by_user_id").references(() => users.id),
    reversalReason: text("reversal_reason"),
    /** Client-generated key: a retried submission returns the original payment. */
    idempotencyKey: text("idempotency_key").notNull(),
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("payments_idempotency_uq").on(t.organizationId, t.idempotencyKey),
    uniqueIndex("payments_receipt_uq").on(t.organizationId, t.legalEntityId, t.receiptNumber),
    index("payments_patient_idx").on(t.organizationId, t.patientId),
    index("payments_received_on_idx").on(t.organizationId, t.receivedOn),
    check("payments_amount_positive", sql`${t.amountMinor} > 0`),
  ],
);

/** Applies payment value to an invoice. Negative rows release a previous allocation. Append-only. */
export const paymentAllocations = pgTable(
  "payment_allocations",
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id),
    paymentId: uuid("payment_id")
      .notNull()
      .references(() => payments.id),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.id),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    reason: text("reason"),
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    index("allocations_payment_idx").on(t.paymentId),
    index("allocations_invoice_idx").on(t.invoiceId),
    check("allocations_amount_nonzero", sql`${t.amountMinor} <> 0`),
  ],
);

/** Money returned to the payer from unapplied payment value. Append-only. */
export const refunds = pgTable(
  "refunds",
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id),
    /** Site (branch) whose cash drawer this belongs to; null only on rows older than multi-site = the first site. */
    branchId: uuid("branch_id").references(() => branches.id),
    paymentId: uuid("payment_id")
      .notNull()
      .references(() => payments.id),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    method: paymentMethod("method").notNull(),
    refundedOn: date("refunded_on", { mode: "string" }).notNull(),
    reference: text("reference"),
    reason: text("reason").notNull(),
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    index("refunds_payment_idx").on(t.paymentId),
    index("refunds_date_idx").on(t.organizationId, t.refundedOn),
    check("refunds_amount_positive", sql`${t.amountMinor} > 0`),
  ],
);
