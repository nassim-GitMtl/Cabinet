import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { ButtonLink } from "@/components/button-link";
import { ForbiddenState, PageHeader } from "@/components/app/page-header";
import { defaultTemplates } from "@/features/follow-ups/compose";
import { FollowUpSettingsForm } from "@/features/follow-ups/components/follow-up-settings-form";
import { getFollowUpSettings } from "@/features/follow-ups/server";
import { formatPhone } from "@/lib/phone";
import { can, requireClinicContext } from "@/server/auth/context";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("followUps.settings"))("title") };
}

export default async function FollowUpSettingsPage() {
  const ctx = await requireClinicContext();
  const t = await getTranslations("followUps");
  if (!can(ctx, "org.settings.manage")) return <ForbiddenState message={(await getTranslations("errors"))("forbiddenPage")} />;
  const [settings, locale] = await Promise.all([getFollowUpSettings(ctx), getLocale()]);
  return (
    <>
      <PageHeader
        title={t("settings.title")}
        description={t("settings.subtitle")}
        back={<ButtonLink href={can(ctx, "patient.followup") ? "/follow-ups" : "/settings"} variant="ghost">← {can(ctx, "patient.followup") ? t("title") : (await getTranslations("settings"))("title")}</ButtonLink>}
      />
      <FollowUpSettingsForm
        recallMonths={settings.recallMonths}
        branches={settings.branches.map((b) => ({ id: b.id, name: b.name, phone: b.phone ? formatPhone(b.phone) : "" }))}
        custom={settings.templates}
        defaults={defaultTemplates()}
        reviewUrl={settings.reviewUrl ?? ""}
        aftercare={settings.aftercare}
        categories={settings.categories.map((c) => ({ id: c.id, name: (c.name as Record<string, string | undefined>)[locale] || c.name.fr }))}
      />
    </>
  );
}
