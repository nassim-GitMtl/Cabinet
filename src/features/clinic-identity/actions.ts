"use server";

import { revalidatePath } from "next/cache";
import { formValues, type ActionState } from "@/lib/action-state";
import { ForbiddenError, requireClinicContext } from "@/server/auth/context";
import { ClinicIdentityError, IDENTIFIER_KEYS, removeClinicLogo, saveClinicIdentity, saveClinicLogo } from "./server";

function fail(error: unknown, values?: Record<string, string>): ActionState {
  if (error instanceof ForbiddenError) return { error: "forbidden", values };
  if (error instanceof ClinicIdentityError) {
    const key = `clinicIdentity.errors.${error.code}`;
    return error.field ? { error: "fixErrors", fieldErrors: { [error.field]: key }, values } : { error: key, values };
  }
  throw error;
}

function refresh() {
  revalidatePath("/settings/clinic");
  revalidatePath("/dashboard");
  revalidatePath("/", "layout");
}

export async function saveClinicIdentityAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await requireClinicContext();
  const values = formValues(formData);
  try {
    await saveClinicIdentity(ctx, {
      clinicName: values.clinicName ?? "",
      legalName: values.legalName ?? "",
      address: values.address ?? "",
      identifiers: Object.fromEntries(IDENTIFIER_KEYS.map((k) => [k, values[`identifiers.${k}`] ?? ""])) as Record<(typeof IDENTIFIER_KEYS)[number], string>,
      phone: values.phone ?? "",
      email: values.email ?? "",
    });
  } catch (error) {
    return fail(error, values);
  }
  refresh();
  return { ok: true, values };
}

export async function saveClinicLogoAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await requireClinicContext();
  const file = formData.get("logo");
  try {
    if (formData.get("remove") === "1") await removeClinicLogo(ctx);
    else if (file instanceof File) await saveClinicLogo(ctx, new Uint8Array(await file.arrayBuffer()));
    else throw new ClinicIdentityError("emptyFile", "logo");
  } catch (error) {
    return fail(error);
  }
  refresh();
  return { ok: true };
}
