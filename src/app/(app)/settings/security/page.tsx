import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ArrowLeftIcon } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { loadSecurityState } from "@/features/access/actions";
import { SecurityPanel } from "@/features/access/components/security-panel";
import { requireClinicContext } from "@/server/auth/context";
import { isMfaEnabled } from "@/server/auth/mfa";

export default async function SecurityPage() {
  const ctx = await requireClinicContext(); const t = await getTranslations();
  const [state, mfaEnabled] = await Promise.all([loadSecurityState(), isMfaEnabled(ctx.userId)]);
  return <><Link href="/settings" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeftIcon className="size-4 rtl:rotate-180" />{t("settings.title")}</Link><PageHeader title={t("access.securityTitle")} description={t("access.securitySubtitle")} /><SecurityPanel {...state} mfaEnabled={mfaEnabled} /></>;
}
