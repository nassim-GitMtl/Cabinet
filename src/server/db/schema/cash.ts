import { sql } from "drizzle-orm";
import { bigint, check, date, index, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, organizationId } from "./_shared";
import { paymentMethod } from "./finance";
import { legalEntities, organizations, users } from "./platform";

/**
 * Cash control and expenses (§17).
 * Expected physical cash is DERIVED at read time from the ledger (cash payments,
 * cash refunds, cash expenses, transfers) — never typed in. A card receipt never
 * changes physical cash.
 */

export const suppliers = pgTable(
  "suppliers",
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id),
    name: text("name").notNull(),
    phone: text("phone"),
    email: text("email"),
    notes: text("notes"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("suppliers_org_name_uq").on(t.organizationId, sql`lower(${t.name})`)],
);

export const expenseStatus = pgEnum("expense_status", ["unpaid", "paid", "void"]);

export const expenses = pgTable(
  "expenses",
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id),
    legalEntityId: uuid("legal_entity_id")
      .notNull()
      .references(() => legalEntities.id),
    /** Category key from EXPENSE_CATEGORIES (configurable list in code). */
    category: text("category").notNull(),
    supplierId: uuid("supplier_id").references(() => suppliers.id),
    reference: text("reference"),
    description: text("description").notNull(),
    expenseDate: date("expense_date", { mode: "string" }).notNull(),
    dueDate: date("due_date", { mode: "string" }),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    currency: text("currency").notNull(),
    status: expenseStatus("status").notNull().default("unpaid"),
    paidOn: date("paid_on", { mode: "string" }),
    paymentMethod: paymentMethod("payment_method"),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    voidReason: text("void_reason"),
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    index("expenses_org_date_idx").on(t.organizationId, t.expenseDate),
    index("expenses_org_paid_idx").on(t.organizationId, t.paidOn),
    check("expenses_amount_positive", sql`${t.amountMinor} > 0`),
    check("expenses_paid_complete", sql`${t.status} <> 'paid' or (${t.paidOn} is not null and ${t.paymentMethod} is not null)`),
  ],
);

export const cashSessionStatus = pgEnum("cash_session_status", ["open", "closed", "approved"]);

/** One cash drawer session per clinic and business day. */
export const cashSessions = pgTable(
  "cash_sessions",
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id),
    businessDate: date("business_date", { mode: "string" }).notNull(),
    currency: text("currency").notNull(),
    openingFloatMinor: bigint("opening_float_minor", { mode: "number" }).notNull(),
    status: cashSessionStatus("status").notNull().default("open"),
    openedByUserId: uuid("opened_by_user_id")
      .notNull()
      .references(() => users.id),
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
    /** Snapshot of the derived expected cash at the moment of closing. */
    expectedMinor: bigint("expected_minor", { mode: "number" }),
    countedMinor: bigint("counted_minor", { mode: "number" }),
    discrepancyReason: text("discrepancy_reason"),
    closedByUserId: uuid("closed_by_user_id").references(() => users.id),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    approvedByUserId: uuid("approved_by_user_id").references(() => users.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    notes: text("notes"),
  },
  (t) => [
    uniqueIndex("cash_sessions_org_date_uq").on(t.organizationId, t.businessDate),
    check("cash_sessions_float_nonnegative", sql`${t.openingFloatMinor} >= 0`),
    check(
      "cash_sessions_close_complete",
      sql`${t.status} = 'open' or (${t.countedMinor} is not null and ${t.expectedMinor} is not null and (${t.countedMinor} = ${t.expectedMinor} or ${t.discrepancyReason} is not null))`,
    ),
  ],
);

export const cashMovementDirection = pgEnum("cash_movement_direction", ["in", "out"]);

/** Non-revenue cash transfers (bank deposit, petty-cash top-up). Append-only. */
export const cashMovements = pgTable(
  "cash_movements",
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id),
    cashSessionId: uuid("cash_session_id")
      .notNull()
      .references(() => cashSessions.id),
    direction: cashMovementDirection("direction").notNull(),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    reason: text("reason").notNull(),
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index("cash_movements_session_idx").on(t.cashSessionId), check("cash_movements_amount_positive", sql`${t.amountMinor} > 0`)],
);
