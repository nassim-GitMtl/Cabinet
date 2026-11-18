import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { consumeInventoryFefo, createInventoryItem, createPurchaseOrder, deactivateInventoryIdentifier, getInventory, getInventoryIdentifiers, getPurchaseOrders, receiveInventory, receivePurchaseOrderLine, registerInventoryIdentifier } from "@/features/inventory/server";
import { ForbiddenError } from "@/server/auth/context";
import { inventoryItemIdentifiers, inventoryItems, inventoryLots, inventoryMovements, inventoryPurchaseOrderLines, inventoryPurchaseOrders } from "@/server/db/schema";
import { withDbContext } from "@/server/db/tenant";
import { contextFor, expectDbError, makeClinic } from "../support/factories";

async function setup(name: string) {
  const ctx = await makeClinic(name);
  const initial = await getInventory(ctx, "2026-11-18");
  const branch = initial.branches.find((row) => row.active);
  if (!branch) throw new Error("fixture branch missing");
  const itemId = await createInventoryItem(ctx, { sku: "COMP-001", name: "Composite", category: "Restaurations", unit: "cartridge", minimumStock: 4 });
  return { ctx, branchId: branch.id, itemId };
}

describe("inventory", () => {
  it("registers immutable scan identifiers, normalizes GS1 and deactivates corrections", async () => {
    const f = await setup("Cabinet Inventaire Scan");
    const identifierId = await registerInventoryIdentifier(f.ctx, { itemId: f.itemId, code: "]C1(01)01234567890128(17)271231(10)LOT-A", format: "other" });
    let identifiers = await getInventoryIdentifiers(f.ctx);
    expect(identifiers).toHaveLength(1);
    expect(identifiers[0]!.identifier).toMatchObject({ id: identifierId, itemId: f.itemId, code: "01234567890128", format: "gtin", isActive: true });
    await expect(registerInventoryIdentifier(f.ctx, { itemId: f.itemId, code: "01234567890128", format: "gtin" })).rejects.toMatchObject({ code: "duplicateScanCode" });

    const db = { organizationId: f.ctx.organizationId, userId: f.ctx.userId, actorType: "staff" as const };
    await expectDbError(withDbContext(db, (tx) => tx.update(inventoryItemIdentifiers).set({ code: "CHANGED" }).where(eq(inventoryItemIdentifiers.id, identifierId))), /may only be deactivated once/);
    await deactivateInventoryIdentifier(f.ctx, identifierId);
    identifiers = await getInventoryIdentifiers(f.ctx);
    expect(identifiers).toHaveLength(0);
    await expect(deactivateInventoryIdentifier(f.ctx, identifierId)).rejects.toMatchObject({ code: "identifierUnavailable" });
  });

  it("tracks supplier purchase orders through partial and complete lot receipts", async () => {
    const f = await setup("Cabinet Inventaire Commandes");
    const orderId = await createPurchaseOrder(f.ctx, {
      supplierName: "Dental Supply Alger",
      branchId: f.branchId,
      orderedOn: "2026-11-18",
      expectedOn: "2026-11-25",
      notes: "Livraison fractionnée",
      lines: [{ itemId: f.itemId, quantity: 10, unitCostMinor: 125_000 }],
    });
    let [order] = await getPurchaseOrders(f.ctx);
    expect(order).toMatchObject({ id: orderId, number: "BC-2026-00001", status: "ordered", supplierName: "Dental Supply Alger" });
    expect(order!.lines[0]).toMatchObject({ quantityOrdered: 10, received: 0, remaining: 10, unitCostMinor: 125_000 });

    const lineId = order!.lines[0]!.id;
    await receivePurchaseOrderLine(f.ctx, { lineId, lotNumber: "PO-A", receivedOn: "2026-11-18", expiresOn: "2027-12-31", quantity: 4, reference: "BL-1" });
    [order] = await getPurchaseOrders(f.ctx);
    expect(order!.status).toBe("partially_received");
    expect(order!.lines[0]).toMatchObject({ received: 4, remaining: 6 });
    await expect(receivePurchaseOrderLine(f.ctx, { lineId, lotNumber: "PO-A", receivedOn: "2026-11-18", expiresOn: "2027-12-31", quantity: 7, reference: null })).rejects.toMatchObject({ code: "quantityExceedsOrder" });
    const db = { organizationId: f.ctx.organizationId, userId: f.ctx.userId, actorType: "staff" as const };
    const lot = await withDbContext(db, async (tx) => (await tx.select().from(inventoryLots).where(eq(inventoryLots.itemId, f.itemId)).limit(1))[0]!);
    await expectDbError(withDbContext(db, (tx) => tx.insert(inventoryMovements).values({ organizationId: f.ctx.organizationId, itemId: f.itemId, lotId: lot.id, branchId: f.branchId, kind: "receipt", purchaseOrderLineId: lineId, quantityDelta: 7, occurredOn: "2026-11-18", createdByUserId: f.ctx.userId })), /receipt exceeds ordered quantity/);

    await receivePurchaseOrderLine(f.ctx, { lineId, lotNumber: "PO-A", receivedOn: "2026-11-19", expiresOn: "2027-12-31", quantity: 6, reference: "BL-2" });
    [order] = await getPurchaseOrders(f.ctx);
    expect(order!.status).toBe("received");
    expect(order!.lines[0]).toMatchObject({ received: 10, remaining: 0 });
    expect((await getInventory(f.ctx, "2026-11-19")).items.find((item) => item.id === f.itemId)?.stock).toBe(10);
  });

  it("consumes the earliest-expiring usable lots first and derives alerts", async () => {
    const f = await setup("Cabinet Inventaire A");
    await receiveInventory(f.ctx, { itemId: f.itemId, branchId: f.branchId, lotNumber: "LATE", receivedOn: "2026-11-01", expiresOn: "2027-05-01", quantity: 8, reference: null });
    await receiveInventory(f.ctx, { itemId: f.itemId, branchId: f.branchId, lotNumber: "EARLY", receivedOn: "2026-11-02", expiresOn: "2027-01-01", quantity: 5, reference: "BL-42" });

    const allocations = await consumeInventoryFefo(f.ctx, { itemId: f.itemId, branchId: f.branchId, quantity: 6, reference: "Salle 1" }, "2026-11-18");
    expect(allocations.map((row) => row.quantity)).toEqual([5, 1]);
    let view = await getInventory(f.ctx, "2026-11-18");
    const item = view.items.find((row) => row.id === f.itemId)!;
    expect(item.stock).toBe(7);
    expect(item.lots.find((row) => row.lotNumber === "EARLY")?.balance).toBe(0);
    expect(item.lots.find((row) => row.lotNumber === "LATE")?.balance).toBe(7);

    await consumeInventoryFefo(f.ctx, { itemId: f.itemId, branchId: f.branchId, quantity: 4, reference: null }, "2026-11-18");
    view = await getInventory(f.ctx, "2026-11-18");
    expect(view.lowStock.map((row) => row.id)).toContain(f.itemId);
  });

  it("excludes expired lots and database guards prevent negative or mutable ledger rows", async () => {
    const f = await setup("Cabinet Inventaire B");
    await receiveInventory(f.ctx, { itemId: f.itemId, branchId: f.branchId, lotNumber: "OLD", receivedOn: "2025-01-01", expiresOn: "2026-01-01", quantity: 10, reference: null });
    const view = await getInventory(f.ctx, "2026-11-18");
    expect(view.expired.map((row) => row.lotNumber)).toEqual(["OLD"]);
    await expect(consumeInventoryFefo(f.ctx, { itemId: f.itemId, branchId: f.branchId, quantity: 1, reference: null }, "2026-11-18")).rejects.toMatchObject({ code: "insufficientStock" });

    const db = { organizationId: f.ctx.organizationId, userId: f.ctx.userId, actorType: "staff" as const };
    const lot = await withDbContext(db, async (tx) => (await tx.select().from(inventoryLots).where(eq(inventoryLots.itemId, f.itemId)).limit(1))[0]!);
    const movement = await withDbContext(db, async (tx) => (await tx.select().from(inventoryMovements).where(eq(inventoryMovements.lotId, lot.id)).limit(1))[0]!);
    await expectDbError(withDbContext(db, (tx) => tx.update(inventoryMovements).set({ reference: "changed" }).where(eq(inventoryMovements.id, movement.id))), /permission denied/);
    await expectDbError(withDbContext(db, (tx) => tx.insert(inventoryMovements).values({ organizationId: f.ctx.organizationId, itemId: f.itemId, lotId: lot.id, branchId: f.branchId, kind: "usage", quantityDelta: -11, occurredOn: "2026-11-18", createdByUserId: f.ctx.userId })), /balance cannot be negative/);
  });

  it("enforces permission keys and cross-tenant isolation", async () => {
    const f = await setup("Cabinet Inventaire C");
    await expect(getInventory(contextFor(f.ctx, "accountant"), "2026-11-18")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getPurchaseOrders(contextFor(f.ctx, "accountant"))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getInventoryIdentifiers(contextFor(f.ctx, "accountant"))).rejects.toBeInstanceOf(ForbiddenError);
    const other = await makeClinic("Cabinet Inventaire D");
    expect((await getInventory(other, "2026-11-18")).items).toHaveLength(0);
    const otherDb = { organizationId: other.organizationId, userId: other.userId, actorType: "staff" as const };
    await expectDbError(withDbContext(otherDb, (tx) => tx.insert(inventoryItems).values({ organizationId: f.ctx.organizationId, sku: "CROSS", name: "Cross", unit: "piece", minimumStock: 0 })), /row-level security/);

    const orderId = await createPurchaseOrder(f.ctx, { supplierName: "Isolation Supplier", branchId: f.branchId, orderedOn: "2026-11-18", expectedOn: null, notes: null, lines: [{ itemId: f.itemId, quantity: 2, unitCostMinor: null }] });
    const ownDb = { organizationId: f.ctx.organizationId, userId: f.ctx.userId, actorType: "staff" as const };
    const order = await withDbContext(ownDb, async (tx) => (await tx.select().from(inventoryPurchaseOrders).where(eq(inventoryPurchaseOrders.id, orderId)).limit(1))[0]!);
    const line = await withDbContext(ownDb, async (tx) => (await tx.select().from(inventoryPurchaseOrderLines).where(eq(inventoryPurchaseOrderLines.purchaseOrderId, orderId)).limit(1))[0]!);
    await expectDbError(withDbContext(otherDb, (tx) => tx.insert(inventoryPurchaseOrders).values({ organizationId: f.ctx.organizationId, number: "CROSS-PO", supplierId: order.supplierId, branchId: f.branchId, orderedOn: "2026-11-18", createdByUserId: other.userId })), /row-level security|references must belong/);
    await expectDbError(withDbContext(ownDb, (tx) => tx.update(inventoryPurchaseOrderLines).set({ quantityOrdered: 99 }).where(eq(inventoryPurchaseOrderLines.id, line.id))), /permission denied/);
    await expectDbError(withDbContext(otherDb, (tx) => tx.insert(inventoryItemIdentifiers).values({ organizationId: f.ctx.organizationId, itemId: f.itemId, code: "CROSS-CODE", format: "other", createdByUserId: other.userId })), /row-level security|same organization/);
  });
});
