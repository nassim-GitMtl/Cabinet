import { authorizePortalJourneyImage } from "@/features/journey/portal";
import { openClinicalFile } from "@/features/clinical-files/storage";
import { readPatientSession } from "@/server/portal/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A photo of the patient's own treatment journey. Lives under /portal so the patient session cookie (path /portal)
 * is sent. Served only for a shared, not withdrawn item of this exact patient after they switched the journey on.
 */
export async function GET(request: Request, { params }: { params: Promise<{ organizationId: string; itemId: string }> }) {
  const { organizationId, itemId } = await params;
  const sideParam = new URL(request.url).searchParams.get("side");
  const side = sideParam === "before" || sideParam === "after" ? sideParam : "photo";
  if (!UUID.test(organizationId) || !UUID.test(itemId)) return new Response("Not found", { status: 404 });
  const ctx = await readPatientSession();
  if (!ctx) return new Response("Unauthorized", { status: 401 });
  const file = await authorizePortalJourneyImage(ctx, organizationId, itemId, side);
  if (!file) return new Response("Not found", { status: 404 });
  try {
    const opened = await openClinicalFile(file.storageKey);
    const body = opened.body instanceof Uint8Array ? Uint8Array.from(opened.body).buffer : opened.body;
    return new Response(body, {
      headers: {
        "Content-Type": file.mimeType,
        "Content-Length": String(opened.byteSize),
        "Content-Disposition": "inline",
        "Cache-Control": "private, no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "sandbox",
      },
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" || (error as { code?: string }).code === "storageMissing") return new Response("Not found", { status: 404 });
    throw error;
  }
}
