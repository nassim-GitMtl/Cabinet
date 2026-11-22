import { getOperationalNotifications } from "@/features/notifications/server";
import { requireClinicContext } from "@/server/auth/context";

export const dynamic = "force-dynamic";

export async function GET() {
  const ctx = await requireClinicContext();
  const notifications = await getOperationalNotifications(ctx).catch(() => []);
  return Response.json(notifications, {
    headers: { "Cache-Control": "private, no-store, max-age=0" },
  });
}
