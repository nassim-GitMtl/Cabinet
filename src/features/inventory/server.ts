import "server-only";

import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { audit } from "@/server/audit";
import { requirePermission, tenantTx, type ClinicContext } from "@/server/auth/context";
import {
  branches,
  inventoryItems,
  inventoryLots,
  inventoryMovements,
  inventoryPurchaseOrderLines,
  inventoryPurchaseOrders,
  suppliers,
} from "@/server/db/schema";
import { nextCounter } from "@/server/db/tenant";
import type { ConsumeInventoryInput, CreateInventoryItemInput, CreatePurchaseOrderInput, ReceiveInventoryInput, ReceivePurchaseOrderLineInput } from "./schemas";

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

export async function getPurchaseOrders(ctx: ClinicContext) {
  requirePermission(ctx, "inventory.manage");
  return tenantTx(ctx, async (tx) => {
    const [orders, lines, receipts] = await Promise.all([
      tx.select({ order: inventoryPurchaseOrders, supplierName: suppliers.name, branchName: branches.name })
        .from(inventoryPurchaseOrders)
        .innerJoin(suppliers, eq(suppliers.id, inventoryPurchaseOrders.supplierId))
        .innerJoin(branches, eq(branches.id, inventoryPurchaseOrders.branchId))
        .orderBy(desc(inventoryPurchaseOrders.orderedOn), desc(inventoryPurchaseOrders.createdAt)),
      tx.select({ line: inventoryPurchaseOrderLines, itemName: inventoryItems.name, sku: inventoryItems.sku, unit: inventoryItems.unit })
        .from(inventoryPurchaseOrderLines)
        .innerJoin(inventoryItems, eq(inventoryItems.id, inventoryPurchaseOrderLines.itemId))
        .orderBy(asc(inventoryItems.name)),
      tx.select({ lineId: inventoryMovements.purchaseOrderLineId, received: sql<number>`coalesce(sum(${inventoryMovements.quantityDelta}), 0)::int` })
        .from(inventoryMovements)
        .where(isNotNull(inventoryMovements.purchaseOrderLineId))
        .groupBy(inventoryMovements.purchaseOrderLineId),
    ]);
    const receivedByLine = new Map(receipts.map((row) => [row.lineId!, Number(row.received)]));
    return orders.map(({ order, supplierName, branchName }) => ({
      ...order,
      supplierName,
      branchName,
      lines: lines.filter((row) => row.line.purchaseOrderId === order.id).map((row) => {
        const received = receivedByLine.get(row.line.id) ?? 0;
        return { ...row.line, itemName: row.itemName, sku: row.sku, unit: row.unit, received, remaining: row.line.quantityOrdered - received };
      }),
    }));
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

export async function createPurchaseOrder(ctx: ClinicContext, input: CreatePurchaseOrderInput) {
  requirePermission(ctx, "inventory.manage");
  return tenantTx(ctx, async (tx) => {
    const uniqueItemIds = [...new Set(input.lines.map((line) => line.itemId))];
    if (!uniqueItemIds.length || uniqueItemIds.length !== input.lines.length) throw new InventoryError("invalidOrderLines");
    const [[branch], items] = await Promise.all([
      tx.select({ id: branches.id }).from(branches).where(and(eq(branches.id, input.branchId), eq(branches.isActive, true))).limit(1),
      tx.select({ id: inventoryItems.id }).from(inventoryItems).where(and(inArray(inventoryItems.id, uniqueItemIds), eq(inventoryItems.isActive, true))),
    ]);
    if (!branch) throw new InventoryError("branchUnavailable");
    if (items.length !== uniqueItemIds.length) throw new InventoryError("itemUnavailable");

    const supplierName = input.supplierName.trim();
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`supplier:${supplierName.toLowerCase()}`}, 0))`);
    let [supplier] = await tx.select({ id: suppliers.id }).from(suppliers).where(sql`lower(${suppliers.name}) = lower(${supplierName})`).limit(1);
    if (!supplier) {
      [supplier] = await tx.insert(suppliers).values({ organizationId: ctx.organizationId, name: supplierName }).returning({ id: suppliers.id });
    }
    const year = input.orderedOn.slice(0, 4);
    const sequence = await nextCounter(tx, ctx.organizationId, `inventory_po:${year}`);
    const number = `BC-${year}-${String(sequence).padStart(5, "0")}`;
    const [order] = await tx.insert(inventoryPurchaseOrders).values({
      organizationId: ctx.organizationId,
      number,
      supplierId: supplier!.id,
      branchId: input.branchId,
      orderedOn: input.orderedOn,
      expectedOn: input.expectedOn,
      notes: input.notes,
      createdByUserId: ctx.userId,
    }).returning({ id: inventoryPurchaseOrders.id });
    await tx.insert(inventoryPurchaseOrderLines).values(input.lines.map((line) => ({
      organizationId: ctx.organizationId,
      purchaseOrderId: order!.id,
      itemId: line.itemId,
      quantityOrdered: line.quantity,
      unitCostMinor: line.unitCostMinor,
      currency: ctx.organization.defaultCurrency,
    })));
    await audit(tx, { ...actor(ctx), action: "inventory.purchase_order_created", entityType: "inventory_purchase_order", entityId: order!.id, metadata: { number, branchId: input.branchId, lineCount: input.lines.length } });
    return order!.id;
  });
}

export async function receivePurchaseOrderLine(ctx: ClinicContext, input: ReceivePurchaseOrderLineInput) {
  requirePermission(ctx, "inventory.manage");
  return tenantTx(ctx, async (tx) => {
    const lineId = input.lineId;
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`purchase-order-line:${lineId}`}, 0))`);
    const [record] = await tx.select({ line: inventoryPurchaseOrderLines, order: inventoryPurchaseOrders })
      .from(inventoryPurchaseOrderLines)
      .innerJoin(inventoryPurchaseOrders, eq(inventoryPurchaseOrders.id, inventoryPurchaseOrderLines.purchaseOrderId))
      .where(eq(inventoryPurchaseOrderLines.id, lineId)).limit(1);
    if (!record) throw new InventoryError("orderLineUnavailable");
    if (record.order.status === "cancelled" || record.order.status === "received") throw new InventoryError("orderClosed");
    const [total] = await tx.select({ received: sql<number>`coalesce(sum(${inventoryMovements.quantityDelta}), 0)::int` })
      .from(inventoryMovements).where(eq(inventoryMovements.purchaseOrderLineId, lineId));
    const remaining = record.line.quantityOrdered - Number(total?.received ?? 0);
    if (input.quantity > remaining) throw new InventoryError("quantityExceedsOrder");

    const lotNumber = input.lotNumber.trim();
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${record.line.itemId}:${record.order.branchId}:${lotNumber.toLowerCase()}`}, 0))`);
    const [existing] = await tx.select().from(inventoryLots).where(and(
      eq(inventoryLots.itemId, record.line.itemId),
      eq(inventoryLots.branchId, record.order.branchId),
      sql`lower(${inventoryLots.lotNumber}) = lower(${lotNumber})`,
    )).limit(1);
    if (existing && existing.expiresOn !== input.expiresOn) throw new InventoryError("lotConflict");
    let lotId = existing?.id;
    if (!lotId) {
      const [lot] = await tx.insert(inventoryLots).values({ organizationId: ctx.organizationId, itemId: record.line.itemId, branchId: record.order.branchId, lotNumber, expiresOn: input.expiresOn, receivedOn: input.receivedOn }).returning({ id: inventoryLots.id });
      lotId = lot!.id;
    }
    const [movement] = await tx.insert(inventoryMovements).values({
      organizationId: ctx.organizationId,
      itemId: record.line.itemId,
      lotId,
      branchId: record.order.branchId,
      kind: "receipt",
      purchaseOrderLineId: lineId,
      quantityDelta: input.quantity,
      occurredOn: input.receivedOn,
      reference: input.reference ?? record.order.number,
      createdByUserId: ctx.userId,
    }).returning({ id: inventoryMovements.id });

    const orderLines = await tx.select({ id: inventoryPurchaseOrderLines.id, ordered: inventoryPurchaseOrderLines.quantityOrdered })
      .from(inventoryPurchaseOrderLines).where(eq(inventoryPurchaseOrderLines.purchaseOrderId, record.order.id));
    const receiptTotals = await tx.select({ lineId: inventoryMovements.purchaseOrderLineId, received: sql<number>`sum(${inventoryMovements.quantityDelta})::int` })
      .from(inventoryMovements)
      .where(and(inArray(inventoryMovements.purchaseOrderLineId, orderLines.map((line) => line.id)), isNotNull(inventoryMovements.purchaseOrderLineId)))
      .groupBy(inventoryMovements.purchaseOrderLineId);
    const byLine = new Map(receiptTotals.map((row) => [row.lineId!, Number(row.received)]));
    const complete = orderLines.every((line) => (byLine.get(line.id) ?? 0) >= line.ordered);
    await tx.update(inventoryPurchaseOrders).set({ status: complete ? "received" : "partially_received" }).where(eq(inventoryPurchaseOrders.id, record.order.id));
    await audit(tx, { ...actor(ctx), action: "inventory.purchase_order_received", entityType: "inventory_movement", entityId: movement!.id, metadata: { purchaseOrderId: record.order.id, purchaseOrderLineId: lineId, lotId, quantity: input.quantity } });
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
