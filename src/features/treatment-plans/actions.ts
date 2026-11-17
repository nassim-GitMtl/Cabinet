"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { fieldErrorsOf, formValues, type ActionState } from "@/lib/action-state";
import { ForbiddenError, requireClinicContext } from "@/server/auth/context";
import { ConflictError } from "@/server/errors";
import { treatmentConversionInputSchema, treatmentDecisionInputSchema, treatmentPlanInputSchema } from "./schemas";
import {
  convertTreatmentPlanItem,
  createTreatmentPlan,
  decideTreatmentPlan,
  proposeTreatmentPlan,
  reviseTreatmentPlan,
  TreatmentPlanReferenceError,
  TreatmentPlanValidationError,
} from "./server";

function mapped(error: unknown, values: Record<string, string>): ActionState {
  if (error instanceof TreatmentPlanValidationError) return { error: "fixErrors", fieldErrors: error.fieldErrors, values };
  if (error instanceof TreatmentPlanReferenceError) return { error: error.code, values };
  if (error instanceof ForbiddenError) return { error: "forbidden", values };
  if (error instanceof ConflictError) return { error: "conflict", values };
  throw error;
}

function parsePlan(values: Record<string, string>) {
  let items: unknown = [];
  try { items = JSON.parse(values.items ?? "[]"); } catch { /* schema reports it */ }
  return treatmentPlanInputSchema.safeParse({ title: values.title, notes: values.notes, items });
}

export async function createTreatmentPlanAction(patientId: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await requireClinicContext();
  const values = formValues(formData);
  const parsed = parsePlan(values);
  if (!parsed.success) return { error: "fixErrors", fieldErrors: fieldErrorsOf(parsed.error), values };
  let planId: string;
  try { planId = await createTreatmentPlan(ctx, patientId, parsed.data); }
  catch (error) { return mapped(error, values); }
  revalidatePath(`/patients/${patientId}`);
  redirect(`/patients/${patientId}/treatment-plans/${planId}?created=1`);
}

export async function reviseTreatmentPlanAction(planId: string, expectedVersion: number, _state: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await requireClinicContext();
  const values = formValues(formData);
  const parsed = parsePlan(values);
  if (!parsed.success) return { error: "fixErrors", fieldErrors: fieldErrorsOf(parsed.error), values };
  let patientId: string;
  try { patientId = await reviseTreatmentPlan(ctx, planId, expectedVersion, parsed.data); }
  catch (error) { return mapped(error, values); }
  revalidatePath(`/patients/${patientId}`);
  redirect(`/patients/${patientId}/treatment-plans/${planId}?revised=1`);
}

export async function proposeTreatmentPlanAction(planId: string, expectedVersion: number, _state: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await requireClinicContext();
  const values = formValues(formData);
  try {
    const patientId = await proposeTreatmentPlan(ctx, planId, expectedVersion);
    revalidatePath(`/patients/${patientId}`);
    return { ok: true };
  } catch (error) { return mapped(error, values); }
}

export async function decideTreatmentPlanAction(planId: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await requireClinicContext();
  const values = formValues(formData);
  const parsed = treatmentDecisionInputSchema.safeParse(values);
  if (!parsed.success) return { error: "fixErrors", fieldErrors: fieldErrorsOf(parsed.error), values };
  try {
    const patientId = await decideTreatmentPlan(ctx, planId, parsed.data);
    revalidatePath(`/patients/${patientId}`);
    return { ok: true };
  } catch (error) { return mapped(error, values); }
}

export async function convertTreatmentPlanItemAction(planId: string, itemId: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await requireClinicContext();
  const values = formValues(formData);
  const parsed = treatmentConversionInputSchema.safeParse(values);
  if (!parsed.success) return { error: "fixErrors", fieldErrors: fieldErrorsOf(parsed.error), values };
  try {
    const result = await convertTreatmentPlanItem(ctx, planId, itemId, parsed.data);
    revalidatePath(`/patients/${result.patientId}`);
    return { ok: true };
  } catch (error) { return mapped(error, values); }
}
