import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { uploadClinicalFile } from "@/features/clinical-files/server";
import { createPortalInvitation } from "@/features/consent/server";
import { authorizePortalJourneyImage, getPortalJourney, listPortalJourneys, setPortalJourneyAccess } from "@/features/journey/portal";
import { addJourneyMilestone, getPatientJourney, shareJourneyComparison, shareJourneyImage, withdrawJourneyItem } from "@/features/journey/server";
import { createPatient } from "@/features/patients/server";
import { todayInZone } from "@/lib/dates";
import { ForbiddenError } from "@/server/auth/context";
import { auditEvents, patientJourneyAccess, patientJourneyItems } from "@/server/db/schema";
import { withDbContext } from "@/server/db/tenant";
import { activatePortalAccount } from "@/server/portal/auth";
import type { PatientPortalContext } from "@/server/portal/session";
import { contextFor, expectDbError, makeClinic } from "../support/factories";

const patientInput = {
  firstName: "Sara", lastName: "Parcours", firstNameAr: null, lastNameAr: null, sex: undefined,
  birthDate: "1990-04-02", birthDatePrecision: "exact" as const, phone: null, phoneAlt: null, email: null,
  addressLine: null, city: null, region: null, preferredLocale: "fr" as const, emergencyName: null,
  emergencyRelationship: null, emergencyPhone: null, referralSource: null, referredBy: null,
  administrativeNotes: null, assignedProviderId: null,
};
const png = (marker: number) => Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, marker]);

let storageDirectory = "";
beforeAll(async () => {
  storageDirectory = await mkdtemp(path.join(tmpdir(), "cabinet-journey-"));
  process.env.CLINICAL_STORAGE_DIR = storageDirectory;
});
afterAll(async () => {
  delete process.env.CLINICAL_STORAGE_DIR;
  await rm(storageDirectory, { recursive: true, force: true });
});

/** A clinic, a patient with a portal account, two photos forming a before/after pair, and a second patient. */
async function setup(name: string) {
  const ctx = await makeClinic(name);
  const email = `sara-${randomUUID()}@example.test`;
  const created = await createPatient(ctx, { ...patientInput, email }, { confirmNotDuplicate: true });
  if (created.status !== "created") throw new Error("fixture");
  const other = await createPatient(ctx, { ...patientInput, firstName: "Autre", email: `autre-${randomUUID()}@example.test` }, { confirmNotDuplicate: true });
  if (other.status !== "created") throw new Error("fixture");
  const invitation = await createPortalInvitation(ctx, created.id, email, "IDCHECK-2026-777");
  const identity = await activatePortalAccount(invitation.token, "patient-safe-password");
  const portal: PatientPortalContext = { ...identity, sessionId: "test" };
  const photo = { category: "intraoral_photo" as const, title: "Molaire", clinicalDate: "2026-11-10", toothNumbers: ["36"], compareToFileId: null };
  const beforeId = await uploadClinicalFile(ctx, created.id, photo, { name: "avant.png", bytes: png(1) });
  const afterId = await uploadClinicalFile(ctx, created.id, { ...photo, compareToFileId: beforeId }, { name: "apres.png", bytes: png(2) });
  const otherPhoto = await uploadClinicalFile(ctx, other.id, photo, { name: "autre.png", bytes: png(3) });
  const asStaff = <T,>(fn: Parameters<typeof withDbContext<T>>[1]) =>
    withDbContext({ organizationId: ctx.organizationId, userId: ctx.userId, actorType: "staff" }, fn);
  const comparisonId = (await getPatientJourney(ctx, created.id)).comparisons[0]!.id;
  return { ctx, portal, patientId: created.id, otherPatientId: other.id, beforeId, afterId, otherPhoto, comparisonId, asStaff, today: todayInZone(ctx.organization.timezone) };
}

describe("visual treatment journey", () => {
  it("shows the clinician's choices only after the patient switches the journey on", async () => {
    const f = await setup("Parcours Accord");
    const stepId = await addJourneyMilestone(f.ctx, f.patientId, { title: "Fin des soins des caries", body: "Prochaine étape : la couronne.", eventDate: f.today });
    const photoId = await shareJourneyImage(f.ctx, f.patientId, { clinicalFileId: f.afterId, title: "Votre dent aujourd’hui", eventDate: "2026-11-10" });
    const pairId = await shareJourneyComparison(f.ctx, f.patientId, { comparisonId: f.comparisonId, title: "Avant et après", eventDate: "2026-11-10" });

    // Before switching on: the patient knows something was shared, but sees no content and no photo.
    let journey = await getPortalJourney(f.portal, f.ctx.organizationId);
    expect(journey).toMatchObject({ access: null, sharedCount: 3, items: [] });
    expect(await authorizePortalJourneyImage(f.portal, f.ctx.organizationId, photoId, "photo")).toBeNull();
    expect((await listPortalJourneys(f.portal)).map((j) => j.organizationId)).toEqual([f.ctx.organizationId]);

    await setPortalJourneyAccess(f.portal, f.ctx.organizationId, "granted");
    journey = await getPortalJourney(f.portal, f.ctx.organizationId);
    expect(journey!.items.map((i) => i.id).sort()).toEqual([stepId, photoId, pairId].sort());
    expect(await authorizePortalJourneyImage(f.portal, f.ctx.organizationId, photoId, "photo")).toMatchObject({ mimeType: "image/png" });
    expect(await authorizePortalJourneyImage(f.portal, f.ctx.organizationId, pairId, "before")).toMatchObject({ mimeType: "image/png" });
    expect(await authorizePortalJourneyImage(f.portal, f.ctx.organizationId, stepId, "photo")).toBeNull();
    expect((await getPatientJourney(f.ctx, f.patientId)).access).toMatchObject({ decision: "granted" });

    // Withdrawn by the clinic: gone from the portal, photo refused, kept in the record with the reason.
    await withdrawJourneyItem(f.ctx, photoId, "Mauvaise photo");
    journey = await getPortalJourney(f.portal, f.ctx.organizationId);
    expect(journey!.items.map((i) => i.id)).not.toContain(photoId);
    expect(await authorizePortalJourneyImage(f.portal, f.ctx.organizationId, photoId, "photo")).toBeNull();
    await expect(withdrawJourneyItem(f.ctx, photoId, "encore")).rejects.toMatchObject({ code: "itemUnavailable" });

    // Hidden again by the patient: nothing shown, nothing served; every decision is kept.
    await setPortalJourneyAccess(f.portal, f.ctx.organizationId, "revoked");
    expect((await getPortalJourney(f.portal, f.ctx.organizationId))!.items).toEqual([]);
    expect(await authorizePortalJourneyImage(f.portal, f.ctx.organizationId, pairId, "after")).toBeNull();
    const decisions = await f.asStaff((tx) => tx.select().from(patientJourneyAccess).where(eq(patientJourneyAccess.patientId, f.patientId)));
    expect(decisions.map((d) => d.decision)).toEqual(["granted", "revoked"]);
    const viewed = await f.asStaff((tx) => tx.select().from(auditEvents).where(and(eq(auditEvents.action, "patient_journey.file_viewed"), eq(auditEvents.patientId, f.patientId))));
    expect(viewed.length).toBe(2);
  });

  it("only shares the same patient's images, and never edits a shared item", async () => {
    const f = await setup("Parcours Garde-fous");
    await expect(shareJourneyImage(f.ctx, f.patientId, { clinicalFileId: f.otherPhoto, title: "x", eventDate: "2026-11-10" })).rejects.toMatchObject({ code: "fileUnavailable" });
    await expect(addJourneyMilestone(f.ctx, f.patientId, { title: "   ", eventDate: f.today })).rejects.toMatchObject({ code: "invalidText" });
    await expect(shareJourneyImage(f.ctx, f.patientId, { clinicalFileId: f.afterId, title: "Futur", eventDate: "2999-01-01" })).rejects.toMatchObject({ code: "invalidDate" });
    // The database refuses another patient's photo even without the service.
    await expectDbError(f.asStaff((tx) => tx.insert(patientJourneyItems).values({ organizationId: f.ctx.organizationId, patientId: f.patientId, kind: "image", clinicalFileId: f.otherPhoto, title: "x", eventDate: f.today, sharedByUserId: f.ctx.userId })), /same patient/);

    const id = await addJourneyMilestone(f.ctx, f.patientId, { title: "Étape", eventDate: f.today });
    await expectDbError(f.asStaff((tx) => tx.update(patientJourneyItems).set({ title: "Réécrit" }).where(eq(patientJourneyItems.id, id))), /not edited/);
    await expectDbError(f.asStaff((tx) => tx.delete(patientJourneyItems).where(eq(patientJourneyItems.id, id))), /permission denied/);
    await withdrawJourneyItem(f.ctx, id, "Doublon");
    await expectDbError(f.asStaff((tx) => tx.update(patientJourneyItems).set({ withdrawnAt: null, withdrawnByUserId: null, withdrawReason: null }).where(eq(patientJourneyItems.id, id))), /stays withdrawn/);
  });

  it("is for clinicians only and never crosses patients or clinics", async () => {
    const f = await setup("Parcours Isolation A");
    const reception = contextFor({ userId: f.ctx.userId, organizationId: f.ctx.organizationId }, "receptionist");
    await expect(addJourneyMilestone(reception, f.patientId, { title: "x", eventDate: f.today })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getPatientJourney(reception, f.patientId)).rejects.toBeInstanceOf(ForbiddenError);
    const dentist = contextFor({ userId: f.ctx.userId, organizationId: f.ctx.organizationId }, "dentist");
    await addJourneyMilestone(dentist, f.patientId, { title: "Par le dentiste", eventDate: f.today });

    // The other patient's item never reaches this patient's portal.
    const foreign = await shareJourneyImage(f.ctx, f.otherPatientId, { clinicalFileId: f.otherPhoto, title: "Autre patient", eventDate: "2026-11-10" });
    await setPortalJourneyAccess(f.portal, f.ctx.organizationId, "granted");
    expect((await getPortalJourney(f.portal, f.ctx.organizationId))!.items.map((i) => i.title)).toEqual(["Par le dentiste"]);
    expect(await authorizePortalJourneyImage(f.portal, f.ctx.organizationId, foreign, "photo")).toBeNull();

    // Another clinic: no link, no journey, no write through its ids.
    const b = await setup("Parcours Isolation B");
    expect(await getPortalJourney(f.portal, b.ctx.organizationId)).toBeNull();
    expect(await setPortalJourneyAccess(f.portal, b.ctx.organizationId, "granted")).toBe(false);
    await expect(shareJourneyImage(b.ctx, b.patientId, { clinicalFileId: f.afterId, title: "x", eventDate: "2026-11-10" })).rejects.toMatchObject({ code: "fileUnavailable" });
    await expect(addJourneyMilestone(b.ctx, f.patientId, { title: "x", eventDate: b.today })).rejects.toMatchObject({ code: "patientUnavailable" });
  });
});
