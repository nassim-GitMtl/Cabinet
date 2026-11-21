import { getFormatter, getTranslations } from "next-intl/server";
import { CloudIcon, CloudOffIcon, TriangleAlertIcon } from "lucide-react";
import type { ClinicContext } from "@/server/auth/context";
import { nodeRole, nodeStatus } from "@/server/sync/node";
import { lastClinicSync } from "../server";

/**
 * Top-of-page notice. Cloud copy of a clinic run from its clinic computer: view-only + last sync. Clinic computer:
 * shown only when sync is failing (nothing is shown while everything is in sync).
 */
export async function SyncNotice({ ctx }: { ctx: ClinicContext }) {
  const [t, all, format] = await Promise.all([getTranslations("sync"), getTranslations(), getFormatter()]);
  const now = new Date();
  if (ctx.readOnlyCopy) {
    const last = await lastClinicSync(ctx);
    return <div role="status" className="mb-4 flex items-start gap-3 rounded-xl border border-primary/25 bg-primary/5 p-3 text-sm">
      <CloudIcon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
      <p><span className="font-medium">{t("readOnlyBanner")}</span> <span className="text-muted-foreground">{last ? t("lastSync", { when: format.relativeTime(last, now) }) : t("neverSynced")}</span></p>
    </div>;
  }
  if ((await nodeRole()) !== "clinic") return null;
  const status = await nodeStatus();
  if (status.state !== "active" || !status.lastError) return null;
  const offline = status.lastError === "offline";
  const reason = all.has(`sync.reasons.${status.lastError}` as never) ? all(`sync.reasons.${status.lastError}` as never) : status.lastError;
  const Icon = offline ? CloudOffIcon : TriangleAlertIcon;
  return <div role="status" className={`mb-4 flex items-start gap-3 rounded-xl border p-3 text-sm ${offline ? "border-border bg-muted/50" : "border-warning/50 bg-warning/10"}`}>
    <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
    <p>{offline ? t("offlineBanner") : t("errorBanner", { reason })}</p>
  </div>;
}
