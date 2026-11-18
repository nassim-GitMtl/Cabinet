import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { approveQuestionnaire, changedQuestions, getHealthHistory, healthStatus, normalizeAnswers, recordResponse, reviewHistory } from "@/features/health/server";
import { STARTER_QUESTIONS } from "@/features/health/starter-questionnaire";
import { createPatient } from "@/features/patients/server";
import { ForbiddenError } from "@/server/auth/context";
import { questionnaireResponses, questionnaireVersions } from "@/server/db/schema";
import { withDbContext } from "@/server/db/tenant";
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
});
