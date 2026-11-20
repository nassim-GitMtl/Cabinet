import { revalidatePath } from "next/cache";
import { IMPORT_FIELDS, type ImportMapping } from "@/features/patients/import/mapping";
import { ImportParseError, MAX_IMPORT_BYTES } from "@/features/patients/import/parse";
import { analyzePatientImport, PatientImportError, runPatientImport } from "@/features/patients/import/server";
import { ForbiddenError, requireClinicContext } from "@/server/auth/context";

export const dynamic = "force-dynamic";

/** Multipart: file + mode ("preview" | "import") + optional mapping JSON. The file is never stored. */
export async function POST(request: Request) {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_IMPORT_BYTES + 64 * 1024) return Response.json({ error: "patientImport.errors.tooLarge" }, { status: 413 });
  const ctx = await requireClinicContext();
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) return Response.json({ error: "patientImport.errors.empty" }, { status: 400 });
    const bytes = new Uint8Array(await file.arrayBuffer());
    let mapping: ImportMapping | undefined;
    const rawMapping = form.get("mapping");
    if (typeof rawMapping === "string" && rawMapping) {
      const parsed = JSON.parse(rawMapping) as Record<string, unknown>;
      mapping = Object.fromEntries(Object.entries(parsed).filter(([k, v]) => (IMPORT_FIELDS as readonly string[]).includes(k) && Number.isInteger(v))) as ImportMapping;
    }
    if (form.get("mode") === "import") {
      if (!mapping) return Response.json({ error: "patientImport.errors.invalidMapping" }, { status: 400 });
      const result = await runPatientImport(ctx, { bytes, fileName: file.name, mapping, includeDuplicates: form.get("includeDuplicates") === "1" });
      revalidatePath("/patients");
      return Response.json(result);
    }
    const analysis = await analyzePatientImport(ctx, bytes, mapping);
    return Response.json({ headers: analysis.headers, mapping: analysis.mapping, sample: analysis.sample, counts: analysis.counts, rows: analysis.rows });
  } catch (error) {
    if (error instanceof ForbiddenError) return Response.json({ error: "forbidden" }, { status: 403 });
    if (error instanceof ImportParseError || error instanceof PatientImportError) return Response.json({ error: `patientImport.errors.${error.code}` }, { status: 400 });
    if (error instanceof SyntaxError) return Response.json({ error: "patientImport.errors.invalidMapping" }, { status: 400 });
    throw error;
  }
}
