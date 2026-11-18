import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { consumeInventoryFefo, createInventoryItem, getInventory, receiveInventory } from "@/features/inventory/server";
import { ForbiddenError } from "@/server/auth/context";
import { inventoryItems, inventoryLots, inventoryMovements } from "@/server/db/schema";
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
    const other = await makeClinic("Cabinet Inventaire D");
    expect((await getInventory(other, "2026-11-18")).items).toHaveLength(0);
    const otherDb = { organizationId: other.organizationId, userId: other.userId, actorType: "staff" as const };
    await expectDbError(withDbContext(otherDb, (tx) => tx.insert(inventoryItems).values({ organizationId: f.ctx.organizationId, sku: "CROSS", name: "Cross", unit: "piece", minimumStock: 0 })), /row-level security/);
  });
});
