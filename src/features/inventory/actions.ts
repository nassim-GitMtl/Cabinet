"use server";

import { revalidatePath } from "next/cache";
import { fieldErrorsOf, formValues, type ActionState } from "@/lib/action-state";
import { todayInZone } from "@/lib/dates";
import { parseMoneyInput } from "@/lib/money";
import { ForbiddenError, requireClinicContext } from "@/server/auth/context";
import { consumeInventoryFefo, createInventoryItem, createPurchaseOrder, InventoryError, receiveInventory, receivePurchaseOrderLine } from "./server";
import { consumeInventorySchema, createInventoryItemSchema, createPurchaseOrderSchema, receiveInventorySchema, receivePurchaseOrderLineSchema } from "./schemas";

function fail(error: unknown, values: Record<string, string>): ActionState {
  if (error instanceof ForbiddenError) return { error: "forbidden", values };
  if (error instanceof InventoryError) return { error: `inventory.errors.${error.code}`, values };
  throw error;
}

function done(): ActionState {
  revalidatePath("/inventory");
  return { ok: true };
}

export async function createInventoryItemAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await requireClinicContext();
  const values = formValues(formData);
  const parsed = createInventoryItemSchema.safeParse(values);
  if (!parsed.success) return { fieldErrors: fieldErrorsOf(parsed.error), values };
  try {
    await createInventoryItem(ctx, parsed.data);
  } catch (error) {
    return fail(error, values);
  }
  return done();
}

export async function receiveInventoryAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await requireClinicContext();
  const values = formValues(formData);
  const parsed = receiveInventorySchema.safeParse(values);
  if (!parsed.success) return { fieldErrors: fieldErrorsOf(parsed.error), values };
  const today = todayInZone(ctx.organization.timezone);
  if (parsed.data.receivedOn > today) return { fieldErrors: { receivedOn: "futureDate" }, values };
  try {
    await receiveInventory(ctx, parsed.data);
  } catch (error) {
    return fail(error, values);
  }
  return done();
}

export async function consumeInventoryAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await requireClinicContext();
  const values = formValues(formData);
  const parsed = consumeInventorySchema.safeParse(values);
  if (!parsed.success) return { fieldErrors: fieldErrorsOf(parsed.error), values };
  try {
    await consumeInventoryFefo(ctx, parsed.data, todayInZone(ctx.organization.timezone));
  } catch (error) {
    return fail(error, values);
  }
  return done();
}

export async function createPurchaseOrderAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await requireClinicContext();
  const values = formValues(formData);
  let rawLines: unknown;
  try {
    rawLines = JSON.parse(values.lines ?? "[]");
  } catch {
    return { fieldErrors: { lines: "inventory.errors.orderLines" }, values };
  }
  if (!Array.isArray(rawLines)) return { fieldErrors: { lines: "inventory.errors.orderLines" }, values };
  let invalidUnitCost = false;
  const lines = rawLines.map((raw) => {
    const row = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    const unitCost = typeof row.unitCost === "string" ? row.unitCost : "";
    const unitCostMinor = unitCost.trim() ? parseMoneyInput(unitCost, ctx.organization.defaultCurrency) : null;
    if (unitCost.trim() && unitCostMinor === null) invalidUnitCost = true;
    return {
      itemId: row.itemId,
      quantity: row.quantity,
      unitCostMinor,
    };
  });
  if (invalidUnitCost) return { fieldErrors: { lines: "inventory.errors.unitCost" }, values };
  const parsed = createPurchaseOrderSchema.safeParse({ ...values, lines });
  if (!parsed.success) return { fieldErrors: fieldErrorsOf(parsed.error), values };
  const today = todayInZone(ctx.organization.timezone);
  if (parsed.data.orderedOn > today) return { fieldErrors: { orderedOn: "futureDate" }, values };
  if (parsed.data.expectedOn && parsed.data.expectedOn < parsed.data.orderedOn) return { fieldErrors: { expectedOn: "inventory.errors.expectedDate" }, values };
  try {
    await createPurchaseOrder(ctx, parsed.data);
  } catch (error) {
    return fail(error, values);
  }
  return done();
}

export async function receivePurchaseOrderLineAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await requireClinicContext();
  const values = formValues(formData);
  const parsed = receivePurchaseOrderLineSchema.safeParse(values);
  if (!parsed.success) return { fieldErrors: fieldErrorsOf(parsed.error), values };
  const today = todayInZone(ctx.organization.timezone);
  if (parsed.data.receivedOn > today) return { fieldErrors: { receivedOn: "futureDate" }, values };
  try {
    await receivePurchaseOrderLine(ctx, parsed.data);
  } catch (error) {
    return fail(error, values);
  }
  return done();
}
