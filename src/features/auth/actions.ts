"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { z } from "zod";
import { fieldErrorsOf, formValues, type ActionState } from "@/lib/action-state";
import { LOCALE_COOKIE, isLocale } from "@/i18n/config";
import { requireSession } from "@/server/auth/context";
import { passwordPolicyError } from "@/server/auth/password";
import { createSession, requestMeta, revokeCurrentSession, setActiveOrganization } from "@/server/auth/session";
import { authenticate, listMyClinics } from "@/server/services/auth";
import { EmailTakenError, registerClinic } from "@/server/services/onboarding";

const loginSchema = z.object({
  email: z.email("invalidEmail").max(200),
  password: z.string().min(1, "required").max(200),
});

export async function loginAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const values = formValues(formData);
  delete values.password;
  const parsed = loginSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsOf(parsed.error), values };

  const { ipAddress } = await requestMeta();
  const result = await authenticate(parsed.data.email, parsed.data.password, ipAddress);
  if (!result.ok) return { error: `auth.${result.reason}`, values };

  const clinics = await listMyClinics(result.userId);
  await createSession(result.userId, clinics.length === 1 ? clinics[0]!.organizationId : null);
  redirect(clinics.length === 1 ? "/dashboard" : "/select-clinic");
}

const registerSchema = z.object({
  clinicName: z.string().trim().min(2, "required").max(150),
  kind: z.enum(["solo", "group", "specialist", "pediatric", "multi_branch"]),
  ownerFullName: z.string().trim().min(2, "required").max(150),
  email: z.email("invalidEmail").max(200),
  password: z.string().max(200),
  ownerIsDentist: z.preprocess((v) => v === "on", z.boolean()),
});

export async function registerAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const values = formValues(formData);
  delete values.password;
  const parsed = registerSchema.safeParse(Object.fromEntries(formData));
  const fieldErrors = parsed.success ? {} : fieldErrorsOf(parsed.error);
  const pwError = passwordPolicyError(String(formData.get("password") ?? ""));
  if (pwError) fieldErrors.password = pwError === "password.tooShort" ? "tooShort" : "tooLong";
  if (!parsed.success || pwError) return { fieldErrors, values };

  const localeCookie = (await cookies()).get(LOCALE_COOKIE)?.value;
  try {
    const { userId, organizationId } = await registerClinic({
      ...parsed.data,
      locale: isLocale(localeCookie) ? localeCookie : "fr",
    });
    await createSession(userId, organizationId);
  } catch (err) {
    if (err instanceof EmailTakenError) return { fieldErrors: { email: "auth.emailTaken" }, values };
    throw err;
  }
  redirect("/dashboard");
}

export async function selectClinicAction(organizationId: string) {
  const session = await requireSession();
  const clinics = await listMyClinics(session.userId);
  // Only an ACTIVE membership of this user can become the active clinic.
  if (!clinics.some((c) => c.organizationId === organizationId)) redirect("/select-clinic?invalid=1");
  await setActiveOrganization(session.sessionId, organizationId);
  redirect("/dashboard");
}

export async function logoutAction() {
  await revokeCurrentSession();
  redirect("/login");
}
