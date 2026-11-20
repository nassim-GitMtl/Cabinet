import "server-only";

import { createHash } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { todayInZone } from "@/lib/dates";
import { requirePermission, tenantTx, type ClinicContext } from "@/server/auth/context";
import { auditEvents, patientImports, patients } from "@/server/db/schema";
import { reserveCounterBlock } from "@/server/db/tenant";
import { buildRow, duplicateKeys, guessMapping, IMPORT_FIELDS, nameOnlyKey, type ImportIssue, type ImportMapping } from "./mapping";
import { parseSpreadsheet } from "./parse";

export class PatientImportError extends Error {
  constructor(public readonly code: "invalidMapping" | "nameColumnRequired" | "nothingToImport") { super(code); }
}

export type ImportRowStatus = "ready" | "duplicateClinic" | "duplicateFile" | "invalid";
export type ImportPreviewRow = { line: number; status: ImportRowStatus; name: string; phone: string | null; birthDate: string | null; issues: ImportIssue[] };

const PREVIEW_ROWS = 200;

/** Reads, maps and checks a file without writing anything (also re-run by the import itself). */
export async function analyzePatientImport(ctx: ClinicContext, bytes: Uint8Array, requested?: ImportMapping) {
  requirePermission(ctx, "patient.create");
  const sheet = parseSpreadsheet(bytes);
  const mapping = requested ?? guessMapping(sheet.headers);
  for (const [field, index] of Object.entries(mapping)) {
    if (!(IMPORT_FIELDS as readonly string[]).includes(field) || !Number.isInteger(index) || index! < 0 || index! >= sheet.headers.length) {
      throw new PatientImportError("invalidMapping");
    }
  }
  if (mapping.fullName === undefined && (mapping.lastName === undefined || mapping.firstName === undefined)) {
    throw new PatientImportError("nameColumnRequired");
  }
  const today = todayInZone(ctx.organization.timezone);
  const built = sheet.rows.map((raw) => buildRow(raw, mapping, { today, countryCode: ctx.organization.countryCode }));

  // Same person already in the clinic (any status, archived included) or earlier in the file.
  const existing = await tenantTx(ctx, (tx) => tx.select({
    phone: patients.phone, phoneAlt: patients.phoneAlt, lastName: patients.lastName, firstName: patients.firstName, birthDate: patients.birthDate,
  }).from(patients));
  const withNameKey = (keys: string[], p: { lastName: string; firstName: string }) => {
    const weak = nameOnlyKey(p);
    return weak ? [...keys, weak] : keys;
  };
  const clinicKeys = new Set(existing.flatMap((p) => withNameKey([...duplicateKeys(p), ...(p.phoneAlt ? [`phone:${p.phoneAlt}`] : [])], p)));
  const fileKeys = new Set<string>();
  const statuses: ImportRowStatus[] = built.map(({ patient, issues }) => {
    if (issues.some((i) => i.level === "error")) return "invalid";
    // Strong keys when available; names alone only for rows with neither phone nor birth date.
    const strong = duplicateKeys(patient);
    const keys = strong.length ? strong : withNameKey([], patient);
    const status: ImportRowStatus = keys.some((k) => clinicKeys.has(k)) ? "duplicateClinic" : keys.some((k) => fileKeys.has(k)) ? "duplicateFile" : "ready";
    withNameKey(strong, patient).forEach((k) => fileKeys.add(k));
    return status;
  });
  const count = (s: ImportRowStatus) => statuses.filter((x) => x === s).length;
  return {
    headers: sheet.headers,
    mapping,
    sample: sheet.rows.slice(0, 3),
    counts: { total: built.length, ready: count("ready"), duplicateClinic: count("duplicateClinic"), duplicateFile: count("duplicateFile"), invalid: count("invalid") },
    rows: built.slice(0, PREVIEW_ROWS).map(({ patient, issues }, i): ImportPreviewRow => ({
      line: i + 2, status: statuses[i]!, name: `${patient.lastName.toUpperCase()} ${patient.firstName}`.trim(),
      phone: patient.phone, birthDate: patient.birthDate, issues,
    })),
    built,
    statuses,
  };
}

/** Creates the ready rows (and possible duplicates only when asked) in one transaction, with history and audit. */
export async function runPatientImport(ctx: ClinicContext, input: { bytes: Uint8Array; fileName: string; mapping: ImportMapping; includeDuplicates: boolean }) {
  const analysis = await analyzePatientImport(ctx, input.bytes, input.mapping);
  const selected = analysis.built.filter((_, i) => {
    const s = analysis.statuses[i]!;
    return s === "ready" || (input.includeDuplicates && (s === "duplicateClinic" || s === "duplicateFile"));
  });
  if (!selected.length) throw new PatientImportError("nothingToImport");
  const skippedDuplicates = input.includeDuplicates ? 0 : analysis.counts.duplicateClinic + analysis.counts.duplicateFile;

  return tenantTx(ctx, async (tx) => {
    const [batch] = await tx.insert(patientImports).values({
      organizationId: ctx.organizationId, fileName: input.fileName.slice(0, 200) || "import",
      fileSha256: createHash("sha256").update(input.bytes).digest("hex"), totalRows: analysis.counts.total,
      importedCount: selected.length, skippedDuplicates, skippedInvalid: analysis.counts.invalid, createdByUserId: ctx.userId,
    }).returning({ id: patientImports.id });
    const first = await reserveCounterBlock(tx, ctx.organizationId, "patient", selected.length);
    const locale = (["fr", "en", "ar"] as const).find((l) => l === ctx.organization.defaultLocale) ?? "fr";
    const ids: { id: string }[] = [];
    for (let start = 0; start < selected.length; start += 500) {
      const chunk = selected.slice(start, start + 500);
      ids.push(...await tx.insert(patients).values(chunk.map(({ patient: p }, i) => ({
        organizationId: ctx.organizationId,
        patientNumber: `P-${String(first + start + i).padStart(6, "0")}`,
        firstName: p.firstName, lastName: p.lastName, firstNameAr: p.firstNameAr, lastNameAr: p.lastNameAr,
        sex: p.sex, birthDate: p.birthDate, birthDatePrecision: p.birthDatePrecision,
        phone: p.phone, phoneAlt: p.phoneAlt, email: p.email, addressLine: p.addressLine, city: p.city,
        administrativeNotes: p.administrativeNotes, legacyNumber: p.legacyNumber, preferredLocale: locale,
        communicationPrefs: { transactionalAllowed: true }, importId: batch!.id, createdByUserId: ctx.userId,
      }))).returning({ id: patients.id }));
    }
    // Same audit trail as a manual creation, in the same transaction (identifiers only).
    for (let start = 0; start < ids.length; start += 1000) {
      await tx.insert(auditEvents).values(ids.slice(start, start + 1000).map(({ id }) => ({
        organizationId: ctx.organizationId, actorType: "staff" as const, actorUserId: ctx.userId, action: "patient.imported",
        entityType: "patient", entityId: id, patientId: id, metadata: { importId: batch!.id },
      })));
    }
    await tx.insert(auditEvents).values({
      organizationId: ctx.organizationId, actorType: "staff", actorUserId: ctx.userId, action: "patient_import.completed",
      entityType: "patient_import", entityId: batch!.id, metadata: { imported: selected.length, skippedDuplicates, skippedInvalid: analysis.counts.invalid },
    });
    return { importId: batch!.id, imported: selected.length, skippedDuplicates, skippedInvalid: analysis.counts.invalid };
  });
}

export async function listPatientImports(ctx: ClinicContext) {
  requirePermission(ctx, "patient.create");
  return tenantTx(ctx, (tx) => tx.select().from(patientImports).orderBy(desc(patientImports.createdAt)).limit(20));
}

export async function countImportedPatients(ctx: ClinicContext, importId: string) {
  requirePermission(ctx, "patient.read");
  return tenantTx(ctx, async (tx) => (await tx.select({ id: patients.id }).from(patients).where(eq(patients.importId, importId))).length);
}
