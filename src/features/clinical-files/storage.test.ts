import { afterEach, describe, expect, it } from "vitest";
import { clinicalStorageConfigured, detectClinicalFile, isPendingClinicalBlobKey, pendingClinicalBlobKey, usesVercelBlobStorage } from "./storage";

afterEach(() => {
  delete process.env.CLINICAL_STORAGE_BACKEND;
  delete process.env.BLOB_READ_WRITE_TOKEN;
  delete process.env.VERCEL;
});

describe("clinical file content detection", () => {
  it("uses magic bytes instead of the browser-provided media type", () => {
    expect(detectClinicalFile(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toMatchObject({ mimeType: "image/jpeg", extension: "jpg" });
    expect(detectClinicalFile(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toMatchObject({ mimeType: "image/png" });
    expect(detectClinicalFile(new TextEncoder().encode("%PDF-1.7\n"))).toMatchObject({ kind: "document", mimeType: "application/pdf" });
    const dicom = new Uint8Array(132); dicom.set(new TextEncoder().encode("DICM"), 128);
    expect(detectClinicalFile(dicom)).toMatchObject({ mimeType: "application/dicom", extension: "dcm" });
    expect(detectClinicalFile(new TextEncoder().encode("<svg><script/></svg>"))).toBeNull();
  });

  it("keeps direct Blob upload keys patient-scoped", () => {
    const patientId = "00000000-0000-4000-8000-000000000001";
    const uploadId = "00000000-0000-4000-8000-000000000002";
    const key = pendingClinicalBlobKey(patientId, uploadId);
    expect(key).toBe(`pending/${patientId}/${uploadId}.bin`);
    expect(isPendingClinicalBlobKey(key, patientId)).toBe(true);
    expect(isPendingClinicalBlobKey(key, "00000000-0000-4000-8000-000000000003")).toBe(false);
    expect(() => pendingClinicalBlobKey("not-a-patient", uploadId)).toThrow(/invalidStorageKey/);
  });

  it("requires a private Blob token only when that backend is selected", () => {
    expect(usesVercelBlobStorage()).toBe(false);
    expect(clinicalStorageConfigured()).toBe(true);
    process.env.CLINICAL_STORAGE_BACKEND = "vercel-blob";
    expect(usesVercelBlobStorage()).toBe(true);
    expect(clinicalStorageConfigured()).toBe(false);
    process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_test";
    expect(clinicalStorageConfigured()).toBe(true);
    process.env.CLINICAL_STORAGE_BACKEND = "typo";
    expect(clinicalStorageConfigured()).toBe(false);
    delete process.env.CLINICAL_STORAGE_BACKEND;
    process.env.VERCEL = "1";
    expect(clinicalStorageConfigured()).toBe(false);
  });
});
