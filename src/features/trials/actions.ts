"use server";

import { headers } from "next/headers";
import { formValues, type ActionState } from "@/lib/action-state";
import { clientIpFromHeaders } from "@/server/auth/client-ip";
import { submitTrialRequest, TrialRequestError, type TrialRequestInput } from "./server";

const opt = (v: string | undefined) => (v?.trim() ? v.trim() : null);

export async function submitTrialRequestAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const values = formValues(formData);
  // Hidden field only robots fill in: answer as if it worked, store nothing.
  if (values.website?.trim()) return { ok: true };
  const practitioners = opt(values.practitioners);
  const input: TrialRequestInput = {
    clinicName: values.clinicName ?? "", contactName: values.contactName ?? "", phone: values.phone ?? "", email: values.email ?? "",
    city: opt(values.city), practitioners: practitioners === null ? null : Number(practitioners), message: opt(values.message),
    locale: values.locale === "ar" || values.locale === "en" ? values.locale : "fr",
  };
  try {
    await submitTrialRequest(input, clientIpFromHeaders(await headers()));
    return { ok: true };
  } catch (error) {
    if (error instanceof TrialRequestError) {
      return error.code === "invalid" ? { fieldErrors: error.fields, values } : { error: "trial.errors.tooMany", values };
    }
    throw error;
  }
}
