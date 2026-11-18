import "server-only";

import { and, asc, eq, gte, inArray, isNull, or, sql } from "drizzle-orm";
import { audit } from "@/server/audit";
import { requirePermission, tenantTx, type ClinicContext } from "@/server/auth/context";
import {
  branches,
  inventoryItems,
  inventoryLots,
  inventoryMovements,
} from "@/server/db/schema";
import type { ConsumeInventoryInput, CreateInventoryItemInput, ReceiveInventoryInput } from "./schemas";

export class InventoryError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}

const actor = (ctx: ClinicContext) => ({ organizationId: ctx.organizationId, actorType: "staff" as const, actorUserId: ctx.userId });

export async function getInventory(ctx: ClinicContext, today: string) {
  requirePermission(ctx, "inventory.manage");
  return tenantTx(ctx, async (tx) => {
    const [itemRows, lotRows, totals, branchRows] = await Promise.all([
      tx.select().from(inventoryItems).where(eq(inventoryItems.isActive, true)).orderBy(asc(inventoryItems.name)),
      tx
        .select({ lot: inventoryLots, branchName: branches.name })
        .from(inventoryLots)
        .innerJoin(branches, eq(branches.id, inventoryLots.branchId))
        .orderBy(asc(inventoryLots.expiresOn), asc(inventoryLots.receivedOn)),
      tx
        .select({ lotId: inventoryMovements.lotId, balance: sql<number>`coalesce(sum(${inventoryMovements.quantityDelta}), 0)::int` })
        .from(inventoryMovements)
        .groupBy(inventoryMovements.lotId),
      tx.select({ id: branches.id, name: branches.name, active: branches.isActive }).from(branches).orderBy(asc(branches.name)),
    ]);
    const balances = new Map(totals.map((x) => [x.lotId, Number(x.balance)]));
    const items = itemRows.map((item) => {
      const lots = lotRows
        .filter((x) => x.lot.itemId === item.id)
        .map((x) => ({ ...x.lot, branchName: x.branchName, balance: balances.get(x.lot.id) ?? 0 }));
      const physicalStock = lots.reduce((sum, lot) => sum + lot.balance, 0);
      const stock = lots.filter((lot) => !lot.expiresOn || lot.expiresOn >= today).reduce((sum, lot) => sum + lot.balance, 0);
      return { ...item, stock, physicalStock, low: item.minimumStock > 0 && stock <= item.minimumStock, lots };
    });
    const stockedLots = items.flatMap((item) => item.lots.map((lot) => ({ ...lot, itemId: item.id, itemName: item.name, sku: item.sku, unit: item.unit }))).filter((lot) => lot.balance > 0);
    const expiresBefore = new Date(`${today}T00:00:00Z`);
    expiresBefore.setUTCDate(expiresBefore.getUTCDate() + 60);
    const expiryLimit = expiresBefore.toISOString().slice(0, 10);
    return {
      items,
      branches: branchRows,
      lowStock: items.filter((item) => item.low),
      expired: stockedLots.filter((lot) => lot.expiresOn && lot.expiresOn < today),
      expiring: stockedLots.filter((lot) => lot.expiresOn && lot.expiresOn >= today && lot.expiresOn <= expiryLimit),
    };
  });
}

export async function createInventoryItem(ctx: ClinicContext, input: CreateInventoryItemInput) {
  requirePermission(ctx, "inventory.manage");
  return tenantTx(ctx, async (tx) => {
    const sku = input.sku.trim().toUpperCase();
    const [duplicate] = await tx.select({ id: inventoryItems.id }).from(inventoryItems).where(sql`lower(${inventoryItems.sku}) = lower(${sku})`).limit(1);
    if (duplicate) throw new InventoryError("duplicateSku");
    const [row] = await tx.insert(inventoryItems).values({
      organizationId: ctx.organizationId,
      sku,
      name: input.name.trim(),
      category: input.category,
      unit: input.unit,
      minimumStock: input.minimumStock,
    }).returning({ id: inventoryItems.id });
    await audit(tx, { ...actor(ctx), action: "inventory.item_created", entityType: "inventory_item", entityId: row!.id });
    return row!.id;
  });
}

export async function receiveInventory(ctx: ClinicContext, input: ReceiveInventoryInput) {
  requirePermission(ctx, "inventory.manage");
  return tenantTx(ctx, async (tx) => {
    const [[item], [branch]] = await Promise.all([
      tx.select({ id: inventoryItems.id }).from(inventoryItems).where(and(eq(inventoryItems.id, input.itemId), eq(inventoryItems.isActive, true))).limit(1),
      tx.select({ id: branches.id }).from(branches).where(and(eq(branches.id, input.branchId), eq(branches.isActive, true))).limit(1),
    ]);
    if (!item) throw new InventoryError("itemUnavailable");
    if (!branch) throw new InventoryError("branchUnavailable");
    const lotNumber = input.lotNumber.trim();
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${input.itemId}:${input.branchId}:${lotNumber.toLowerCase()}`}, 0))`);
    const [existing] = await tx.select().from(inventoryLots).where(and(
      eq(inventoryLots.itemId, input.itemId),
      eq(inventoryLots.branchId, input.branchId),
      sql`lower(${inventoryLots.lotNumber}) = lower(${lotNumber})`,
    )).limit(1);
    let lotId = existing?.id;
    if (existing && existing.expiresOn !== input.expiresOn) throw new InventoryError("lotConflict");
    if (!lotId) {
      const [lot] = await tx.insert(inventoryLots).values({
        organizationId: ctx.organizationId,
        itemId: input.itemId,
        branchId: input.branchId,
        lotNumber,
        expiresOn: input.expiresOn,
        receivedOn: input.receivedOn,
      }).returning({ id: inventoryLots.id });
      lotId = lot!.id;
    }
    const [movement] = await tx.insert(inventoryMovements).values({
      organizationId: ctx.organizationId,
      itemId: input.itemId,
      lotId,
      branchId: input.branchId,
      kind: "receipt",
      quantityDelta: input.quantity,
      occurredOn: input.receivedOn,
      reference: input.reference,
      createdByUserId: ctx.userId,
    }).returning({ id: inventoryMovements.id });
    await audit(tx, { ...actor(ctx), action: "inventory.received", entityType: "inventory_movement", entityId: movement!.id, metadata: { itemId: input.itemId, lotId, branchId: input.branchId, quantity: input.quantity } });
    return movement!.id;
  });
}

/** Consumes stock from the earliest-expiring usable lots first (FEFO). */
export async function consumeInventoryFefo(ctx: ClinicContext, input: ConsumeInventoryInput, today: string) {
  requirePermission(ctx, "inventory.manage");
  return tenantTx(ctx, async (tx) => {
    const [[item], [branch]] = await Promise.all([
      tx.select({ id: inventoryItems.id }).from(inventoryItems).where(and(eq(inventoryItems.id, input.itemId), eq(inventoryItems.isActive, true))).limit(1),
      tx.select({ id: branches.id }).from(branches).where(and(eq(branches.id, input.branchId), eq(branches.isActive, true))).limit(1),
    ]);
    if (!item) throw new InventoryError("itemUnavailable");
    if (!branch) throw new InventoryError("branchUnavailable");
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${input.itemId}:${input.branchId}`}, 0))`);
    const lots = await tx.select().from(inventoryLots).where(and(
      eq(inventoryLots.itemId, input.itemId),
      eq(inventoryLots.branchId, input.branchId),
      or(isNull(inventoryLots.expiresOn), gte(inventoryLots.expiresOn, today)),
    )).orderBy(sql`${inventoryLots.expiresOn} asc nulls last`, asc(inventoryLots.receivedOn), asc(inventoryLots.id));
    const movementRows = lots.length
      ? await tx.select({ lotId: inventoryMovements.lotId, delta: inventoryMovements.quantityDelta }).from(inventoryMovements).where(inArray(inventoryMovements.lotId, lots.map((lot) => lot.id)))
      : [];
    const balances = new Map<string, number>();
    for (const row of movementRows) balances.set(row.lotId, (balances.get(row.lotId) ?? 0) + row.delta);
    let remaining = input.quantity;
    const allocations: { lotId: string; quantity: number }[] = [];
    for (const lot of lots) {
      const available = balances.get(lot.id) ?? 0;
      if (available <= 0) continue;
      const quantity = Math.min(available, remaining);
      allocations.push({ lotId: lot.id, quantity });
      remaining -= quantity;
      if (remaining === 0) break;
    }
    if (remaining > 0) throw new InventoryError("insufficientStock");
    for (const allocation of allocations) {
      await tx.insert(inventoryMovements).values({
        organizationId: ctx.organizationId,
        itemId: input.itemId,
        lotId: allocation.lotId,
        branchId: input.branchId,
        kind: "usage",
        quantityDelta: -allocation.quantity,
        occurredOn: today,
        reference: input.reference,
        createdByUserId: ctx.userId,
      });
    }
    await audit(tx, { ...actor(ctx), action: "inventory.consumed_fefo", entityType: "inventory_item", entityId: input.itemId, metadata: { branchId: input.branchId, quantity: input.quantity, lotCount: allocations.length } });
    return allocations;
  });
}
