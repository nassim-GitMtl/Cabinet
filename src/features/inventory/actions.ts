"use server";

import { revalidatePath } from "next/cache";
import { fieldErrorsOf, formValues, type ActionState } from "@/lib/action-state";
import { todayInZone } from "@/lib/dates";
import { ForbiddenError, requireClinicContext } from "@/server/auth/context";
import { consumeInventoryFefo, createInventoryItem, InventoryError, receiveInventory } from "./server";
import { consumeInventorySchema, createInventoryItemSchema, receiveInventorySchema } from "./schemas";

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
