"use server";

import { revalidatePath } from "next/cache";
import { formValues, type ActionState } from "@/lib/action-state";
import { parseDateOnly } from "@/lib/dates";
import { parseMoneyInput } from "@/lib/money";
import { ForbiddenError, requireClinicContext } from "@/server/auth/context";
import { createPaymentSchedule, PaymentScheduleError } from "./server";

export async function createPaymentScheduleAction(planId: string, patientId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await requireClinicContext();
  const values = formValues(formData);
  const dates = formData.getAll("dueDate").map(String);
  const amounts = formData.getAll("amount").map(String);
  const installments = dates.map((dueDate, index) => ({ dueDate, amountMinor: parseMoneyInput(amounts[index] ?? "", ctx.organization.defaultCurrency) }));
  if (installments.length === 0 || installments.some((x) => !parseDateOnly(x.dueDate) || x.amountMinor === null || x.amountMinor <= 0)) {
    return { error: "paymentPlans.errors.invalidSchedule", values };
  }
  try {
    await createPaymentSchedule(ctx, planId, installments.map((x) => ({ dueDate: x.dueDate, amountMinor: x.amountMinor! })));
  } catch (error) {
    if (error instanceof ForbiddenError) return { error: "forbidden", values };
    if (error instanceof PaymentScheduleError) return { error: `paymentPlans.errors.${error.code}`, values };
    throw error;
  }
  revalidatePath(`/patients/${patientId}`);
  revalidatePath(`/patients/${patientId}/treatment-plans/${planId}`);
  revalidatePath("/follow-ups");
  revalidatePath("/portal");
  return { ok: true };
}
