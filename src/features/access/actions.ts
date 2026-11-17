"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { fieldErrorsOf, formValues, type ActionState } from "@/lib/action-state";
import { requireClinicContext } from "@/server/auth/context";
import { beginMfaEnrollment, confirmMfaEnrollment, disableMfa } from "@/server/auth/mfa";
import { listUserSessions, revokeOwnSession } from "@/server/auth/session";
import { acceptStaffInvitation } from "./invitation";
import { invitationAcceptSchema, roleSchema, staffInvitationSchema } from "./schemas";
import { AccessError, createRole, createStaffInvitation, updateMembership, updateRole } from "./server";

function mapped(error: unknown, values: Record<string, string>): ActionState {
  if (error instanceof AccessError) return { error: error.code, values };
  throw error;
}

export async function createStaffInvitationAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await requireClinicContext();
  const values = formValues(formData);
  const parsed = staffInvitationSchema.safeParse({ ...values, isProvider: formData.get("isProvider") === "on" });
  if (!parsed.success) return { error: "fixErrors", fieldErrors: fieldErrorsOf(parsed.error), values };
  try {
    const invite = await createStaffInvitation(ctx, parsed.data);
    revalidatePath("/settings/team");
    return { ok: true, data: { path: `/staff/activate/${invite.token}`, expiresAt: invite.expiresAt.toISOString() } };
  } catch (error) { return mapped(error, values); }
}

function roleInput(formData: FormData) {
  return roleSchema.safeParse({ name: formData.get("name"), permissions: formData.getAll("permissions") });
}

export async function createRoleAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await requireClinicContext(); const values = formValues(formData); const parsed = roleInput(formData);
  if (!parsed.success) return { error: "fixErrors", fieldErrors: fieldErrorsOf(parsed.error), values };
  try { await createRole(ctx, parsed.data); revalidatePath("/settings/roles"); return { ok: true }; } catch (error) { return mapped(error, values); }
}

export async function updateRoleAction(roleId: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await requireClinicContext(); const values = formValues(formData); const parsed = roleInput(formData);
  if (!parsed.success) return { error: "fixErrors", fieldErrors: fieldErrorsOf(parsed.error), values };
  try { await updateRole(ctx, roleId, parsed.data); revalidatePath("/settings/roles"); return { ok: true }; } catch (error) { return mapped(error, values); }
}

export async function updateMembershipAction(membershipId: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await requireClinicContext(); const values = formValues(formData);
  const parsed = z.object({ roleId: z.uuid(), status: z.enum(["active", "deactivated"]) }).safeParse(values);
  if (!parsed.success) return { error: "fixErrors", fieldErrors: fieldErrorsOf(parsed.error), values };
  try { await updateMembership(ctx, membershipId, parsed.data.roleId, parsed.data.status); revalidatePath("/settings/team"); return { ok: true }; } catch (error) { return mapped(error, values); }
}

export async function acceptStaffInvitationAction(token: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  const values = formValues(formData); delete values.password; delete values.confirmPassword;
  const parsed = invitationAcceptSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "fixErrors", fieldErrors: fieldErrorsOf(parsed.error), values };
  try { await acceptStaffInvitation(token, parsed.data.password); } catch (error) {
    const code = error instanceof Error ? error.message : "invitationUnavailable";
    return { error: code === "invalid" ? "auth.invalid" : code.startsWith("password.") ? code.replace("password.", "") : "invitationUnavailable" };
  }
  redirect("/login?invited=1");
}

export async function beginMfaAction(): Promise<ActionState> {
  const ctx = await requireClinicContext();
  return { ok: true, data: await beginMfaEnrollment(ctx) };
}

export async function confirmMfaAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await requireClinicContext(); const code = String(formData.get("code") ?? "").trim();
  const recoveryCodes = await confirmMfaEnrollment(ctx, code);
  if (!recoveryCodes) return { error: "mfaInvalid" };
  revalidatePath("/settings/security"); return { ok: true, data: { recoveryCodes } };
}

export async function disableMfaAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await requireClinicContext();
  if (!await disableMfa(ctx, String(formData.get("code") ?? "").trim())) return { error: "mfaInvalid" };
  revalidatePath("/settings/security"); return { ok: true };
}

export async function revokeSessionAction(sessionId: string) {
  const ctx = await requireClinicContext();
  await revokeOwnSession(ctx, sessionId);
  if (sessionId === ctx.sessionId) redirect("/login");
  revalidatePath("/settings/security");
}

export async function loadSecurityState() {
  const ctx = await requireClinicContext();
  return { sessions: await listUserSessions(ctx.userId), currentSessionId: ctx.sessionId };
}
