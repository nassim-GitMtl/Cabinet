import { describe, expect, it } from "vitest";
import { detectClinicalFile } from "./storage";

describe("clinical file content detection", () => {
  it("uses magic bytes instead of the browser-provided media type", () => {
    expect(detectClinicalFile(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toMatchObject({ mimeType: "image/jpeg", extension: "jpg" });
    expect(detectClinicalFile(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toMatchObject({ mimeType: "image/png" });
    expect(detectClinicalFile(new TextEncoder().encode("%PDF-1.7\n"))).toMatchObject({ kind: "document", mimeType: "application/pdf" });
    const dicom = new Uint8Array(132); dicom.set(new TextEncoder().encode("DICM"), 128);
    expect(detectClinicalFile(dicom)).toMatchObject({ mimeType: "application/dicom", extension: "dcm" });
    expect(detectClinicalFile(new TextEncoder().encode("<svg><script/></svg>"))).toBeNull();
  });
});
