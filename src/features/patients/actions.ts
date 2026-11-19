"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { fieldErrorsOf, formValues, type ActionState } from "@/lib/action-state";
import { normalizePhone } from "@/lib/phone";
import { ForbiddenError, requireClinicContext } from "@/server/auth/context";
import { ConflictError } from "@/server/errors";
import { alertInputSchema, patientInputSchema } from "./schemas";
import {
  addPatientAlert,
  createPatient,
  PatientReferralError,
  resolvePatientAlert,
  setPatientArchived,
  updatePatient,
} from "./server";

function phoneErrors(values: Record<string, string>, country: string) {
  const errors: Record<string, string> = {};
  for (const field of ["phone", "phoneAlt", "emergencyPhone"]) {
    const v = values[field]?.trim();
    if (v && !normalizePhone(v, country)) errors[field] = "invalidPhone";
  }
  return errors;
}

async function handle<T>(fn: () => Promise<T>, values?: Record<string, string>): Promise<T | ActionState> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ForbiddenError) return { error: "forbidden", values };
    if (err instanceof ConflictError) return { error: "conflict", values };
    if (err instanceof PatientReferralError) return { error: "fixErrors", fieldErrors: { referredByPatientId: "acquisition.errors.referrerUnavailable" }, values };
    throw err;
  }
}

export async function createPatientAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await requireClinicContext();
  const values = formValues(formData);
  const parsed = patientInputSchema.safeParse(values);
  const fieldErrors = { ...(parsed.success ? {} : fieldErrorsOf(parsed.error)), ...phoneErrors(values, ctx.organization.countryCode) };
  if (!parsed.success || Object.keys(fieldErrors).length) return { fieldErrors, values, error: "fixErrors" };

  const result = await handle(
    () => createPatient(ctx, parsed.data, { confirmNotDuplicate: values.confirmNotDuplicate === "1" }),
    values,
  );
  if ("error" in result) return result as ActionState;
  if ("status" in result && result.status === "duplicates") return { values, data: { duplicates: result.candidates } };
  revalidatePath("/patients");
  redirect(`/patients/${(result as { id: string }).id}`);
}

export async function updatePatientAction(
  id: string,
  version: number,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await requireClinicContext();
  const values = formValues(formData);
  const parsed = patientInputSchema.safeParse(values);
  const fieldErrors = { ...(parsed.success ? {} : fieldErrorsOf(parsed.error)), ...phoneErrors(values, ctx.organization.countryCode) };
  if (!parsed.success || Object.keys(fieldErrors).length) return { fieldErrors, values, error: "fixErrors" };
  const result = await handle(() => updatePatient(ctx, id, parsed.data, version), values);
  if (result && typeof result === "object" && "error" in result) return result;
  revalidatePath(`/patients/${id}`);
  redirect(`/patients/${id}`);
}

export async function setArchivedAction(id: string, archived: boolean) {
  const ctx = await requireClinicContext();
  await setPatientArchived(ctx, id, archived);
  revalidatePath(`/patients/${id}`);
  revalidatePath("/patients");
}

export async function addAlertAction(patientId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await requireClinicContext();
  const values = formValues(formData);
  const parsed = alertInputSchema.safeParse(values);
  if (!parsed.success) return { fieldErrors: fieldErrorsOf(parsed.error), values };
  const result = await handle(() => addPatientAlert(ctx, patientId, parsed.data), values);
  if (result && typeof result === "object" && "error" in result) return result;
  revalidatePath(`/patients/${patientId}`);
  return { ok: true };
}

export async function resolveAlertAction(alertId: string) {
  const ctx = await requireClinicContext();
  const patientId = await resolvePatientAlert(ctx, alertId);
  if (patientId) revalidatePath(`/patients/${patientId}`);
}
