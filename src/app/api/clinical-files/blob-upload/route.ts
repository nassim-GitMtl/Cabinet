import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { authorizeClinicalFileBlobUpload, ClinicalFileError } from "@/features/clinical-files/server";
import { MAX_CLINICAL_FILE_BYTES } from "@/features/clinical-files/schemas";
import { pendingClinicalBlobKey } from "@/features/clinical-files/storage";
import { ForbiddenError, requireClinicContext } from "@/server/auth/context";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALLOWED_CONTENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
  "application/dicom",
  "application/octet-stream",
];

function parseClientPayload(value: string | null) {
  if (!value) throw new ClinicalFileError("storageUnavailable");
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      typeof parsed === "object" && parsed !== null &&
      "patientId" in parsed && typeof parsed.patientId === "string" && UUID.test(parsed.patientId)
    ) return { patientId: parsed.patientId };
  } catch {
    // Handled by the common patient-safe error below.
  }
  throw new ClinicalFileError("storageUnavailable");
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as HandleUploadBody;
    const result = await handleUpload({
      request,
      body,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const ctx = await requireClinicContext();
        const { patientId } = parseClientPayload(clientPayload);
        const uploadId = pathname.split("/").at(-1)?.replace(/\.bin$/i, "") ?? "";
        if (!UUID.test(uploadId) || pathname !== pendingClinicalBlobKey(patientId, uploadId)) {
          throw new ClinicalFileError("storageUnavailable");
        }
        await authorizeClinicalFileBlobUpload(ctx, patientId);
        return {
          allowedContentTypes: ALLOWED_CONTENT_TYPES,
          maximumSizeInBytes: MAX_CLINICAL_FILE_BYTES,
          addRandomSuffix: false,
          allowOverwrite: false,
          // Abandoned temporary uploads disappear automatically. Finalized
          // blobs are renamed without this TTL.
          ttlDays: 1,
        };
      },
    });
    return Response.json(result);
  } catch (error) {
    if (error instanceof ForbiddenError) return Response.json({ error: "forbidden" }, { status: 403 });
    if (error instanceof ClinicalFileError) {
      return Response.json({ error: `clinicalFiles.errors.${error.code}` }, { status: 400 });
    }
    throw error;
  }
}
