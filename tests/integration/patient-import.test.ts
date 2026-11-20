import { strToU8 } from "fflate";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { analyzePatientImport, listPatientImports, PatientImportError, runPatientImport } from "@/features/patients/import/server";
import { createPatient, searchPatients } from "@/features/patients/server";
import { ForbiddenError } from "@/server/auth/context";
import { auditEvents, patients } from "@/server/db/schema";
import { withDbContext } from "@/server/db/tenant";
import { contextFor, expectDbError, makeClinic } from "../support/factories";

const csv = [
  "N° dossier;Nom;Prénom;Téléphone;Date de naissance;Sexe",
  "1024;BENALI;Lina;0550 99 88 77;05/03/1985;F",
  "1025;HADDAD;Yacine;0550 11 22 33;;M",       // same phone as an existing patient
  "1026;SAIDI;Amel;0661 00 00 07;12/12/1990;F",
  "1027;SAIDI;Amel;0661 00 00 07;12/12/1990;F", // repeated in the file
  "1028;;Sans nom;;;",                          // no last name
  "1029;KACI;Omar;;31/02/1980;X",               // bad date and sex: imported without them
].join("\n");

async function setup(name: string) {
  const ctx = await makeClinic(name);
  const existing = await createPatient(ctx, {
    firstName: "Yacine", lastName: "Haddad", firstNameAr: null, lastNameAr: null, sex: undefined, birthDate: null, birthDatePrecision: "exact",
    phone: "0550 11 22 33", phoneAlt: null, email: null, addressLine: null, city: null, region: null, preferredLocale: "fr", emergencyName: null,
    emergencyRelationship: null, emergencyPhone: null, referralSource: null, referredBy: null, administrativeNotes: null, assignedProviderId: null,
  }, { confirmNotDuplicate: true });
  if (existing.status !== "created") throw new Error("fixture");
  return { ctx, bytes: strToU8(csv) };
}

describe("importing an existing patient list", () => {
  it("previews with guessed columns, then imports only the clean rows in one audited batch", async () => {
    const f = await setup("Cabinet Import A");
    const preview = await analyzePatientImport(f.ctx, f.bytes);
    expect(preview.mapping).toMatchObject({ legacyNumber: 0, lastName: 1, firstName: 2, phone: 3, birthDate: 4, sex: 5 });
    expect(preview.counts).toEqual({ total: 6, ready: 3, duplicateClinic: 1, duplicateFile: 1, invalid: 1 });
    expect(preview.rows.find((r) => r.line === 7)!.issues.map((i) => i.code)).toEqual(["invalidSex", "invalidDate"]);

    const result = await runPatientImport(f.ctx, { bytes: f.bytes, fileName: "patients.csv", mapping: preview.mapping, includeDuplicates: false });
    expect(result).toMatchObject({ imported: 3, skippedDuplicates: 2, skippedInvalid: 1 });

    const lina = (await searchPatients(f.ctx, { q: "1024" })).rows;
    expect(lina).toMatchObject([{ lastName: "BENALI", firstName: "Lina", patientNumber: "P-000002" }]);
    const imported = await withDbContext({ organizationId: f.ctx.organizationId, actorType: "staff" }, (tx) =>
      tx.select().from(patients).where(eq(patients.importId, result.importId)));
    expect(imported.map((p) => p.patientNumber).sort()).toEqual(["P-000002", "P-000003", "P-000004"]);
    const omar = imported.find((p) => p.lastName === "KACI")!;
    expect(omar).toMatchObject({ birthDate: null, sex: null, legacyNumber: "1029" });
    expect(imported.find((p) => p.lastName === "BENALI")).toMatchObject({ birthDate: "1985-03-05", sex: "female", phone: "+213550998877" });

    const audits = await withDbContext({ organizationId: f.ctx.organizationId, actorType: "staff" }, (tx) =>
      tx.select().from(auditEvents).where(eq(auditEvents.action, "patient.imported")));
    expect(audits).toHaveLength(3);
    expect((await listPatientImports(f.ctx))[0]).toMatchObject({ fileName: "patients.csv", importedCount: 3, skippedDuplicates: 2, skippedInvalid: 1 });

    // Importing the same file again finds everyone already there.
    const again = await analyzePatientImport(f.ctx, f.bytes);
    expect(again.counts.ready).toBe(0);
    await expect(runPatientImport(f.ctx, { bytes: f.bytes, fileName: "patients.csv", mapping: again.mapping, includeDuplicates: false }))
      .rejects.toMatchObject({ code: "nothingToImport" });
  });

  it("can include possible duplicates on request, checks permissions and keeps clinics apart", async () => {
    const f = await setup("Cabinet Import B");
    const mapping = (await analyzePatientImport(f.ctx, f.bytes)).mapping;
    await expect(analyzePatientImport(contextFor(f.ctx, "accountant"), f.bytes)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(analyzePatientImport(f.ctx, f.bytes, { phone: 3 })).rejects.toBeInstanceOf(PatientImportError);
    expect((await runPatientImport(f.ctx, { bytes: f.bytes, fileName: "p.csv", mapping, includeDuplicates: true })).imported).toBe(5);

    // Another clinic does not see these patients as duplicates.
    const other = await makeClinic("Cabinet Import C");
    expect((await analyzePatientImport(other, f.bytes)).counts).toMatchObject({ ready: 4, duplicateClinic: 0, duplicateFile: 1 });
    const [batch] = await listPatientImports(f.ctx);
    await expectDbError(withDbContext({ organizationId: other.organizationId, userId: other.userId, actorType: "staff" }, (tx) =>
      tx.insert(patients).values({ organizationId: other.organizationId, patientNumber: "P-999999", firstName: "X", lastName: "Y", importId: batch!.id })),
      /same organization/);
  });
});
