"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { z } from "zod";
import { fieldErrorsOf, formValues, type ActionState } from "@/lib/action-state";
import { requireClinicContext } from "@/server/auth/context";
import { changeOwnPassword, createStaffPasswordReset, PasswordResetError, requestPasswordResetEmail, resetStaffPassword } from "@/server/auth/password-reset";
import { requestMeta } from "@/server/auth/session";
import { mailLinkBase, passwordEmailEnabled, sendResetEmail } from "@/server/mail";
import { invitationAcceptSchema } from "./schemas";

const policyField = (code: string) => (code === "password.tooShort" ? "tooShort" : "tooLong");

export async function createStaffPasswordResetAction(membershipId: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await requireClinicContext();
  try {
    const reset = await createStaffPasswordReset(ctx, membershipId, { resetMfa: formData.get("resetMfa") === "on" });
    return { ok: true, data: { path: `/reset-password/${reset.token}`, expiresAt: reset.expiresAt.toISOString() } };
  } catch (error) {
    if (error instanceof PasswordResetError) return { error: error.code };
    throw error;
  }
}

export async function resetStaffPasswordAction(token: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = invitationAcceptSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "fixErrors", fieldErrors: fieldErrorsOf(parsed.error) };
  const { ipAddress } = await requestMeta();
  try {
    await resetStaffPassword(token, parsed.data.password, ipAddress);
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code.startsWith("password.")) return { fieldErrors: { password: policyField(code) } };
    return { error: "resetUnavailable" };
  }
  redirect("/login?reset=1");
}

const emailSchema = z.object({ email: z.email("invalidEmail").max(200) });

export async function requestPasswordResetAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const values = formValues(formData);
  const parsed = emailSchema.safeParse(values);
  if (!parsed.success) return { fieldErrors: fieldErrorsOf(parsed.error), values };
  const base = mailLinkBase();
  if (!passwordEmailEnabled() || !base) return { error: "generic", values };
  const { ipAddress } = await requestMeta();
  // Look-up and sending run after the response: the answer (and its timing) is the same whether or not
  // the address has an account.
  after(async () => {
    try {
      await requestPasswordResetEmail(parsed.data.email, { baseUrl: base, send: sendResetEmail }, ipAddress);
    } catch (error) {
      console.error("password reset email failed", error instanceof Error ? error.message : error);
    }
  });
  return { ok: true };
}

const changeSchema = z.object({
  currentPassword: z.string().min(1, "required").max(200),
  password: z.string().min(1, "required").max(200),
  confirmPassword: z.string().max(200),
}).refine((value) => value.password === value.confirmPassword, { path: ["confirmPassword"], message: "passwordMismatch" });

export async function changeOwnPasswordAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await requireClinicContext();
  const parsed = changeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "fixErrors", fieldErrors: fieldErrorsOf(parsed.error) };
  const result = await changeOwnPassword(ctx, parsed.data.currentPassword, parsed.data.password);
  if (result === "invalid") return { fieldErrors: { currentPassword: "currentPasswordInvalid" } };
  if (result !== "ok") return { fieldErrors: { password: policyField(result) } };
  revalidatePath("/settings/security");
  return { ok: true };
}
