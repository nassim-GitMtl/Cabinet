import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getAgendaSetup } from "@/features/agenda/server";
import { amendNote, createNote, discardDraft, getNote, listNotes, listNoteTemplates, NoteError, saveDraft, signNote, submitForReview, verifyChain } from "@/features/notes/server";
import { createPatient } from "@/features/patients/server";
import { todayInZone } from "@/lib/dates";
import { ForbiddenError } from "@/server/auth/context";
import { clinicalNotes, clinicalNoteVersions } from "@/server/db/schema";
import { withDbContext } from "@/server/db/tenant";
import { contextFor, expectDbError, makeClinic } from "../support/factories";

const blank = {
  firstNameAr: null, lastNameAr: null, sex: undefined, birthDate: null, birthDatePrecision: "exact" as const, phone: null, phoneAlt: null,
  email: null, addressLine: null, city: null, region: null, preferredLocale: "fr" as const, emergencyName: null, emergencyRelationship: null,
  emergencyPhone: null, referralSource: null, referredBy: null, administrativeNotes: null, assignedProviderId: null,
};

async function setup(name: string) {
  const ctx = await makeClinic(name);
  const p = await createPatient(ctx, { ...blank, firstName: "Note", lastName: "Clinique" }, { confirmNotDuplicate: true });
  if (p.status !== "created") throw new Error("fixture");
  const providerId = (await getAgendaSetup(ctx)).providers[0]!.id;
  const today = todayInZone(ctx.organization.timezone);
  return { ctx, patientId: p.id, providerId, today };
}

describe("clinical notes", () => {
  it("starts from a template, autosaves with optimistic locking, and signs into an immutable version", async () => {
    const f = await setup("Cabinet Notes A");
    const template = (await listNoteTemplates(f.ctx)).find((t) => t.name === "Extraction")!;
    const id = await createNote(f.ctx, f.patientId, { kind: "procedure", serviceDate: f.today, providerId: f.providerId, templateId: template.id });
    let note = (await getNote(f.ctx, id))!;
    expect(note.note.draftBody!.performedWork).toContain("Anesthésie");
    const v2 = await saveDraft(f.ctx, id, { ...note.note.draftBody!, performedWork: "Avulsion 36 sous anesthésie locale.", teeth: ["36", "99"] }, note.note.version);
    await expect(saveDraft(f.ctx, id, { plan: "x" }, note.note.version)).rejects.toMatchObject({ code: "conflict" });
    await expect(signNote(f.ctx, id, v2, false)).rejects.toMatchObject({ code: "attestationRequired" });
    await signNote(f.ctx, id, v2, true);
    note = (await getNote(f.ctx, id))!;
    expect(note.note.status).toBe("signed");
    expect(note.versions).toHaveLength(1);
    expect(note.versions[0]!.v.body.teeth).toEqual(["36"]); // invalid tooth dropped
    expect(note.versions[0]!.v.templateSnapshot?.performedWork).toContain("Anesthésie");
    expect(note.chainValid).toBe(true);
    await expect(saveDraft(f.ctx, id, { plan: "changer" }, note.note.version)).rejects.toMatchObject({ code: "notEditable" });

    const db = { organizationId: f.ctx.organizationId, userId: f.ctx.userId, actorType: "staff" as const };
    await expectDbError(withDbContext(db, (tx) => tx.update(clinicalNoteVersions).set({ body: { ...note.versions[0]!.v.body, plan: "falsifié" } }).where(eq(clinicalNoteVersions.noteId, id))), /permission denied/);
    await expectDbError(withDbContext(db, (tx) => tx.update(clinicalNotes).set({ serviceDate: "2020-01-01" }).where(eq(clinicalNotes.id, id))), /immutable/);
    await expectDbError(withDbContext(db, (tx) => tx.delete(clinicalNotes).where(eq(clinicalNotes.id, id))), /permission denied/);
  });

  it("amendments append dated versions with a reason; the hash chain detects tampering", async () => {
    const f = await setup("Cabinet Notes B");
    const id = await createNote(f.ctx, f.patientId, { kind: "consultation", serviceDate: f.today, providerId: f.providerId, templateId: null });
    const v = await saveDraft(f.ctx, id, { chiefComplaint: "Douleur 46", assessment: "Pulpite" }, 1);
    await signNote(f.ctx, id, v, true);
    await expect(amendNote(f.ctx, id, { assessment: "Pulpite irréversible" }, "")).rejects.toMatchObject({ code: "reasonRequired" });
    await amendNote(f.ctx, id, { assessment: "Pulpite irréversible 46" }, "Précision du diagnostic");
    const note = (await getNote(f.ctx, id))!;
    expect(note.versions.map((x) => [x.v.versionNo, x.v.kind])).toEqual([[1, "original"], [2, "amendment"]]);
    expect(note.versions[0]!.v.body.assessment).toBe("Pulpite"); // original preserved
    expect(note.chainValid).toBe(true);
    const tampered = note.versions.map((x) => x.v);
    tampered[0] = { ...tampered[0]!, body: { ...tampered[0]!.body, assessment: "modifié" } };
    expect(verifyChain(tampered)).toBe(false);
  });

  it("assistants draft and submit for review; only signers sign; discarded drafts disappear from the list", async () => {
    const f = await setup("Cabinet Notes C");
    const assistant = contextFor(f.ctx, "assistant");
    const id = await createNote(assistant, f.patientId, { kind: "progress", serviceDate: f.today, providerId: f.providerId, templateId: null });
    await expect(submitForReview(assistant, id)).rejects.toMatchObject({ code: "emptyNote" });
    const v = await saveDraft(assistant, id, { observations: "Gencive inflammée secteur 4" }, 1);
    await submitForReview(assistant, id);
    await expect(signNote(assistant, id, v + 1, true)).rejects.toBeInstanceOf(ForbiddenError);
    const n = (await getNote(f.ctx, id))!;
    expect(n.note.status).toBe("in_review");
    await signNote(f.ctx, id, n.note.version, true);

    const draft = await createNote(f.ctx, f.patientId, { kind: "other", serviceDate: f.today, providerId: f.providerId, templateId: null });
    await discardDraft(f.ctx, draft);
    expect((await listNotes(f.ctx, f.patientId)).map((x) => x.id)).toEqual([id]);
    await expect(createNote(f.ctx, f.patientId, { kind: "other", serviceDate: "2999-01-01", providerId: f.providerId, templateId: null })).rejects.toBeInstanceOf(NoteError);
  });

  it("is restricted to clinical roles and isolated per clinic", async () => {
    const f = await setup("Cabinet Notes D");
    const id = await createNote(f.ctx, f.patientId, { kind: "other", serviceDate: f.today, providerId: f.providerId, templateId: null });
    await expect(listNotes(contextFor(f.ctx, "receptionist"), f.patientId)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listNotes(contextFor(f.ctx, "accountant"), f.patientId)).rejects.toBeInstanceOf(ForbiddenError);
    const other = await makeClinic("Cabinet Notes E");
    expect(await getNote(other, id)).toBeNull();
  });
});
