import { loadClinicLogo } from "@/features/clinic-identity/server";
import { requireClinicContext } from "@/server/auth/context";

export const dynamic = "force-dynamic";

/** The signed-in clinic's logo (printed documents, settings preview). */
export async function GET() {
  const ctx = await requireClinicContext();
  const logo = await loadClinicLogo(ctx.organizationId);
  if (!logo) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(logo.bytes), {
    headers: {
      "Content-Type": logo.mimeType,
      // URLs carry the logo version, so a long private cache is safe.
      "Cache-Control": "private, max-age=86400",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox",
    },
  });
}
