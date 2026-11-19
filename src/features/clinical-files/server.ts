import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, or } from "drizzle-orm";
import { todayInZone } from "@/lib/dates";
import { audit } from "@/server/audit";
import { requirePermission, tenantTx, type ClinicContext } from "@/server/auth/context";
import { clinicalFileComparisons, clinicalFiles, patients, users } from "@/server/db/schema";
import type { ClinicalFileInput } from "./schemas";
import { detectClinicalFile, loadClinicalFile, rollbackClinicalFile, storeClinicalFile } from "./storage";

export const MAX_CLINICAL_FILE_BYTES = 20 * 1024 * 1024;

export class ClinicalFileError extends Error {
  constructor(public readonly code: string) { super(code); }
}

const staff = (ctx: ClinicContext) => ({ organizationId: ctx.organizationId, actorType: "staff" as const, actorUserId: ctx.userId });

function safeOriginalName(name: string) {
  const base = name.replaceAll("\\", "/").split("/").at(-1)?.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return (base || "fichier").slice(0, 255);
}

export async function listClinicalFiles(ctx: ClinicContext, patientId: string) {
  requirePermission(ctx, "clinical.images.read");
  return tenantTx(ctx, async (tx) => {
    const files = await tx.select({ file: clinicalFiles, uploaderName: users.fullName })
      .from(clinicalFiles).innerJoin(users, eq(users.id, clinicalFiles.uploadedByUserId))
      .where(eq(clinicalFiles.patientId, patientId))
      .orderBy(desc(clinicalFiles.clinicalDate), desc(clinicalFiles.createdAt));
    const comparisons = await tx.select().from(clinicalFileComparisons)
      .where(eq(clinicalFileComparisons.patientId, patientId)).orderBy(desc(clinicalFileComparisons.createdAt));
    return { files, comparisons };
  });
}

export async function uploadClinicalFile(
  ctx: ClinicContext,
  patientId: string,
  input: ClinicalFileInput,
  uploaded: { name: string; bytes: Uint8Array },
) {
  requirePermission(ctx, "clinical.images.write");
  if (!uploaded.bytes.length) throw new ClinicalFileError("emptyFile");
  if (uploaded.bytes.length > MAX_CLINICAL_FILE_BYTES) throw new ClinicalFileError("tooLarge");
  if (input.clinicalDate > todayInZone(ctx.organization.timezone)) throw new ClinicalFileError("futureDate");
  const detected = detectClinicalFile(uploaded.bytes);
  if (!detected) throw new ClinicalFileError("unsupportedType");
  if (input.compareToFileId && detected.kind !== "image") throw new ClinicalFileError("comparisonImagesOnly");

  const id = randomUUID();
  const storageKey = `${ctx.organizationId}/${patientId}/${id}.${detected.extension}`;
  const sha256 = createHash("sha256").update(uploaded.bytes).digest("hex");
  await storeClinicalFile(storageKey, uploaded.bytes);
  try {
    return await tenantTx(ctx, async (tx) => {
      const [patient] = await tx.select({ id: patients.id, status: patients.status }).from(patients).where(eq(patients.id, patientId)).limit(1);
      if (!patient || patient.status === "archived" || patient.status === "deceased") throw new ClinicalFileError("patientUnavailable");
      let before = null;
      if (input.compareToFileId) {
        [before] = await tx.select().from(clinicalFiles).where(and(eq(clinicalFiles.id, input.compareToFileId), eq(clinicalFiles.patientId, patientId))).limit(1);
        if (!before || before.kind !== "image") throw new ClinicalFileError("comparisonUnavailable");
        if (input.clinicalDate < before.clinicalDate) throw new ClinicalFileError("comparisonDate");
        const [used] = await tx.select({ id: clinicalFileComparisons.id }).from(clinicalFileComparisons)
          .where(or(eq(clinicalFileComparisons.beforeFileId, before.id), eq(clinicalFileComparisons.afterFileId, before.id))).limit(1);
        if (used) throw new ClinicalFileError("comparisonUnavailable");
      }
      await tx.insert(clinicalFiles).values({
        id, organizationId: ctx.organizationId, patientId, kind: detected.kind, category: input.category,
        title: input.title, clinicalDate: input.clinicalDate, toothNumbers: input.toothNumbers,
        mimeType: detected.mimeType, originalFilename: safeOriginalName(uploaded.name), byteSize: uploaded.bytes.length,
        sha256, storageKey, uploadedByUserId: ctx.userId,
      });
      if (before) {
        await tx.insert(clinicalFileComparisons).values({
          organizationId: ctx.organizationId, patientId, beforeFileId: before.id, afterFileId: id, createdByUserId: ctx.userId,
        });
      }
      await audit(tx, { ...staff(ctx), action: "clinical_file.uploaded", entityType: "clinical_file", entityId: id, patientId, metadata: { paired: !!before } });
      return id;
    });
  } catch (error) {
    await rollbackClinicalFile(storageKey);
    throw error;
  }
}

export async function getClinicalFileContent(ctx: ClinicContext, fileId: string) {
  requirePermission(ctx, "clinical.images.read");
  const file = await tenantTx(ctx, async (tx) => {
    const [row] = await tx.select().from(clinicalFiles).where(eq(clinicalFiles.id, fileId)).limit(1);
    if (!row) return null;
    await audit(tx, { ...staff(ctx), action: "clinical_file.viewed", entityType: "clinical_file", entityId: row.id, patientId: row.patientId });
    return row;
  });
  if (!file) return null;
  try { return { file, bytes: await loadClinicalFile(file.storageKey) }; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new ClinicalFileError("storageMissing");
    throw error;
  }
}
