import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { audit } from "@/server/audit";
import { can, requirePermission, tenantTx, type ClinicContext } from "@/server/auth/context";
import type { Tx } from "@/server/db/client";
import {
  healthHistoryReviews,
  patients,
  questionnaireResponses,
  questionnaireVersions,
  users,
  type Answers,
  type AnswerValue,
  type Question,
} from "@/server/db/schema";
import { STARTER_QUESTIONS, STARTER_TITLE } from "./starter-questionnaire";

export class HealthError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}

const KEY = "medical_history";
const VALUES: AnswerValue[] = ["yes", "no", "unknown", "declined"];
const staff = (ctx: ClinicContext) => ({ organizationId: ctx.organizationId, actorType: "staff" as const, actorUserId: ctx.userId });

/** Current questionnaire version; creates the starter version (unapproved) on first use. */
async function currentVersion(tx: Tx, ctx: ClinicContext) {
  const [v] = await tx.select().from(questionnaireVersions).where(and(eq(questionnaireVersions.key, KEY), eq(questionnaireVersions.isCurrent, true))).limit(1);
  if (v) return v;
  await tx
    .insert(questionnaireVersions)
    .values({ organizationId: ctx.organizationId, key: KEY, versionNo: 1, title: STARTER_TITLE, questions: STARTER_QUESTIONS })
    .onConflictDoNothing();
  const [created] = await tx.select().from(questionnaireVersions).where(and(eq(questionnaireVersions.key, KEY), eq(questionnaireVersions.isCurrent, true))).limit(1);
  return created!;
}

/** Keeps only known questions; distinguishes unanswered (absent) from explicit values. */
export function normalizeAnswers(questions: Question[], raw: Answers): Answers {
  const out: Answers = {};
  for (const q of questions) {
    const a = raw[q.id];
    if (!a) continue;
    if (q.kind === "yes_no") {
      if (!a.value || !VALUES.includes(a.value)) continue;
      out[q.id] = { value: a.value, ...(a.value === "yes" && a.details?.trim() ? { details: a.details.trim().slice(0, 2000) } : {}) };
    } else {
      const text = a.text?.trim();
      if (text) out[q.id] = { text: text.slice(0, 4000) };
      else if (a.value === "declined" || a.value === "unknown") out[q.id] = { value: a.value };
    }
  }
  return out;
}

const same = (a?: { value?: string; text?: string; details?: string }, b?: { value?: string; text?: string; details?: string }) =>
  (a?.value ?? "") === (b?.value ?? "") && (a?.text ?? "") === (b?.text ?? "") && (a?.details ?? "") === (b?.details ?? "");

/** Question ids whose answer differs between two responses (unanswered counts as a value). */
export function changedQuestions(questions: Question[], before: Answers | null, after: Answers): string[] {
  if (!before) return [];
  return questions.filter((q) => !same(before[q.id], after[q.id])).map((q) => q.id);
}

export async function getHealthHistory(ctx: ClinicContext, patientId: string) {
  requirePermission(ctx, "clinical.read");
  return tenantTx(ctx, async (tx) => {
    const version = await currentVersion(tx, ctx);
    const responses = await tx
      .select({ r: questionnaireResponses, recordedBy: users.fullName, questions: questionnaireVersions.questions, versionNo: questionnaireVersions.versionNo })
      .from(questionnaireResponses)
      .innerJoin(questionnaireVersions, eq(questionnaireVersions.id, questionnaireResponses.questionnaireVersionId))
      .leftJoin(users, eq(users.id, questionnaireResponses.recordedByUserId))
      .where(eq(questionnaireResponses.patientId, patientId))
      .orderBy(desc(questionnaireResponses.recordedAt));
    const reviews = await tx
      .select({ rv: healthHistoryReviews, reviewer: users.fullName })
      .from(healthHistoryReviews)
      .innerJoin(users, eq(users.id, healthHistoryReviews.reviewedByUserId))
      .where(eq(healthHistoryReviews.patientId, patientId))
      .orderBy(desc(healthHistoryReviews.reviewedAt));
    const latest = responses[0] ?? null;
    const lastReview = reviews[0] ?? null;
    const reviewedResponse = lastReview ? responses.find((x) => x.r.id === lastReview.rv.responseId) ?? null : null;
    const latestReviewed = !!latest && lastReview?.rv.responseId === latest.r.id;
    if (latest) await audit(tx, { ...staff(ctx), action: "health_history.viewed", entityType: "patient", entityId: patientId, patientId });
    return {
      version,
      approved: !!version.approvedAt,
      latest: latest ? { ...latest, answers: latest.r.answers } : null,
      latestReviewed,
      lastReview,
      /** Answers changed since the last review (empty if never reviewed or nothing changed). */
      changedSinceReview: latest && reviewedResponse && !latestReviewed ? changedQuestions(latest.questions, reviewedResponse.r.answers, latest.r.answers) : [],
      history: responses.map((x) => ({ id: x.r.id, recordedAt: x.r.recordedAt, source: x.r.source, recordedBy: x.recordedBy, versionNo: x.versionNo, acknowledged: x.r.patientAcknowledged })),
      reviews: reviews.map((x) => ({ id: x.rv.id, outcome: x.rv.outcome, reviewedAt: x.rv.reviewedAt, reviewer: x.reviewer, responseId: x.rv.responseId, note: x.rv.note })),
    };
  });
}

/** Records a new response (staff-entered). Earlier responses are kept unchanged. */
export async function recordResponse(
  ctx: ClinicContext,
  patientId: string,
  input: { answers: Answers; patientAcknowledged: boolean; appointmentId?: string | null },
) {
  requirePermission(ctx, "clinical.write");
  return tenantTx(ctx, async (tx) => {
    const [patient] = await tx.select({ id: patients.id }).from(patients).where(eq(patients.id, patientId));
    if (!patient) throw new HealthError("notFound");
    const version = await currentVersion(tx, ctx);
    const answers = normalizeAnswers(version.questions, input.answers);
    if (Object.keys(answers).length === 0) throw new HealthError("empty");
    const [r] = await tx
      .insert(questionnaireResponses)
      .values({
        organizationId: ctx.organizationId,
        patientId,
        questionnaireVersionId: version.id,
        answers,
        source: "staff_entered",
        recordedByUserId: ctx.userId,
        patientAcknowledged: input.patientAcknowledged,
        appointmentId: input.appointmentId ?? null,
      })
      .returning({ id: questionnaireResponses.id });
    await audit(tx, { ...staff(ctx), action: "health_history.recorded", entityType: "questionnaire_response", entityId: r!.id, patientId, metadata: { answered: Object.keys(answers).length } });
    return r!.id;
  });
}

/** Clinician review of the latest response; "no_changes" is the explicit reviewed-without-change action. */
export async function reviewHistory(ctx: ClinicContext, patientId: string, outcome: "reviewed" | "no_changes", note: string | null, appointmentId?: string | null) {
  requirePermission(ctx, "clinical.sign");
  return tenantTx(ctx, async (tx) => {
    const [latest] = await tx.select({ id: questionnaireResponses.id }).from(questionnaireResponses).where(eq(questionnaireResponses.patientId, patientId)).orderBy(desc(questionnaireResponses.recordedAt)).limit(1);
    if (!latest) throw new HealthError("nothingToReview");
    const [rv] = await tx
      .insert(healthHistoryReviews)
      .values({ organizationId: ctx.organizationId, patientId, responseId: latest.id, outcome, note: note?.trim() || null, appointmentId: appointmentId ?? null, reviewedByUserId: ctx.userId })
      .returning({ id: healthHistoryReviews.id });
    await audit(tx, { ...staff(ctx), action: `health_history.${outcome}`, entityType: "health_history_review", entityId: rv!.id, patientId });
  });
}

/** A clinician approves the current questionnaire wording (one time per version). */
export async function approveQuestionnaire(ctx: ClinicContext) {
  requirePermission(ctx, "clinical.sign");
  requirePermission(ctx, "org.settings.manage");
  return tenantTx(ctx, async (tx) => {
    const v = await currentVersion(tx, ctx);
    if (v.approvedAt) return;
    await tx.update(questionnaireVersions).set({ approvedByUserId: ctx.userId, approvedAt: new Date() }).where(eq(questionnaireVersions.id, v.id));
    await audit(tx, { ...staff(ctx), action: "questionnaire.approved", entityType: "questionnaire_version", entityId: v.id });
  });
}

/** Status for the patient header: none recorded, awaiting clinician review, or reviewed. */
export async function healthStatus(ctx: ClinicContext, patientId: string): Promise<"none" | "pending_review" | "reviewed" | null> {
  if (!can(ctx, "clinical.read")) return null;
  return tenantTx(ctx, async (tx) => {
    const [latest] = await tx.select({ id: questionnaireResponses.id }).from(questionnaireResponses).where(eq(questionnaireResponses.patientId, patientId)).orderBy(desc(questionnaireResponses.recordedAt)).limit(1);
    if (!latest) return "none";
    const [rv] = await tx.select({ responseId: healthHistoryReviews.responseId }).from(healthHistoryReviews).where(eq(healthHistoryReviews.patientId, patientId)).orderBy(desc(healthHistoryReviews.reviewedAt)).limit(1);
    return rv?.responseId === latest.id ? "reviewed" : "pending_review";
  });
}
