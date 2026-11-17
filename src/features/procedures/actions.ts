"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { fieldErrorsOf, formValues, type ActionState } from "@/lib/action-state";
import { parseMoneyInput } from "@/lib/money";
import { ForbiddenError, requireClinicContext } from "@/server/auth/context";
import { ConflictError } from "@/server/errors";
import {
  performedProcedureInputSchema,
  procedureStatusInputSchema,
} from "./schemas";
import {
  changePerformedProcedureStatus,
  ProcedureReferenceError,
  ProcedureValidationError,
  recordPerformedProcedure,
} from "./server";

function mapProcedureError(error: unknown, values: Record<string, string>): ActionState {
  if (error instanceof ProcedureValidationError) {
    const fieldErrors = { ...error.fieldErrors };
    if (fieldErrors.unitPriceMinor) {
      fieldErrors.price = fieldErrors.unitPriceMinor;
      delete fieldErrors.unitPriceMinor;
    }
    return { error: "fixErrors", fieldErrors, values };
  }
  if (error instanceof ProcedureReferenceError) return { error: error.code, values };
  if (error instanceof ForbiddenError) return { error: "forbidden", values };
  if (error instanceof ConflictError) return { error: "conflict", values };
  throw error;
}

export async function recordPerformedProcedureAction(
  patientId: string,
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await requireClinicContext();
  const values = formValues(formData);
  const priceMinor = parseMoneyInput(values.price ?? "", ctx.organization.defaultCurrency);
  const parsed = performedProcedureInputSchema.safeParse({
    ...values,
    unitPriceMinor: priceMinor ?? -1,
  });
  const fieldErrors = parsed.success ? {} : fieldErrorsOf(parsed.error);
  if (fieldErrors.unitPriceMinor) {
    fieldErrors.price = fieldErrors.unitPriceMinor;
    delete fieldErrors.unitPriceMinor;
  }
  if (priceMinor === null || priceMinor < 0) fieldErrors.price = "invalidAmount";
  if (!parsed.success || Object.keys(fieldErrors).length) {
    return { error: "fixErrors", fieldErrors, values };
  }

  try {
    await recordPerformedProcedure(ctx, patientId, parsed.data);
  } catch (error) {
    return mapProcedureError(error, values);
  }
  revalidatePath(`/patients/${patientId}`);
  redirect(`/patients/${patientId}?tab=clinical&created=1`);
}

export async function changePerformedProcedureStatusAction(
  procedureId: string,
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await requireClinicContext();
  const values = formValues(formData);
  const parsed = procedureStatusInputSchema.safeParse(values);
  if (!parsed.success) {
    return { error: "fixErrors", fieldErrors: fieldErrorsOf(parsed.error), values };
  }
  try {
    const patientId = await changePerformedProcedureStatus(ctx, procedureId, parsed.data);
    revalidatePath(`/patients/${patientId}`);
    return { ok: true };
  } catch (error) {
    return mapProcedureError(error, values);
  }
}
