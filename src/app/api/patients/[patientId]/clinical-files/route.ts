import { revalidatePath } from "next/cache";
import { ClinicalFileError, finalizeClinicalFileBlobUpload, uploadClinicalFile } from "@/features/clinical-files/server";
import { clinicalFileInputSchema, MAX_CLINICAL_FILE_BYTES } from "@/features/clinical-files/schemas";
import { ForbiddenError, requireClinicContext } from "@/server/auth/context";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseInput(value: Record<string, unknown>) {
  return clinicalFileInputSchema.safeParse({
    category: value.category,
    title: value.title,
    clinicalDate: value.clinicalDate ?? "",
    toothNumbers: value.toothNumbers,
    compareToFileId: value.compareToFileId,
  });
}

function invalidInput(parsed: { success: false; error: { issues: { message: string }[] } }) {
  const issue = parsed.error.issues[0];
  return Response.json({ error: issue?.message.includes(".") ? issue.message : `errors.${issue?.message ?? "generic"}` }, { status: 400 });
}

export async function POST(request: Request, { params }: { params: Promise<{ patientId: string }> }) {
  const { patientId } = await params;
  if (!UUID.test(patientId)) return Response.json({ error: "clinicalFiles.errors.patientUnavailable" }, { status: 404 });
  const ctx = await requireClinicContext();
  try {
    if (request.headers.get("content-type")?.includes("application/json")) {
      const body: unknown = await request.json();
      if (typeof body !== "object" || body === null) return Response.json({ error: "errors.generic" }, { status: 400 });
      const values = body as Record<string, unknown>;
      const parsed = parseInput(values);
      if (!parsed.success) return invalidInput(parsed);
      if (typeof values.storageKey !== "string" || typeof values.originalFilename !== "string") {
        return Response.json({ error: "errors.generic" }, { status: 400 });
      }
      const id = await finalizeClinicalFileBlobUpload(ctx, patientId, parsed.data, {
        name: values.originalFilename,
        storageKey: values.storageKey,
      });
      revalidatePath(`/patients/${patientId}`);
      return Response.json({ id }, { status: 201 });
    }

    const length = Number(request.headers.get("content-length") ?? 0);
    if (length > MAX_CLINICAL_FILE_BYTES + 512 * 1024) return Response.json({ error: "clinicalFiles.errors.tooLarge" }, { status: 413 });
    const form = await request.formData();
    // Absent fields arrive as null; the schema treats optional fields as undefined.
    const field = (name: string) => form.get(name) ?? undefined;
    const parsed = parseInput({ category: field("category"), title: field("title"), clinicalDate: field("clinicalDate"),
      toothNumbers: field("toothNumbers"), compareToFileId: field("compareToFileId") });
    if (!parsed.success) return invalidInput(parsed);
    const file = form.get("file");
    if (!(file instanceof File)) return Response.json({ error: "clinicalFiles.errors.emptyFile" }, { status: 400 });
    const id = await uploadClinicalFile(ctx, patientId, parsed.data, { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
    revalidatePath(`/patients/${patientId}`);
    return Response.json({ id }, { status: 201 });
  } catch (error) {
    if (error instanceof ForbiddenError) return Response.json({ error: "forbidden" }, { status: 403 });
    if (error instanceof ClinicalFileError) return Response.json({ error: `clinicalFiles.errors.${error.code}` }, { status: error.code === "tooLarge" ? 413 : 400 });
    throw error;
  }
}
