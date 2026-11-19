import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getClinicalFileContent, listClinicalFiles, uploadClinicalFile } from "@/features/clinical-files/server";
import { createPatient } from "@/features/patients/server";
import { ForbiddenError } from "@/server/auth/context";
import { clinicalFiles } from "@/server/db/schema";
import { withDbContext } from "@/server/db/tenant";
import { contextFor, expectDbError, makeClinic } from "../support/factories";

const patientInput = {
  firstName: "Image", lastName: "Clinique", firstNameAr: null, lastNameAr: null, sex: undefined,
  birthDate: null, birthDatePrecision: "exact" as const, phone: null, phoneAlt: null, email: null,
  addressLine: null, city: null, region: null, preferredLocale: "fr" as const, emergencyName: null,
  emergencyRelationship: null, emergencyPhone: null, referralSource: null, referredBy: null,
  administrativeNotes: null, assignedProviderId: null,
};

let storageDirectory = "";
beforeAll(async () => {
  storageDirectory = await mkdtemp(path.join(tmpdir(), "cabinet-clinical-files-"));
  process.env.CLINICAL_STORAGE_DIR = storageDirectory;
});
afterAll(async () => {
  delete process.env.CLINICAL_STORAGE_DIR;
  await rm(storageDirectory, { recursive: true, force: true });
});

async function setup(name: string) {
  const ctx = await makeClinic(name);
  const patient = await createPatient(ctx, patientInput, { confirmNotDuplicate: true });
  if (patient.status !== "created") throw new Error("patient fixture");
  return { ctx, patientId: patient.id };
}

const png = (marker: number) => Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, marker]);
const input = (compareToFileId: string | null = null) => ({
  category: "intraoral_photo" as const, title: "Photo molaire", clinicalDate: "2026-11-18",
  toothNumbers: ["26"], compareToFileId,
});

describe("private clinical images and documents", () => {
  it("stores verified originals privately and creates an immutable before/after pair", async () => {
    const f = await setup("Cabinet Fichiers A");
    const beforeId = await uploadClinicalFile(f.ctx, f.patientId, input(), { name: "before.png", bytes: png(1) });
    const afterId = await uploadClinicalFile(f.ctx, f.patientId, input(beforeId), { name: "after.png", bytes: png(2) });

    const library = await listClinicalFiles(f.ctx, f.patientId);
    expect(library.files.map((row) => row.file.id)).toEqual(expect.arrayContaining([beforeId, afterId]));
    expect(library.comparisons).toMatchObject([{ beforeFileId: beforeId, afterFileId: afterId }]);
    const original = await getClinicalFileContent(f.ctx, beforeId);
    expect([...original!.bytes]).toEqual([...png(1)]);
    expect(original!.file).toMatchObject({ mimeType: "image/png", originalFilename: "before.png", toothNumbers: ["26"] });

    await expectDbError(withDbContext({ organizationId: f.ctx.organizationId, userId: f.ctx.userId, actorType: "staff" }, (tx) =>
      tx.update(clinicalFiles).set({ title: "Réécrit" }).where(eq(clinicalFiles.id, beforeId))), /permission denied/);
    await expect(uploadClinicalFile(f.ctx, f.patientId, input(beforeId), { name: "third.png", bytes: png(3) }))
      .rejects.toMatchObject({ code: "comparisonUnavailable" });
  });

  it("rejects spoofed content and isolates metadata and bytes between clinics", async () => {
    const f = await setup("Cabinet Fichiers B");
    await expect(uploadClinicalFile(f.ctx, f.patientId, input(), { name: "attack.jpg", bytes: new TextEncoder().encode("<html>not an image</html>") }))
      .rejects.toMatchObject({ code: "unsupportedType" });
    const fileId = await uploadClinicalFile(f.ctx, f.patientId, input(), { name: "private.png", bytes: png(4) });
    const other = await makeClinic("Cabinet Fichiers Isolé");
    expect((await listClinicalFiles(other, f.patientId)).files).toEqual([]);
    expect(await getClinicalFileContent(other, fileId)).toBeNull();
    await expect(uploadClinicalFile(other, f.patientId, input(), { name: "cross.png", bytes: png(5) }))
      .rejects.toMatchObject({ code: "patientUnavailable" });
    await expect(listClinicalFiles(contextFor(f.ctx, "receptionist"), f.patientId)).rejects.toBeInstanceOf(ForbiddenError);
  });
});
