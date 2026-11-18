"use server";

import { revalidatePath } from "next/cache";
import { fieldErrorsOf, formValues, type ActionState } from "@/lib/action-state";
import { ForbiddenError, requireClinicContext } from "@/server/auth/context";
import { odontogramFindingSchema, odontogramStatusSchema } from "./schemas";
import { changeOdontogramFindingStatus, createOdontogramFinding, OdontogramReferenceError, OdontogramValidationError } from "./server";

function mapped(error: unknown, values: Record<string, string>): ActionState {
  if (error instanceof OdontogramValidationError) return { error: "fixErrors", fieldErrors: error.fieldErrors, values };
  if (error instanceof OdontogramReferenceError) return { error: error.code, values };
  if (error instanceof ForbiddenError) return { error: "forbidden", values };
  throw error;
}

export async function createOdontogramFindingAction(patientId: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await requireClinicContext();
  const values = formValues(formData);
  const parsed = odontogramFindingSchema.safeParse(values);
  if (!parsed.success) return { error: "fixErrors", fieldErrors: fieldErrorsOf(parsed.error), values };
  try {
    await createOdontogramFinding(ctx, patientId, parsed.data);
    revalidatePath(`/patients/${patientId}`);
    return { ok: true };
  } catch (error) { return mapped(error, values); }
}

export async function changeOdontogramFindingStatusAction(findingId: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await requireClinicContext();
  const values = formValues(formData);
  const parsed = odontogramStatusSchema.safeParse(values);
  if (!parsed.success) return { error: "fixErrors", fieldErrors: fieldErrorsOf(parsed.error), values };
  try {
    const patientId = await changeOdontogramFindingStatus(ctx, findingId, parsed.data);
    revalidatePath(`/patients/${patientId}`);
    return { ok: true };
  } catch (error) { return mapped(error, values); }
}
