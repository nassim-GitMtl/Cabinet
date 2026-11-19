"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import type { ActionState } from "@/lib/action-state";
import { fieldErrorsOf, formValues } from "@/lib/action-state";
import { ForbiddenError, requireClinicContext } from "@/server/auth/context";
import { requirePatientSession } from "@/server/portal/session";
import type { Answers } from "@/server/db/schema";
import { addPatientAlert } from "@/features/patients/server";
import { createQuestionnaireDraft, createQuestionnaireTabletSession, approveQuestionnaire, getHealthHistory, HealthError, publishQuestionnaireVersion, recordResponse, reviewHistory } from "./server";
import { questionnaireDraftSchema } from "./schemas";
import { recordPortalHealthResponse, recordTabletHealthResponse } from "./patient";

function fail(err: unknown): ActionState {
  if (err instanceof ForbiddenError) return { error: "forbidden" };
  if (err instanceof HealthError) return { error: `health.errors.${err.code}` };
  throw err;
}

/** Form fields: q_<id> = yes|no|unknown|declined, d_<id> = details, t_<id> = free text. */
function answersFromFormData(fd: FormData): Answers {
  const answers: Answers = {};
  for (const [key, raw] of fd.entries()) {
    if (typeof raw !== "string") continue;
    const m = /^([qdt])_([a-z0-9_]+)$/.exec(key);
    if (!m) continue;
    const answer = (answers[m[2]!] ??= {});
    if (m[1] === "q") answer.value = raw as never;
    if (m[1] === "d") answer.details = raw;
    if (m[1] === "t") answer.text = raw;
  }
  return answers;
}

export async function recordResponseAction(patientId: string, _p: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireClinicContext();
  const answers = answersFromFormData(fd);
  try {
    await recordResponse(ctx, patientId, { answers, patientAcknowledged: fd.get("acknowledged") === "on" });
  } catch (e) {
    return fail(e);
  }
  revalidatePath(`/patients/${patientId}`);
  redirect(`/patients/${patientId}?tab=health`);
}

export async function createQuestionnaireDraftAction(_previous: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireClinicContext(); const values = formValues(fd);
  let questions: unknown;
  try { questions = JSON.parse(values.questions ?? "[]"); } catch { return { error: "health.editor.errors.invalid", values }; }
  const parsed = questionnaireDraftSchema.safeParse({ ...values, questions });
  if (!parsed.success) return { fieldErrors: fieldErrorsOf(parsed.error), error: "health.editor.errors.invalid", values };
  try { await createQuestionnaireDraft(ctx, parsed.data); } catch (error) { return fail(error); }
  revalidatePath("/settings/questionnaire"); return { ok: true };
}

export async function publishQuestionnaireVersionAction(previous: ActionState, fd: FormData): Promise<ActionState> {
  void previous;
  const ctx = await requireClinicContext(); const versionId = String(fd.get("versionId") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(versionId)) return { error: "health.editor.errors.invalid" };
  try { await publishQuestionnaireVersion(ctx, versionId); } catch (error) { return fail(error); }
  revalidatePath("/settings/questionnaire"); revalidatePath("/portal"); return { ok: true };
}

export async function createQuestionnaireTabletSessionAction(patientId: string, previous: ActionState): Promise<ActionState> {
  void previous;
  const ctx = await requireClinicContext();
  try {
    const session = await createQuestionnaireTabletSession(ctx, patientId);
    return { ok: true, data: { url: `/health/tablet/${session.token}`, expiresAt: session.expiresAt.toISOString() } };
  } catch (error) { return fail(error); }
}

export async function recordPortalResponseAction(organizationId: string, _previous: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requirePatientSession();
  if (fd.get("acknowledged") !== "on") return { error: "health.patient.ackRequired" };
  try { await recordPortalHealthResponse(ctx, organizationId, answersFromFormData(fd)); } catch (error) { return fail(error); }
  revalidatePath("/portal"); revalidatePath(`/portal/health/${organizationId}`); return { ok: true };
}

export async function recordTabletResponseAction(token: string, _previous: ActionState, fd: FormData): Promise<ActionState> {
  if (fd.get("acknowledged") !== "on") return { error: "health.patient.ackRequired" };
  try { await recordTabletHealthResponse(token, answersFromFormData(fd)); } catch (error) { return fail(error); }
  return { ok: true };
}

export async function reviewAction(patientId: string, outcome: "reviewed" | "no_changes"): Promise<ActionState> {
  const ctx = await requireClinicContext();
  try {
    await reviewHistory(ctx, patientId, outcome, null);
  } catch (e) {
    return fail(e);
  }
  revalidatePath(`/patients/${patientId}`);
  return { ok: true };
}

export async function approveQuestionnaireAction(patientId: string): Promise<ActionState> {
  const ctx = await requireClinicContext();
  try {
    await approveQuestionnaire(ctx);
  } catch (e) {
    return fail(e);
  }
  revalidatePath(`/patients/${patientId}`);
  return { ok: true };
}

/** Clinician turns a recorded "yes" answer into a patient alert (never automatic). Label built server-side. */
export async function promoteToAlertAction(patientId: string, questionId: string): Promise<ActionState> {
  const ctx = await requireClinicContext();
  try {
    const h = await getHealthHistory(ctx, patientId);
    const q = h.latest?.questions.find((x) => x.id === questionId);
    const a = h.latest?.answers[questionId];
    if (!q || !a || (q.kind === "yes_no" && a.value !== "yes")) return { error: "health.errors.notPromotable" };
    const locale = await getLocale();
    const source = q.alertLabel ?? q.label;
    const label = ((source as Record<string, string | undefined>)[locale] || source.fr).replace(/\s*\?$/, "");
    const details = a.details ?? a.text ?? null;
    await addPatientAlert(ctx, patientId, {
      kind: q.alertKind ?? "medical",
      severity: q.alertKind === "allergy" ? "critical" : "warning",
      label: (details ? `${label} : ${details}` : label).slice(0, 200),
      details: `Questionnaire médical du ${h.latest!.r.recordedAt.toISOString().slice(0, 10)}`,
    });
  } catch (e) {
    return fail(e);
  }
  revalidatePath(`/patients/${patientId}`);
  return { ok: true };
}
