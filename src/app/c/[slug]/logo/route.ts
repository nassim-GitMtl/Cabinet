import { loadPublicClinicLogo } from "@/features/clinic-identity/server";

export const dynamic = "force-dynamic";

/** Logo of a published public page only (same resolution rules as the page itself). */
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!/^[a-z0-9-]{3,60}$/i.test(slug)) return new Response("Not found", { status: 404 });
  const logo = await loadPublicClinicLogo(slug);
  if (!logo) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(logo.bytes), {
    headers: {
      "Content-Type": logo.mimeType,
      "Cache-Control": "public, max-age=3600",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox",
    },
  });
}
