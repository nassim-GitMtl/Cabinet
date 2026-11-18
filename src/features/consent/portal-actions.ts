"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { fieldErrorsOf, formValues, type ActionState } from "@/lib/action-state";
import { activatePortalAccount, authenticatePatient, resetPortalPassword } from "@/server/portal/auth";
import { createPatientSession, requirePatientSession, revokePatientSession } from "@/server/portal/session";
import { portalLoginSchema, portalPasswordSchema } from "./schemas";
import { decideConsentRequest, PatientConsentError, revokeConsentGrant } from "./portal";

export async function activatePortalAction(token: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  const values = formValues(formData);
  const parsed = portalPasswordSchema.safeParse(values);
  if (!parsed.success) return { error: "fixErrors", fieldErrors: fieldErrorsOf(parsed.error) };
  let identity;
  try { identity = await activatePortalAccount(token, parsed.data.password); }
  catch { return { error: "portalInviteUnavailable" }; }
  await createPatientSession(identity);
  redirect("/portal");
}

export async function resetPortalPasswordAction(token: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  const values = formValues(formData);
  const parsed = portalPasswordSchema.safeParse(values);
  if (!parsed.success) return { error: "fixErrors", fieldErrors: fieldErrorsOf(parsed.error) };
  try { await resetPortalPassword(token, parsed.data.password); }
  catch { return { error: "portalRecoveryUnavailable" }; }
  redirect("/portal/login?recovered=1");
}

export async function patientLoginAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const values = formValues(formData);
  const parsed = portalLoginSchema.safeParse(values);
  if (!parsed.success) return { error: "fixErrors", fieldErrors: fieldErrorsOf(parsed.error), values: { email: values.email ?? "" } };
  const result = await authenticatePatient(parsed.data.email, parsed.data.password);
  if (!result.ok) return { error: `portal.${result.reason}`, values: { email: parsed.data.email } };
  await createPatientSession(result.identity);
  redirect("/portal");
}

export async function patientLogoutAction() {
  await revokePatientSession();
  redirect("/portal/login");
}

function consentError(error: unknown): ActionState {
  if (error instanceof PatientConsentError) return { error: error.code };
  throw error;
}

export async function decideConsentRequestAction(requestId: string, decision: "approved" | "declined", _state: ActionState): Promise<ActionState> {
  void _state;
  const ctx = await requirePatientSession();
  try {
    await decideConsentRequest(ctx, requestId, decision);
    revalidatePath("/portal");
    return { ok: true };
  } catch (error) { return consentError(error); }
}

export async function revokeConsentGrantAction(grantId: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await requirePatientSession();
  const reason = String(formData.get("reason") ?? "").trim() || null;
  try {
    await revokeConsentGrant(ctx, grantId, reason);
    revalidatePath("/portal");
    return { ok: true };
  } catch (error) { return consentError(error); }
}
