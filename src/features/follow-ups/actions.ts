"use server";

import { revalidatePath } from "next/cache";
import { fieldErrorsOf, formValues, type ActionState } from "@/lib/action-state";
import { AgendaError, setConfirmation } from "@/features/agenda/server";
import { ForbiddenError, requireClinicContext } from "@/server/auth/context";
import { FOLLOW_UP_REASONS, MESSAGE_LOCALES } from "./messages";
import { followUpSettingsSchema, logContactSchema } from "./schemas";
import { FollowUpError, logPatientContact, saveFollowUpSettings } from "./server";

function fail(error: unknown, values?: Record<string, string>): ActionState {
  if (error instanceof ForbiddenError) return { error: "forbidden", values };
  if (error instanceof FollowUpError) return { error: `followUps.errors.${error.code}`, fieldErrors: error.fieldErrors, values };
  if (error instanceof AgendaError) return { error: "followUps.errors.appointmentChanged", values };
  throw error;
}

/** Called from buttons (not a form): records one contact attempt for a follow-up row. */
export async function logContactAction(input: Record<string, string | null>): Promise<ActionState> {
  const ctx = await requireClinicContext();
  const parsed = logContactSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message.includes(".") ? parsed.error.issues[0].message : "errors.generic" };
  try {
    await logPatientContact(ctx, parsed.data);
  } catch (error) {
    return fail(error);
  }
  revalidatePath("/follow-ups");
  return { ok: true };
}

export async function confirmAppointmentAction(appointmentId: string): Promise<ActionState> {
  const ctx = await requireClinicContext();
  try {
    await setConfirmation(ctx, appointmentId, "confirmed");
  } catch (error) {
    return fail(error);
  }
  revalidatePath("/follow-ups");
  revalidatePath("/agenda");
  return { ok: true };
}

export async function saveFollowUpSettingsAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await requireClinicContext();
  const values = formValues(formData);
  const templates = Object.fromEntries(FOLLOW_UP_REASONS.map((reason) => [
    reason, Object.fromEntries(MESSAGE_LOCALES.map((locale) => [locale, values[`templates.${reason}.${locale}`] ?? ""])),
  ]));
  const branchPhones = Object.keys(values).filter((k) => k.startsWith("branchPhone.")).map((k) => ({ branchId: k.slice("branchPhone.".length), phone: values[k] ?? "" }));
  const aftercare = [...new Set(Object.keys(values).filter((k) => k.startsWith("aftercare.")).map((k) => k.split(".")[1]!))]
    .map((categoryId) => ({ categoryId, fr: values[`aftercare.${categoryId}.fr`] ?? "", en: values[`aftercare.${categoryId}.en`] ?? "", ar: values[`aftercare.${categoryId}.ar`] ?? "" }));
  const parsed = followUpSettingsSchema.safeParse({ recallMonths: values.recallMonths, templates, branchPhones, reviewUrl: values.reviewUrl ?? "", aftercare });
  if (!parsed.success) return { fieldErrors: fieldErrorsOf(parsed.error), values };
  try {
    await saveFollowUpSettings(ctx, parsed.data);
  } catch (error) {
    return fail(error, values);
  }
  revalidatePath("/settings/follow-ups");
  revalidatePath("/follow-ups");
  return { ok: true, values };
}
