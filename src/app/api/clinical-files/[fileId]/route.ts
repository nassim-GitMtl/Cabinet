import { ClinicalFileError, getClinicalFileDownload } from "@/features/clinical-files/server";
import { can, requireClinicContext } from "@/server/auth/context";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_request: Request, { params }: { params: Promise<{ fileId: string }> }) {
  const { fileId } = await params;
  if (!UUID.test(fileId)) return new Response("Not found", { status: 404 });
  const ctx = await requireClinicContext();
  if (!can(ctx, "clinical.images.read")) return new Response("Forbidden", { status: 403 });
  try {
    const result = await getClinicalFileDownload(ctx, fileId);
    if (!result) return new Response("Not found", { status: 404 });
    const pdf = result.file.mimeType === "application/pdf";
    const preview = result.file.kind === "image" || pdf;
    const encodedName = encodeURIComponent(result.file.originalFilename);
    const headers: Record<string, string> = {
      "Content-Type": result.file.mimeType,
      "Content-Length": String(result.byteSize),
      "Content-Disposition": `${preview ? "inline" : "attachment"}; filename*=UTF-8''${encodedName}`,
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    };
    // The media type comes from verified magic bytes and nosniff is set, so nothing here can render as HTML.
    // Browsers refuse to open a PDF in their viewer under `sandbox`, so the extra CSP is kept for the rest only.
    if (!pdf) headers["Content-Security-Policy"] = "sandbox";
    const body = result.body instanceof Uint8Array ? Uint8Array.from(result.body).buffer : result.body;
    return new Response(body, { headers });
  } catch (error) {
    if (error instanceof ClinicalFileError && error.code === "storageMissing") return new Response("Not found", { status: 404 });
    throw error;
  }
}
