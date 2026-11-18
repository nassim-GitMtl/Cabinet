import { boolean, check, date, index, integer, pgEnum, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createdAt, id, organizationId } from "./_shared";
import { branches, organizations, users } from "./platform";

export const inventoryUnit = pgEnum("inventory_unit", [
  "piece",
  "box",
  "pack",
  "bottle",
  "cartridge",
  "milliliter",
  "gram",
]);

export const inventoryMovementKind = pgEnum("inventory_movement_kind", [
  "receipt",
  "usage",
  "adjustment_in",
  "adjustment_out",
  "expired",
  "waste",
]);

export const inventoryItems = pgTable(
  "inventory_items",
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id),
    sku: text("sku").notNull(),
    name: text("name").notNull(),
    category: text("category"),
    unit: inventoryUnit("unit").notNull(),
    minimumStock: integer("minimum_stock").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("inventory_items_org_sku_uq").on(t.organizationId, sql`lower(${t.sku})`),
    index("inventory_items_org_name_idx").on(t.organizationId, t.name),
    check("inventory_items_minimum_nonnegative", sql`${t.minimumStock} >= 0`),
  ],
);

/** Lot metadata is immutable after the first receipt; corrections use stock movements. */
export const inventoryLots = pgTable(
  "inventory_lots",
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id),
    itemId: uuid("item_id").notNull().references(() => inventoryItems.id),
    branchId: uuid("branch_id").notNull().references(() => branches.id),
    lotNumber: text("lot_number").notNull(),
    expiresOn: date("expires_on"),
    receivedOn: date("received_on").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("inventory_lots_identity_uq").on(t.organizationId, t.itemId, t.branchId, sql`lower(${t.lotNumber})`),
    index("inventory_lots_fefo_idx").on(t.organizationId, t.itemId, t.branchId, t.expiresOn),
  ],
);

/** Append-only stock ledger. A balance is always the sum of quantityDelta. */
export const inventoryMovements = pgTable(
  "inventory_movements",
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id),
    itemId: uuid("item_id").notNull().references(() => inventoryItems.id),
    lotId: uuid("lot_id").notNull().references(() => inventoryLots.id),
    branchId: uuid("branch_id").notNull().references(() => branches.id),
    kind: inventoryMovementKind("kind").notNull(),
    quantityDelta: integer("quantity_delta").notNull(),
    occurredOn: date("occurred_on").notNull(),
    reference: text("reference"),
    reason: text("reason"),
    createdByUserId: uuid("created_by_user_id").notNull().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    index("inventory_movements_lot_idx").on(t.organizationId, t.lotId, t.createdAt),
    index("inventory_movements_item_idx").on(t.organizationId, t.itemId, t.branchId, t.occurredOn),
    check("inventory_movements_nonzero", sql`${t.quantityDelta} <> 0`),
  ],
);
