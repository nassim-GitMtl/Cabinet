import { performedProcedures } from "./clinical";
import { bigint, boolean, check, date, index, integer, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createdAt, id, organizationId } from "./_shared";
import { suppliers } from "./cash";
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

export const inventoryPurchaseOrderStatus = pgEnum("inventory_purchase_order_status", [
  "ordered",
  "partially_received",
  "received",
  "cancelled",
]);

export const inventoryIdentifierFormat = pgEnum("inventory_identifier_format", [
  "ean13",
  "gtin",
  "code128",
  "qr",
  "other",
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

/** Scan codes are retained for history; incorrect codes are deactivated, never deleted or reassigned. */
export const inventoryItemIdentifiers = pgTable(
  "inventory_item_identifiers",
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id),
    itemId: uuid("item_id").notNull().references(() => inventoryItems.id),
    code: text("code").notNull(),
    format: inventoryIdentifierFormat("format").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdByUserId: uuid("created_by_user_id").notNull().references(() => users.id),
    deactivatedByUserId: uuid("deactivated_by_user_id").references(() => users.id),
    deactivatedAt: timestamp("deactivated_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("inventory_item_identifiers_org_code_uq").on(t.organizationId, t.code),
    index("inventory_item_identifiers_item_idx").on(t.organizationId, t.itemId, t.isActive),
    check("inventory_item_identifiers_deactivation_complete", sql`(${t.isActive} and ${t.deactivatedAt} is null and ${t.deactivatedByUserId} is null) or (not ${t.isActive} and ${t.deactivatedAt} is not null and ${t.deactivatedByUserId} is not null)`),
  ],
);

export const inventoryPurchaseOrders = pgTable(
  "inventory_purchase_orders",
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id),
    number: text("number").notNull(),
    supplierId: uuid("supplier_id").notNull().references(() => suppliers.id),
    branchId: uuid("branch_id").notNull().references(() => branches.id),
    status: inventoryPurchaseOrderStatus("status").notNull().default("ordered"),
    orderedOn: date("ordered_on", { mode: "string" }).notNull(),
    expectedOn: date("expected_on", { mode: "string" }),
    notes: text("notes"),
    createdByUserId: uuid("created_by_user_id").notNull().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("inventory_purchase_orders_org_number_uq").on(t.organizationId, t.number),
    index("inventory_purchase_orders_status_idx").on(t.organizationId, t.status, t.orderedOn),
  ],
);

/** Ordered quantities and prices are immutable; corrections use a replacement order. */
export const inventoryPurchaseOrderLines = pgTable(
  "inventory_purchase_order_lines",
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id),
    purchaseOrderId: uuid("purchase_order_id").notNull().references(() => inventoryPurchaseOrders.id),
    itemId: uuid("item_id").notNull().references(() => inventoryItems.id),
    quantityOrdered: integer("quantity_ordered").notNull(),
    unitCostMinor: bigint("unit_cost_minor", { mode: "number" }),
    currency: text("currency").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("inventory_purchase_order_lines_item_uq").on(t.purchaseOrderId, t.itemId),
    index("inventory_purchase_order_lines_org_order_idx").on(t.organizationId, t.purchaseOrderId),
    check("inventory_purchase_order_lines_quantity_positive", sql`${t.quantityOrdered} > 0`),
    check("inventory_purchase_order_lines_cost_nonnegative", sql`${t.unitCostMinor} is null or ${t.unitCostMinor} >= 0`),
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
    purchaseOrderLineId: uuid("purchase_order_line_id").references(() => inventoryPurchaseOrderLines.id),
    /** Patient care that used this stock (lot recall traceability). */
    performedProcedureId: uuid("performed_procedure_id").references(() => performedProcedures.id),
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
    index("inventory_movements_purchase_order_line_idx").on(t.organizationId, t.purchaseOrderLineId),
    index("inventory_movements_procedure_idx").on(t.organizationId, t.performedProcedureId),
    check("inventory_movements_nonzero", sql`${t.quantityDelta} <> 0`),
  ],
);
