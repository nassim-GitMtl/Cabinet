"use server";

import { revalidatePath } from "next/cache";
import { formValues, type ActionState } from "@/lib/action-state";
import { requirePlatformOperator } from "@/server/auth/platform";
import { PlatformError, provisionPlatformClinic, setPlatformClinicModules } from "./server";

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
