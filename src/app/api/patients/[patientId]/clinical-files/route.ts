import { revalidatePath } from "next/cache";
import { ClinicalFileError, MAX_CLINICAL_FILE_BYTES, uploadClinicalFile } from "@/features/clinical-files/server";
import { clinicalFileInputSchema } from "@/features/clinical-files/schemas";
import { ForbiddenError, requireClinicContext } from "@/server/auth/context";

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request, { params }: { params: Promise<{ patientId: string }> }) {
  const { patientId } = await params;
  if (!UUID.test(patientId)) return Response.json({ error: "clinicalFiles.errors.patientUnavailable" }, { status: 404 });
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_CLINICAL_FILE_BYTES + 512 * 1024) return Response.json({ error: "clinicalFiles.errors.tooLarge" }, { status: 413 });
  const ctx = await requireClinicContext();
  try {
    const form = await request.formData();
    // Absent fields arrive as null; the schema treats optional fields as undefined.
    const field = (name: string) => form.get(name) ?? undefined;
    const parsed = clinicalFileInputSchema.safeParse({
      category: field("category"), title: field("title"), clinicalDate: field("clinicalDate") ?? "",
      toothNumbers: field("toothNumbers"), compareToFileId: field("compareToFileId"),
    });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return Response.json({ error: issue?.message.includes(".") ? issue.message : `errors.${issue?.message ?? "generic"}` }, { status: 400 });
    }
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
