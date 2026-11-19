import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createPortalInvitation } from "@/features/consent/server";
import { getPortalHealthQuestionnaire, getTabletQuestionnaire, listPortalHealthQuestionnaires, recordPortalHealthResponse, recordTabletHealthResponse } from "@/features/health/patient";
import { approveQuestionnaire, changedQuestions, createQuestionnaireDraft, createQuestionnaireTabletSession, getHealthHistory, healthStatus, listQuestionnaireVersions, normalizeAnswers, publishQuestionnaireVersion, recordResponse, reviewHistory } from "@/features/health/server";
import { STARTER_QUESTIONS } from "@/features/health/starter-questionnaire";
import { createPatient } from "@/features/patients/server";
import { ForbiddenError } from "@/server/auth/context";
import { questionnaireResponses, questionnaireTabletSessions, questionnaireVersions } from "@/server/db/schema";
import { withDbContext } from "@/server/db/tenant";
import { activatePortalAccount } from "@/server/portal/auth";
import type { PatientPortalContext } from "@/server/portal/session";
import { contextFor, expectDbError, makeClinic } from "../support/factories";

const blank = {
  firstNameAr: null, lastNameAr: null, sex: undefined, birthDate: null, birthDatePrecision: "exact" as const, phone: null, phoneAlt: null,
  email: null, addressLine: null, city: null, region: null, preferredLocale: "fr" as const, emergencyName: null, emergencyRelationship: null,
  emergencyPhone: null, referralSource: null, referredBy: null, administrativeNotes: null, assignedProviderId: null,
};

async function setup(name: string) {
  const ctx = await makeClinic(name);
  const p = await createPatient(ctx, { ...blank, firstName: "Santé", lastName: "Test" }, { confirmNotDuplicate: true });
  if (p.status !== "created") throw new Error("fixture");
  return { ctx, patientId: p.id };
}

describe("medical history", () => {
  it("keeps unanswered distinct from no, and accepts unknown/declined", () => {
    const a = normalizeAnswers(STARTER_QUESTIONS, {
      allergies: { value: "yes", details: " Pénicilline " },
      diabetes: { value: "no", details: "ignored when no" },
      infectious: { value: "declined" },
      heart: { value: "unknown" },
      bogus: { value: "yes" },
      smoking: { value: "maybe" as never },
      other: { text: "  Appendicectomie 2010 " },
    });
    expect(a).toEqual({
      allergies: { value: "yes", details: "Pénicilline" },
      diabetes: { value: "no" },
      infectious: { value: "declined" },
      heart: { value: "unknown" },
      other: { text: "Appendicectomie 2010" },
    });
    expect(a.medications).toBeUndefined(); // unanswered stays absent, never "no"
    expect(changedQuestions(STARTER_QUESTIONS, { diabetes: { value: "no" } }, { diabetes: { value: "yes" } })).toEqual(["diabetes"]);
  });

  it("preserves history, tracks review state and shows changes since the last review", async () => {
    const f = await setup("Cabinet Santé A");
    expect(await healthStatus(f.ctx, f.patientId)).toBe("none");
    await recordResponse(f.ctx, f.patientId, { answers: { allergies: { value: "no" }, diabetes: { value: "no" } }, patientAcknowledged: true });
    expect(await healthStatus(f.ctx, f.patientId)).toBe("pending_review");
    await reviewHistory(f.ctx, f.patientId, "reviewed", null);
    expect(await healthStatus(f.ctx, f.patientId)).toBe("reviewed");

    await recordResponse(f.ctx, f.patientId, { answers: { allergies: { value: "yes", details: "Latex" }, diabetes: { value: "no" } }, patientAcknowledged: true });
    let h = await getHealthHistory(f.ctx, f.patientId);
    expect(h.history).toHaveLength(2);
    expect(h.latestReviewed).toBe(false);
    expect(h.changedSinceReview).toEqual(["allergies"]);
    await reviewHistory(f.ctx, f.patientId, "no_changes", "Rien de nouveau à la visite");
    h = await getHealthHistory(f.ctx, f.patientId);
    expect(h.latestReviewed).toBe(true);
    expect(h.reviews[0]!.outcome).toBe("no_changes");
    expect(h.approved).toBe(false); // starter wording awaits clinician approval
    await approveQuestionnaire(f.ctx);
    expect((await getHealthHistory(f.ctx, f.patientId)).approved).toBe(true);
  });

  it("responses and questionnaire wording cannot be altered", async () => {
    const f = await setup("Cabinet Santé B");
    const id = await recordResponse(f.ctx, f.patientId, { answers: { smoking: { value: "no" } }, patientAcknowledged: false });
    const db = { organizationId: f.ctx.organizationId, userId: f.ctx.userId, actorType: "staff" as const };
    await expectDbError(withDbContext(db, (tx) => tx.update(questionnaireResponses).set({ answers: { smoking: { value: "yes" } } }).where(eq(questionnaireResponses.id, id))), /permission denied/);
    await expectDbError(withDbContext(db, (tx) => tx.update(questionnaireVersions).set({ questions: [] })), /immutable/);
  });

  it("restricts access by role and clinic", async () => {
    const f = await setup("Cabinet Santé C");
    await recordResponse(f.ctx, f.patientId, { answers: { smoking: { value: "no" } }, patientAcknowledged: true });
    await expect(getHealthHistory(contextFor(f.ctx, "receptionist"), f.patientId)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(recordResponse(contextFor(f.ctx, "accountant"), f.patientId, { answers: { smoking: { value: "no" } }, patientAcknowledged: true })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(reviewHistory(contextFor(f.ctx, "assistant"), f.patientId, "reviewed", null)).rejects.toBeInstanceOf(ForbiddenError);
    const other = await makeClinic("Cabinet Santé D");
    expect((await getHealthHistory(other, f.patientId)).latest).toBeNull();
    await expect(recordResponse(other, f.patientId, { answers: { smoking: { value: "no" } }, patientAcknowledged: true })).rejects.toMatchObject({ code: "notFound" });
  });

  it("creates immutable drafts and activates a clinician-approved version without rewriting history", async () => {
    const f = await setup("Cabinet Santé Versions");
    const [starter] = await listQuestionnaireVersions(f.ctx);
    await publishQuestionnaireVersion(contextFor(f.ctx, "dentist"), starter!.id);
    await recordResponse(f.ctx, f.patientId, { answers: { smoking: { value: "no" } }, patientAcknowledged: true });

    const draftId = await createQuestionnaireDraft(f.ctx, {
      titleFr: "Antécédents médicaux actualisés",
      titleEn: "Updated medical history",
      titleAr: "التاريخ الطبي المحدث",
      questions: [{
        id: "allergies", kind: "yes_no", labelFr: "Avez-vous des allergies ?", labelEn: "Do you have allergies?",
        labelAr: "هل لديك حساسية؟", detailFr: "Précisez", detailEn: "Please specify", detailAr: "يرجى التوضيح",
        sensitive: true, alertLabelFr: "Allergie", alertLabelEn: "Allergy", alertLabelAr: "حساسية", alertKind: "allergy",
      }],
    });
    let versions = await listQuestionnaireVersions(f.ctx);
    expect(versions).toMatchObject([{ id: draftId, versionNo: 2, isCurrent: false, approvedAt: null }, { versionNo: 1, isCurrent: true }]);
    await expect(createQuestionnaireDraft(contextFor(f.ctx, "dentist"), {
      titleFr: "Interdit", titleEn: undefined, titleAr: undefined, questions: [{
        id: "test_item", kind: "text", labelFr: "Test", labelEn: undefined, labelAr: undefined,
        detailFr: undefined, detailEn: undefined, detailAr: undefined, sensitive: false,
        alertLabelFr: undefined, alertLabelEn: undefined, alertLabelAr: undefined, alertKind: null,
      }],
    })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(publishQuestionnaireVersion(contextFor(f.ctx, "assistant"), draftId)).rejects.toBeInstanceOf(ForbiddenError);

    await publishQuestionnaireVersion(contextFor(f.ctx, "dentist"), draftId);
    await recordResponse(f.ctx, f.patientId, { answers: { allergies: { value: "yes", details: "Latex" } }, patientAcknowledged: true });
    const history = await getHealthHistory(f.ctx, f.patientId);
    expect(history.history.map((entry) => entry.versionNo)).toEqual([2, 1]);
    versions = await listQuestionnaireVersions(f.ctx);
    expect(versions.map((version) => [version.versionNo, version.isCurrent, !!version.approvedAt])).toEqual([[2, true, true], [1, false, true]]);
    await expect(publishQuestionnaireVersion(f.ctx, draftId)).rejects.toMatchObject({ code: "versionNotDraft" });
  });

  it("lets the exact linked patient complete the approved questionnaire through the portal", async () => {
    const f = await setup("Cabinet Santé Portail");
    await approveQuestionnaire(f.ctx);
    const email = `health-${randomUUID()}@example.test`;
    const invitation = await createPortalInvitation(f.ctx, f.patientId, email, "HEALTH-IDENTITY-001");
    const identity = await activatePortalAccount(invitation.token, "patient-safe-password");
    const portalCtx: PatientPortalContext = { ...identity, sessionId: "health-session" };

    expect(await listPortalHealthQuestionnaires(portalCtx)).toMatchObject([{ organizationId: f.ctx.organizationId, latestAt: null }]);
    expect(await getPortalHealthQuestionnaire(portalCtx, f.ctx.organizationId)).toMatchObject({ patientId: f.patientId });
    const other = await makeClinic("Cabinet Santé Portail Isolé");
    expect(await getPortalHealthQuestionnaire(portalCtx, other.organizationId)).toBeNull();

    await recordPortalHealthResponse(portalCtx, f.ctx.organizationId, { diabetes: { value: "no" } });
    const history = await getHealthHistory(f.ctx, f.patientId);
    expect(history.history[0]).toMatchObject({ source: "patient_portal", acknowledged: true });
  });

  it("uses a single-use tablet handoff and keeps its session isolated by clinic", async () => {
    const f = await setup("Cabinet Santé Tablette");
    await approveQuestionnaire(f.ctx);
    const handoff = await createQuestionnaireTabletSession(f.ctx, f.patientId);
    expect(await getTabletQuestionnaire(handoff.token)).toMatchObject({ organizationId: f.ctx.organizationId, patientId: f.patientId });

    const other = await makeClinic("Cabinet Santé Tablette Isolé");
    const hidden = await withDbContext({ organizationId: other.organizationId, userId: other.userId, actorType: "staff" }, (tx) =>
      tx.select().from(questionnaireTabletSessions));
    expect(hidden).toEqual([]);

    await recordTabletHealthResponse(handoff.token, { smoking: { value: "no" } });
    expect(await getTabletQuestionnaire(handoff.token)).toBeNull();
    await expect(recordTabletHealthResponse(handoff.token, { smoking: { value: "yes" } })).rejects.toMatchObject({ code: "tabletExpired" });
    const history = await getHealthHistory(f.ctx, f.patientId);
    expect(history.history[0]).toMatchObject({ source: "patient_tablet", acknowledged: true });
  });
});
