"use server";

import { revalidatePath } from "next/cache";
import { formValues, type ActionState } from "@/lib/action-state";
import { ForbiddenError, requireClinicContext } from "@/server/auth/context";
import { ReminderError, sendTestReminder, setAutoReminders } from "./server";

function fail(error: unknown, values?: Record<string, string>): ActionState {
  if (error instanceof ForbiddenError) return { error: "forbidden", values };
  if (error instanceof ReminderError) return { error: `reminders.errors.${error.code}`, values };
  throw error;
}

export async function setAutoRemindersAction(enabled: boolean): Promise<ActionState> {
  const ctx = await requireClinicContext();
  try {
    await setAutoReminders(ctx, enabled);
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/settings/reminders");
  return { ok: true };
}

export async function sendTestReminderAction(_prev: ActionState, data: FormData): Promise<ActionState> {
  const ctx = await requireClinicContext();
  const v = formValues(data);
  if (!v.phone?.trim()) return { fieldErrors: { phone: "required" }, values: v };
  try {
    const result = await sendTestReminder(ctx, v.phone);
    if (!result.ok) return { error: "reminders.errors.sendFailed", values: v, data: { code: result.code, title: result.title } };
  } catch (e) {
    return fail(e, v);
  }
  revalidatePath("/settings/reminders");
  return { ok: true, values: v };
}
