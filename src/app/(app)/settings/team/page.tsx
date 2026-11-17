import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ArrowLeftIcon } from "lucide-react";
import { ForbiddenState, PageHeader } from "@/components/app/page-header";
import { TeamManagement } from "@/features/access/components/team-management";
import { getAccessSettings } from "@/features/access/server";
import { can, requireClinicContext } from "@/server/auth/context";

export default async function TeamPage() {
  const ctx = await requireClinicContext(); const t = await getTranslations();
  if (!can(ctx, "org.staff.manage")) return <ForbiddenState message={t("errors.forbiddenPage")} />;
  const data = await getAccessSettings(ctx);
  return <><Link href="/settings" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeftIcon className="size-4 rtl:rotate-180" />{t("settings.title")}</Link><PageHeader title={t("access.teamTitle")} description={t("access.teamSubtitle")} /><TeamManagement {...data} currentUserId={ctx.userId} /></>;
}
