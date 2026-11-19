import { publicOrigin } from "@/features/public-page/origin";
import { qrSvg } from "@/features/public-page/qr";
import { getPublicPageSettings } from "@/features/public-page/server";
import { can, requireClinicContext } from "@/server/auth/context";

export const dynamic = "force-dynamic";

/** SVG QR code of the published page, for flyers and social media posts. */
export async function GET() {
  const ctx = await requireClinicContext();
  if (!can(ctx, "org.settings.manage")) return new Response("Forbidden", { status: 403 });
  const data = await getPublicPageSettings(ctx);
  if (!data.profile?.isPublished) return new Response("Not found", { status: 404 });
  const { origin } = await publicOrigin();
  const svg = await qrSvg(`${origin}/c/${data.profile.slug}`);
  return new Response(svg, {
    headers: {
      "Content-Type": "image/svg+xml",
      "Content-Disposition": `attachment; filename="qr-${data.profile.slug}.svg"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
