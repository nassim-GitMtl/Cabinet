"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import type { ActionState } from "@/lib/action-state";
import { ForbiddenError, requireClinicContext } from "@/server/auth/context";
import type { Answers } from "@/server/db/schema";
import { addPatientAlert } from "@/features/patients/server";
import { approveQuestionnaire, getHealthHistory, HealthError, recordResponse, reviewHistory } from "./server";

function fail(err: unknown): ActionState {
  if (err instanceof ForbiddenError) return { error: "forbidden" };
  if (err instanceof HealthError) return { error: `health.errors.${err.code}` };
  throw err;
}

/** Form fields: q_<id> = yes|no|unknown|declined, d_<id> = details, t_<id> = free text. */
export async function recordResponseAction(patientId: string, _p: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireClinicContext();
  const answers: Answers = {};
  for (const [key, raw] of fd.entries()) {
    if (typeof raw !== "string") continue;
    const m = /^([qdt])_([a-z_]+)$/.exec(key);
    if (!m) continue;
    const a = (answers[m[2]!] ??= {});
    if (m[1] === "q") a.value = raw as never;
    if (m[1] === "d") a.details = raw;
    if (m[1] === "t") a.text = raw;
  }
  try {
    await recordResponse(ctx, patientId, { answers, patientAcknowledged: fd.get("acknowledged") === "on" });
  } catch (e) {
    return fail(e);
  }
  revalidatePath(`/patients/${patientId}`);
  redirect(`/patients/${patientId}?tab=health`);
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
