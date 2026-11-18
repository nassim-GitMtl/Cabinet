"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { fieldErrorsOf, formValues, type ActionState } from "@/lib/action-state";
import { todayInZone } from "@/lib/dates";
import { ForbiddenError, requireClinicContext } from "@/server/auth/context";
import { confirmConsumption, removeRecipe, setConsumablesMode, setRecipe, skipConsumption } from "./consumables";
import { InventoryError } from "./server";

const uuid = z.string().uuid("required");
const recipeSchema = z.object({
  serviceId: uuid,
  itemId: uuid,
  quantity: z.coerce.number().int().min(1, "inventory.errors.quantity").max(1000, "inventory.errors.quantity"),
});
const skipSchema = z.object({ id: uuid, reason: z.string().trim().min(1, "inventory.errors.reasonRequired").max(200, "tooLong") });

function fail(error: unknown, values: Record<string, string>): ActionState {
  if (error instanceof ForbiddenError) return { error: "forbidden", values };
  if (error instanceof InventoryError) return { error: `inventory.errors.${error.code}`, values };
  throw error;
}

function done(): ActionState {
  revalidatePath("/inventory/consumables");
  revalidatePath("/inventory");
  return { ok: true };
}

export async function setRecipeAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await requireClinicContext();
  const values = formValues(formData);
  const parsed = recipeSchema.safeParse(values);
  if (!parsed.success) return { fieldErrors: fieldErrorsOf(parsed.error), values };
  try {
    await setRecipe(ctx, parsed.data.serviceId, parsed.data.itemId, parsed.data.quantity);
  } catch (error) {
    return fail(error, values);
  }
  return done();
}

export async function removeRecipeAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await requireClinicContext();
  const id = uuid.safeParse(formData.get("id"));
  if (!id.success) return { error: "generic" };
  try {
    await removeRecipe(ctx, id.data);
  } catch (error) {
    return fail(error, {});
  }
  return done();
}

export async function setConsumablesModeAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await requireClinicContext();
  const mode = z.enum(["suggest", "auto"]).safeParse(formData.get("mode"));
  if (!mode.success) return { error: "generic" };
  try {
    await setConsumablesMode(ctx, mode.data);
  } catch (error) {
    return fail(error, {});
  }
  return done();
}

export async function confirmConsumptionAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await requireClinicContext();
  const id = uuid.safeParse(formData.get("id"));
  if (!id.success) return { error: "generic" };
  try {
    await confirmConsumption(ctx, id.data, todayInZone(ctx.organization.timezone));
  } catch (error) {
    return fail(error, {});
  }
  return done();
}

export async function skipConsumptionAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await requireClinicContext();
  const values = formValues(formData);
  const parsed = skipSchema.safeParse(values);
  if (!parsed.success) return { fieldErrors: fieldErrorsOf(parsed.error), values };
  try {
    await skipConsumption(ctx, parsed.data.id, parsed.data.reason);
  } catch (error) {
    return fail(error, values);
  }
  return done();
}
