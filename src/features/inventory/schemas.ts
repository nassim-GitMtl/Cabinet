import { z } from "zod";

const required = z.string().trim().min(1, "required");
const uuid = z.string().uuid("required");
const quantity = z.coerce.number().int().min(1, "inventory.errors.quantity").max(1_000_000, "inventory.errors.quantity");
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "invalidDate");

export const inventoryUnits = ["piece", "box", "pack", "bottle", "cartridge", "milliliter", "gram"] as const;

export const createInventoryItemSchema = z.object({
  sku: required.max(40, "tooLong"),
  name: required.max(160, "tooLong"),
  category: z.string().trim().max(100, "tooLong").optional().transform((v) => v || null),
  unit: z.enum(inventoryUnits),
  minimumStock: z.coerce.number().int().min(0, "inventory.errors.minimum").max(1_000_000, "inventory.errors.minimum"),
});

export const receiveInventorySchema = z.object({
  itemId: uuid,
  branchId: uuid,
  lotNumber: required.max(100, "tooLong"),
  expiresOn: z.union([dateOnly, z.literal("")]).transform((v) => v || null),
  receivedOn: dateOnly,
  quantity,
  reference: z.string().trim().max(160, "tooLong").optional().transform((v) => v || null),
});

export const consumeInventorySchema = z.object({
  itemId: uuid,
  branchId: uuid,
  quantity,
  reference: z.string().trim().max(160, "tooLong").optional().transform((v) => v || null),
});

export const createPurchaseOrderSchema = z.object({
  supplierName: required.max(160, "tooLong"),
  branchId: uuid,
  orderedOn: dateOnly,
  expectedOn: z.union([dateOnly, z.literal("")]).transform((v) => v || null),
  notes: z.string().trim().max(500, "tooLong").optional().transform((v) => v || null),
  lines: z.array(z.object({
    itemId: uuid,
    quantity: quantity,
    unitCostMinor: z.number().int().min(0).safe().nullable(),
  })).min(1, "inventory.errors.orderLines").max(100, "inventory.errors.orderLines"),
});

export const receivePurchaseOrderLineSchema = z.object({
  lineId: uuid,
  lotNumber: required.max(100, "tooLong"),
  expiresOn: z.union([dateOnly, z.literal("")]).transform((v) => v || null),
  receivedOn: dateOnly,
  quantity,
  reference: z.string().trim().max(160, "tooLong").optional().transform((v) => v || null),
});

export type CreateInventoryItemInput = z.infer<typeof createInventoryItemSchema>;
export type ReceiveInventoryInput = z.infer<typeof receiveInventorySchema>;
export type ConsumeInventoryInput = z.infer<typeof consumeInventorySchema>;
export type CreatePurchaseOrderInput = z.infer<typeof createPurchaseOrderSchema>;
export type ReceivePurchaseOrderLineInput = z.infer<typeof receivePurchaseOrderLineSchema>;
