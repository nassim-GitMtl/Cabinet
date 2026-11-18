"use server";

import { revalidatePath } from "next/cache";
import { fieldErrorsOf, formValues, type ActionState } from "@/lib/action-state";
import { ForbiddenError, requireClinicContext } from "@/server/auth/context";
import { consentRequestSchema, portalInvitationSchema, portalRecoverySchema } from "./schemas";
import { ConsentFlowError, createConsentRequest, createPortalInvitation, createPortalRecovery, PortalRecoveryError } from "./server";

function mapped(error: unknown, values: Record<string, string>): ActionState {
  if (error instanceof ConsentFlowError) return { error: error.code, values };
  if (error instanceof PortalRecoveryError) return { error: error.code, values };
  if (error instanceof ForbiddenError) return { error: "forbidden", values };
  throw error;
}

export async function createPortalRecoveryAction(patientId: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await requireClinicContext();
  const values = formValues(formData);
  const parsed = portalRecoverySchema.safeParse(values);
  if (!parsed.success) return { error: "fixErrors", fieldErrors: fieldErrorsOf(parsed.error), values };
  try {
    const recovery = await createPortalRecovery(ctx, patientId, parsed.data.email, parsed.data.evidenceRef);
    revalidatePath(`/patients/${patientId}`);
    return { ok: true, data: { recoveryPath: `/portal/recover/${recovery.token}`, expiresAt: recovery.expiresAt.toISOString() } };
  } catch (error) { return mapped(error, values); }
}

export async function createPortalInvitationAction(patientId: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await requireClinicContext();
  const values = formValues(formData);
  const parsed = portalInvitationSchema.safeParse(values);
  if (!parsed.success) return { error: "fixErrors", fieldErrors: fieldErrorsOf(parsed.error), values };
  try {
    const invite = await createPortalInvitation(ctx, patientId, parsed.data.email, parsed.data.evidenceRef);
    revalidatePath(`/patients/${patientId}`);
    return { ok: true, data: { activationPath: `/portal/activate/${invite.token}`, expiresAt: invite.expiresAt.toISOString() } };
  } catch (error) { return mapped(error, values); }
}

export async function createConsentRequestAction(patientId: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await requireClinicContext();
  const values = formValues(formData);
  const parsed = consentRequestSchema.safeParse({
    ...values,
    categories: formData.getAll("categories"),
    includeFutureUpdates: formData.get("includeFutureUpdates") === "on",
  });
  if (!parsed.success) return { error: "fixErrors", fieldErrors: fieldErrorsOf(parsed.error), values };
  try {
    await createConsentRequest(ctx, patientId, parsed.data);
    revalidatePath(`/patients/${patientId}`);
    return { ok: true };
  } catch (error) { return mapped(error, values); }
}
