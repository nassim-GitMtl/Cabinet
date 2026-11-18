import { sql } from "drizzle-orm";
import { check, index, integer, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, organizationId } from "./_shared";
import { services } from "./catalog";
import { performedProcedures } from "./clinical";
import { inventoryItems } from "./inventory";
import { branches, organizations, users } from "./platform";

/** Consumables a catalog service normally uses, per unit of the service. */
export const serviceConsumables = pgTable(
  "service_consumables",
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id),
    serviceId: uuid("service_id")
      .notNull()
      .references(() => services.id),
    itemId: uuid("item_id")
      .notNull()
      .references(() => inventoryItems.id),
    quantity: integer("quantity").notNull(),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("service_consumables_service_item_uq").on(t.organizationId, t.serviceId, t.itemId),
    check("service_consumables_quantity_positive", sql`${t.quantity} > 0`),
  ],
);

export const consumptionStatus = pgEnum("procedure_consumption_status", ["pending", "consumed", "skipped"]);

/**
 * Stock use proposed for one completed procedure (from the service recipe).
 * Confirming writes FEFO usage movements linked to the procedure; skipping
 * records why. Never created from planned appointments.
 */
export const procedureConsumptions = pgTable(
  "procedure_consumptions",
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id),
    performedProcedureId: uuid("performed_procedure_id")
      .notNull()
      .references(() => performedProcedures.id),
    itemId: uuid("item_id")
      .notNull()
      .references(() => inventoryItems.id),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id),
    quantity: integer("quantity").notNull(),
    status: consumptionStatus("status").notNull().default("pending"),
    /** Why it is still pending (e.g. insufficient stock in auto mode) or why it was skipped. */
    note: text("note"),
    decidedByUserId: uuid("decided_by_user_id").references(() => users.id),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("procedure_consumptions_proc_item_uq").on(t.performedProcedureId, t.itemId),
    index("procedure_consumptions_status_idx").on(t.organizationId, t.status, t.createdAt),
    check("procedure_consumptions_quantity_positive", sql`${t.quantity} > 0`),
  ],
);
