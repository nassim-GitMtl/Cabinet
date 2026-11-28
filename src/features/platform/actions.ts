"use server";

import { revalidatePath } from "next/cache";
import { formValues, type ActionState } from "@/lib/action-state";
import { requirePlatformOperator } from "@/server/auth/platform";
import { DEFAULT_TRIAL_DAYS } from "@/lib/trial";
import { convertPlatformClinicToPaid, extendPlatformTrial, PlatformError, provisionPlatformClinic, setPlatformClinicModules, setTrialRequestStatus, TRIAL_REQUEST_STATUSES, type TrialRequestStatus } from "./server";

const fail = (error: unknown, values?: Record<string, string>): ActionState => {
  if (error instanceof PlatformError) return { error: `platform.errors.${error.code}`, values };
  throw error;
};

export async function provisionClinicAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await requirePlatformOperator();
  const values = formValues(formData);
  const required = ["clinicName", "ownerFullName", "email", "kind", "locale"] as const;
  const fieldErrors: Record<string, string> = Object.fromEntries(required.filter((key) => !values[key]?.trim()).map((key) => [key, "required"]));
  if (values.email && !/^\S+@\S+\.\S+$/.test(values.email)) fieldErrors.email = "invalidEmail";
  if (Object.keys(fieldErrors).length) return { fieldErrors, values };
  try {
    const result = await provisionPlatformClinic(ctx, {
      clinicName: values.clinicName!, ownerFullName: values.ownerFullName!, email: values.email!,
      kind: values.kind as "solo" | "group" | "specialist" | "pediatric" | "multi_branch",
      locale: values.locale as "fr" | "en" | "ar", ownerIsDentist: values.ownerIsDentist === "on",
      modules: formData.getAll("modules").map(String),
      trialDays: values.plan === "paid" ? null : Number(values.trialDays || DEFAULT_TRIAL_DAYS),
      requestId: values.requestId || null,
    });
    revalidatePath("/platform");
    return { ok: true, data: { activationPath: `/reset-password/${result.token}` } };
  } catch (error) {
    return fail(error, values);
  }
}

export async function updateClinicModulesAction(organizationId: string, _previous: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await requirePlatformOperator();
  try {
    await setPlatformClinicModules(ctx, organizationId, formData.getAll("modules").map(String));
    revalidatePath("/platform");
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

export async function extendTrialAction(organizationId: string, _previous: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await requirePlatformOperator();
  try {
    await extendPlatformTrial(ctx, organizationId, Number(formData.get("days")));
    revalidatePath("/platform");
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

export async function convertToPaidAction(organizationId: string): Promise<ActionState> {
  const ctx = await requirePlatformOperator();
  try {
    await convertPlatformClinicToPaid(ctx, organizationId);
    revalidatePath("/platform");
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

export async function setTrialRequestStatusAction(requestId: string, status: TrialRequestStatus): Promise<ActionState> {
  const ctx = await requirePlatformOperator();
  if (!TRIAL_REQUEST_STATUSES.includes(status)) return { error: "platform.errors.requestUnavailable" };
  try {
    await setTrialRequestStatus(ctx, requestId, status);
    revalidatePath("/platform");
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}
