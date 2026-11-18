import "server-only";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { audit } from "@/server/audit";
import { can, ForbiddenError, requirePermission, tenantTx, type ClinicContext } from "@/server/auth/context";
import type { Tx } from "@/server/db/client";
import {
  inventoryItems,
  inventoryLots,
  inventoryMovements,
  memberships,
  organizations,
  patients,
  performedProcedures,
  procedureConsumptions,
  serviceConsumables,
  services,
} from "@/server/db/schema";
import { addDays, zonedToUtc } from "@/lib/dates";
import { consumeFefoInTx, InventoryError } from "./server";

const actor = (ctx: ClinicContext) => ({ organizationId: ctx.organizationId, actorType: "staff" as const, actorUserId: ctx.userId });

// ---------------------------------------------------------------------------
// Recipes (consumables per catalog service)
// ---------------------------------------------------------------------------

export async function listRecipes(ctx: ClinicContext) {
  requirePermission(ctx, "inventory.manage");
  return tenantTx(ctx, (tx) =>
    tx
      .select({
        id: serviceConsumables.id,
        quantity: serviceConsumables.quantity,
        serviceId: services.id,
        serviceCode: services.code,
        serviceName: services.name,
        itemId: inventoryItems.id,
        itemName: inventoryItems.name,
        itemSku: inventoryItems.sku,
        unit: inventoryItems.unit,
      })
      .from(serviceConsumables)
      .innerJoin(services, eq(services.id, serviceConsumables.serviceId))
      .innerJoin(inventoryItems, eq(inventoryItems.id, serviceConsumables.itemId))
      .orderBy(asc(services.code), asc(inventoryItems.name)),
  );
}

/** Adds or updates a recipe line (quantity per unit of the service). */
export async function setRecipe(ctx: ClinicContext, serviceId: string, itemId: string, quantity: number) {
  requirePermission(ctx, "inventory.manage");
  if (!Number.isInteger(quantity) || quantity <= 0 || quantity > 1000) throw new InventoryError("invalidQuantity");
  return tenantTx(ctx, async (tx) => {
    await tx
      .insert(serviceConsumables)
      .values({ organizationId: ctx.organizationId, serviceId, itemId, quantity, createdByUserId: ctx.userId })
      .onConflictDoUpdate({ target: [serviceConsumables.organizationId, serviceConsumables.serviceId, serviceConsumables.itemId], set: { quantity } });
    await audit(tx, { ...actor(ctx), action: "inventory.recipe.set", entityType: "service", entityId: serviceId, metadata: { itemId, quantity } });
  });
}

export async function removeRecipe(ctx: ClinicContext, id: string) {
  requirePermission(ctx, "inventory.manage");
  return tenantTx(ctx, async (tx) => {
    await tx.delete(serviceConsumables).where(eq(serviceConsumables.id, id));
    await audit(tx, { ...actor(ctx), action: "inventory.recipe.removed", entityType: "service_consumable", entityId: id });
  });
}

export async function setConsumablesMode(ctx: ClinicContext, mode: "suggest" | "auto") {
  requirePermission(ctx, "org.settings.manage");
  return tenantTx(ctx, async (tx) => {
    await tx
      .update(organizations)
      .set({ settings: sql`${organizations.settings} || ${JSON.stringify({ consumablesMode: mode })}::jsonb` })
      .where(eq(organizations.id, ctx.organizationId));
    await audit(tx, { ...actor(ctx), action: "inventory.consumables_mode", entityType: "organization", entityId: ctx.organizationId, metadata: { mode } });
  });
}

// ---------------------------------------------------------------------------
// Consumption from completed procedures
// ---------------------------------------------------------------------------

/**
 * Called inside the transaction that records a completed procedure. Creates
 * the recipe's consumptions as "pending"; in "auto" mode it consumes FEFO
 * right away when stock allows. A shortage never blocks recording care: the
 * line stays pending with a note.
 */
export async function planConsumptionsForProcedure(
  tx: Tx,
  ctx: ClinicContext,
  procedure: { id: string; serviceId: string; quantity: number; branchId: string },
  today: string,
) {
  const recipe = await tx.select().from(serviceConsumables).where(eq(serviceConsumables.serviceId, procedure.serviceId));
  if (!recipe.length) return;
  const auto = ctx.organization.settings.consumablesMode === "auto";
  for (const line of recipe) {
    const quantity = line.quantity * procedure.quantity;
    const [row] = await tx
      .insert(procedureConsumptions)
      .values({ organizationId: ctx.organizationId, performedProcedureId: procedure.id, itemId: line.itemId, branchId: procedure.branchId, quantity })
      .returning({ id: procedureConsumptions.id });
    if (!auto) continue;
    try {
      await consumeFefoInTx(tx, ctx, { itemId: line.itemId, branchId: procedure.branchId, quantity, reference: null, performedProcedureId: procedure.id }, today);
      await tx.update(procedureConsumptions).set({ status: "consumed", decidedByUserId: ctx.userId, decidedAt: new Date() }).where(eq(procedureConsumptions.id, row!.id));
    } catch (err) {
      if (!(err instanceof InventoryError)) throw err;
      await tx.update(procedureConsumptions).set({ note: err.code }).where(eq(procedureConsumptions.id, row!.id));
    }
  }
}

function requireConsumptionRights(ctx: ClinicContext) {
  if (!can(ctx, "inventory.manage") && !can(ctx, "clinical.write")) throw new ForbiddenError("inventory.manage");
}

export async function listPendingConsumptions(ctx: ClinicContext) {
  requireConsumptionRights(ctx);
  return tenantTx(ctx, (tx) =>
    tx
      .select({
        id: procedureConsumptions.id,
        quantity: procedureConsumptions.quantity,
        note: procedureConsumptions.note,
        createdAt: procedureConsumptions.createdAt,
        itemName: inventoryItems.name,
        unit: inventoryItems.unit,
        serviceDate: performedProcedures.serviceDate,
        serviceName: sql<Record<string, string>>`${performedProcedures.serviceSnapshot}->'name'`,
        patientId: patients.id,
        patientName: sql<string>`upper(${patients.lastName}) || ' ' || ${patients.firstName}`,
      })
      .from(procedureConsumptions)
      .innerJoin(inventoryItems, eq(inventoryItems.id, procedureConsumptions.itemId))
      .innerJoin(performedProcedures, eq(performedProcedures.id, procedureConsumptions.performedProcedureId))
      .innerJoin(patients, eq(patients.id, performedProcedures.patientId))
      .where(and(eq(procedureConsumptions.status, "pending"), eq(performedProcedures.status, "completed")))
      .orderBy(desc(procedureConsumptions.createdAt))
      .limit(200),
  );
}

export async function confirmConsumption(ctx: ClinicContext, id: string, today: string) {
  requireConsumptionRights(ctx);
  return tenantTx(ctx, async (tx) => {
    const [c] = await tx.select().from(procedureConsumptions).where(eq(procedureConsumptions.id, id)).for("update");
    if (!c) throw new InventoryError("notFound");
    if (c.status !== "pending") throw new InventoryError("alreadyDecided");
    const [proc] = await tx.select({ status: performedProcedures.status }).from(performedProcedures).where(eq(performedProcedures.id, c.performedProcedureId));
    if (proc?.status !== "completed") throw new InventoryError("procedureReversed");
    await consumeFefoInTx(tx, ctx, { itemId: c.itemId, branchId: c.branchId, quantity: c.quantity, reference: null, performedProcedureId: c.performedProcedureId }, today);
    await tx.update(procedureConsumptions).set({ status: "consumed", note: null, decidedByUserId: ctx.userId, decidedAt: new Date() }).where(eq(procedureConsumptions.id, id));
    await audit(tx, { ...actor(ctx), action: "inventory.consumption.confirmed", entityType: "procedure_consumption", entityId: id, metadata: { itemId: c.itemId, quantity: c.quantity } });
  });
}

export async function skipConsumption(ctx: ClinicContext, id: string, reason: string) {
  requireConsumptionRights(ctx);
  if (!reason.trim()) throw new InventoryError("reasonRequired");
  return tenantTx(ctx, async (tx) => {
    const [c] = await tx.select({ status: procedureConsumptions.status }).from(procedureConsumptions).where(eq(procedureConsumptions.id, id)).for("update");
    if (!c) throw new InventoryError("notFound");
    if (c.status !== "pending") throw new InventoryError("alreadyDecided");
    await tx.update(procedureConsumptions).set({ status: "skipped", note: reason.trim(), decidedByUserId: ctx.userId, decidedAt: new Date() }).where(eq(procedureConsumptions.id, id));
    await audit(tx, { ...actor(ctx), action: "inventory.consumption.skipped", entityType: "procedure_consumption", entityId: id });
  });
}

// ---------------------------------------------------------------------------
// Lot recall traceability
// ---------------------------------------------------------------------------

/** Which patients/procedures received stock from this lot (for a manufacturer recall). */
export async function getLotTrace(ctx: ClinicContext, lotId: string) {
  requirePermission(ctx, "inventory.manage");
  requirePermission(ctx, "patient.read");
  return tenantTx(ctx, async (tx) => {
    const [lot] = await tx
      .select({ lot: inventoryLots, itemName: inventoryItems.name, itemSku: inventoryItems.sku, unit: inventoryItems.unit })
      .from(inventoryLots)
      .innerJoin(inventoryItems, eq(inventoryItems.id, inventoryLots.itemId))
      .where(eq(inventoryLots.id, lotId));
    if (!lot) return null;
    const movements = await tx.select().from(inventoryMovements).where(eq(inventoryMovements.lotId, lotId)).orderBy(asc(inventoryMovements.createdAt));
    const patientsUsed = await tx
      .select({
        movementId: inventoryMovements.id,
        quantity: inventoryMovements.quantityDelta,
        occurredOn: inventoryMovements.occurredOn,
        procedureId: performedProcedures.id,
        serviceDate: performedProcedures.serviceDate,
        serviceSnapshot: performedProcedures.serviceSnapshot,
        toothNumber: performedProcedures.toothNumber,
        patientId: patients.id,
        patientNumber: patients.patientNumber,
        firstName: patients.firstName,
        lastName: patients.lastName,
        phone: patients.phone,
        providerName: memberships.displayName,
        providerTitle: memberships.title,
      })
      .from(inventoryMovements)
      .innerJoin(performedProcedures, eq(performedProcedures.id, inventoryMovements.performedProcedureId))
      .innerJoin(patients, eq(patients.id, performedProcedures.patientId))
      .innerJoin(memberships, eq(memberships.id, performedProcedures.performingProviderId))
      .where(eq(inventoryMovements.lotId, lotId))
      .orderBy(asc(performedProcedures.serviceDate));
    const balance = movements.reduce((s, m) => s + m.quantityDelta, 0);
    const untraced = movements.filter((m) => m.kind === "usage" && !m.performedProcedureId).reduce((s, m) => s - m.quantityDelta, 0);
    await audit(tx, { ...actor(ctx), action: "inventory.lot.traced", entityType: "inventory_lot", entityId: lotId, metadata: { patients: new Set(patientsUsed.map((p) => p.patientId)).size } });
    return { ...lot, movements, patients: patientsUsed, balance, untracedUsage: untraced };
  });
}

// ---------------------------------------------------------------------------
// Reorder suggestions (explainable)
// ---------------------------------------------------------------------------

export type ReorderSuggestion = {
  itemId: string;
  name: string;
  sku: string;
  unit: string;
  onHand: number;
  onOrder: number;
  minimumStock: number;
  usage90: number;
  dailyUsage: number;
  agendaFactor: number;
  projected30: number;
  suggested: number;
};

/**
 * Suggested quantity = max(0, projected 30-day need + minimum stock − usable on hand − already on order).
 * Projected need = average daily usage over the last 90 days × 30 × agenda factor, where the agenda
 * factor = booked appointments in the next 14 days ÷ average per 14 days over the last 90 days,
 * bounded to [0.5, 2]. Expired lots are not counted as on hand.
 */
export async function getReorderSuggestions(ctx: ClinicContext, today: string) {
  requirePermission(ctx, "inventory.manage");
  const tz = ctx.organization.timezone;
  const now = zonedToUtc(today, "00:00", tz).toISOString();
  const in14 = zonedToUtc(addDays(today, 14), "00:00", tz).toISOString();
  const ago90 = zonedToUtc(addDays(today, -90), "00:00", tz).toISOString();
  return tenantTx(ctx, async (tx) => {
    const [agenda] = (await tx.execute<{ upcoming: string; past: string }>(sql`
      select
        (select count(*) from appointments where scheduling_status = 'booked' and starts_at >= ${now}::timestamptz and starts_at < ${in14}::timestamptz)::text as upcoming,
        (select count(*) from appointments where scheduling_status in ('booked', 'no_show') and starts_at >= ${ago90}::timestamptz and starts_at < ${now}::timestamptz)::text as past`)) as unknown as [{ upcoming: string; past: string }];
    const avgPer14 = Number(agenda?.past ?? 0) / (90 / 14);
    const agendaFactor = avgPer14 > 0 ? Math.min(2, Math.max(0.5, Number(agenda?.upcoming ?? 0) / avgPer14)) : 1;
    const rows = await tx.execute<{ id: string; name: string; sku: string; unit: string; minimum_stock: number; on_hand: string; usage90: string; on_order: string }>(sql`
      select i.id, i.name, i.sku, i.unit::text, i.minimum_stock,
        coalesce((select sum(m.quantity_delta) from inventory_movements m join inventory_lots l on l.id = m.lot_id
                   where m.item_id = i.id and (l.expires_on is null or l.expires_on >= ${today}::date)), 0)::text as on_hand,
        coalesce((select -sum(m.quantity_delta) from inventory_movements m
                   where m.item_id = i.id and m.kind = 'usage' and m.occurred_on >= ${addDays(today, -90)}::date), 0)::text as usage90,
        coalesce((select sum(greatest(pl.quantity_ordered - coalesce((select sum(m.quantity_delta) from inventory_movements m where m.purchase_order_line_id = pl.id), 0), 0))
                   from inventory_purchase_order_lines pl join inventory_purchase_orders po on po.id = pl.purchase_order_id
                  where pl.item_id = i.id and po.status in ('ordered', 'partially_received')), 0)::text as on_order
        from inventory_items i
       where i.is_active
       order by i.name`);
    const suggestions: ReorderSuggestion[] = rows.map((r) => {
      const usage90 = Number(r.usage90);
      const dailyUsage = usage90 / 90;
      const projected30 = Math.ceil(dailyUsage * 30 * agendaFactor);
      const onHand = Number(r.on_hand);
      const onOrder = Number(r.on_order);
      return {
        itemId: r.id,
        name: r.name,
        sku: r.sku,
        unit: r.unit,
        onHand,
        onOrder,
        minimumStock: r.minimum_stock,
        usage90,
        dailyUsage,
        agendaFactor,
        projected30,
        suggested: Math.max(0, projected30 + r.minimum_stock - onHand - onOrder),
      };
    });
    return { agendaFactor, upcomingAppointments: Number(agenda?.upcoming ?? 0), averagePer14: avgPer14, suggestions: suggestions.filter((s) => s.suggested > 0) };
  });
}
