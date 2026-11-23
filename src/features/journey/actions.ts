"use server";

import { revalidatePath } from "next/cache";
import { formValues, type ActionState } from "@/lib/action-state";
import { ForbiddenError, requireClinicContext } from "@/server/auth/context";
import { addJourneyMilestone, JourneyError, shareJourneyComparison, shareJourneyImage, withdrawJourneyItem } from "./server";

function fail(error: unknown, values: Record<string, string>): ActionState {
  if (error instanceof ForbiddenError) return { error: "forbidden", values };
  if (error instanceof JourneyError) return { error: `journey.errors.${error.code}`, values };
  throw error;
}

/** Shares a step, a photo or a before/after pair on the patient's journey. */
export async function shareJourneyAction(patientId: string, _prev: ActionState, data: FormData): Promise<ActionState> {
  const ctx = await requireClinicContext();
  const v = formValues(data);
  const fieldErrors: Record<string, string> = {};
  if (!v.title?.trim()) fieldErrors.title = "required";
  if (!v.eventDate) fieldErrors.eventDate = "required";
  if (v.kind === "image" && !v.clinicalFileId) fieldErrors.clinicalFileId = "required";
  if (v.kind === "comparison" && !v.comparisonId) fieldErrors.comparisonId = "required";
  if (Object.keys(fieldErrors).length) return { fieldErrors, values: v };
  const common = { title: v.title ?? "", body: v.body || null, eventDate: v.eventDate ?? "" };
  try {
    if (v.kind === "image") await shareJourneyImage(ctx, patientId, { ...common, clinicalFileId: v.clinicalFileId! });
    else if (v.kind === "comparison") await shareJourneyComparison(ctx, patientId, { ...common, comparisonId: v.comparisonId! });
    else await addJourneyMilestone(ctx, patientId, { ...common, treatmentPlanId: v.treatmentPlanId || null });
  } catch (e) {
    return fail(e, v);
  }
  revalidatePath(`/patients/${patientId}`);
  return { ok: true };
}

export async function withdrawJourneyItemAction(itemId: string, patientId: string, _prev: ActionState, data: FormData): Promise<ActionState> {
  const ctx = await requireClinicContext();
  const v = formValues(data);
  if (!v.reason?.trim()) return { fieldErrors: { reason: "required" }, values: v };
  try {
    await withdrawJourneyItem(ctx, itemId, v.reason);
  } catch (e) {
    return fail(e, v);
  }
  revalidatePath(`/patients/${patientId}`);
  return { ok: true };
}
