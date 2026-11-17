import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ArrowLeftIcon } from "lucide-react";
import { ForbiddenState, PageHeader } from "@/components/app/page-header";
import { RoleEditor } from "@/features/access/components/role-editor";
import { listRoles } from "@/features/access/server";
import { can, requireClinicContext } from "@/server/auth/context";

export default async function RolesPage() {
  const ctx = await requireClinicContext(); const t = await getTranslations();
  if (!can(ctx, "org.roles.manage")) return <ForbiddenState message={t("errors.forbiddenPage")} />;
  const roleRows = await listRoles(ctx);
  return <><Link href="/settings" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeftIcon className="size-4 rtl:rotate-180" />{t("settings.title")}</Link><PageHeader title={t("access.rolesTitle")} description={t("access.rolesSubtitle")} /><RoleEditor roles={roleRows} /></>;
}
