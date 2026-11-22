import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { BellRingIcon, Building2Icon, ClipboardListIcon, GlobeIcon, HistoryIcon, KeyRoundIcon, MonitorSmartphoneIcon, ShieldCheckIcon, ShieldQuestionIcon, SmartphoneIcon, UsersIcon } from "lucide-react";
import { ForbiddenState, PageHeader } from "@/components/app/page-header";
import { ButtonLink } from "@/components/button-link";
import { Badge } from "@/components/ui/badge";
import { listStaff } from "@/features/settings/server";
import { can, requireClinicContext } from "@/server/auth/context";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("settings"))("title") };
}

export default async function SettingsPage() {
  const ctx = await requireClinicContext();
  const t = await getTranslations();
  if (
    !can(ctx, "org.settings.manage") &&
    !can(ctx, "org.staff.manage") &&
    !can(ctx, "questionnaire.manage") &&
    !can(ctx, "questionnaire.approve") &&
    !can(ctx, "audit.read") &&
    !ctx.canManageClinicComputer
  ) {
    return <ForbiddenState message={t("errors.forbiddenPage")} />;
  }
  const staff = can(ctx, "org.staff.manage") ? await listStaff(ctx) : [];
  const org = ctx.organization;
  const verified = org.verificationStatus === "verified";
  const rows: [string, string][] = [
    [t("settings.country"), org.countryCode],
    [t("settings.currency"), `${org.defaultCurrency} (${org.settings.currencyDisplay ?? org.defaultCurrency})`],
    [t("settings.timezone"), org.timezone],
  ];

  return (
    <>
      <PageHeader
        title={t("settings.title")}
        actions={
          <div className="flex flex-wrap gap-2">{can(ctx, "org.settings.manage") ? <><ButtonLink href="/settings/clinic" variant="outline"><Building2Icon />{t("clinicIdentity.title")}</ButtonLink><ButtonLink href="/settings/security" variant="outline"><SmartphoneIcon />{t("access.securityTitle")}</ButtonLink><ButtonLink href="/settings/agenda" variant="outline">{t("agendaSettings.title")}</ButtonLink><ButtonLink href="/settings/follow-ups" variant="outline"><BellRingIcon />{t("followUps.settings.link")}</ButtonLink><ButtonLink href="/settings/public-page" variant="outline"><GlobeIcon />{t("publicPage.title")}</ButtonLink></> : null}{can(ctx, "org.staff.manage") ? <ButtonLink href="/settings/team" variant="outline"><UsersIcon />{t("access.teamTitle")}</ButtonLink> : null}{ctx.canManageClinicComputer ? <ButtonLink href="/settings/clinic-computer" variant="outline"><MonitorSmartphoneIcon />{t("sync.settings.link")}</ButtonLink> : null}{can(ctx, "org.roles.manage") ? <ButtonLink href="/settings/roles" variant="outline"><KeyRoundIcon />{t("access.rolesTitle")}</ButtonLink> : null}{can(ctx, "questionnaire.manage") || can(ctx, "questionnaire.approve") ? <ButtonLink href="/settings/questionnaire" variant="outline"><ClipboardListIcon />{t("health.editor.shortTitle")}</ButtonLink> : null}{can(ctx, "audit.read") ? <ButtonLink href="/settings/activity" variant="outline"><HistoryIcon />{t("activity.title")}</ButtonLink> : null}</div>
        }
      />
      <div className="grid gap-4 lg:grid-cols-2">
        {can(ctx, "org.settings.manage") ? <section className="rounded-xl border bg-card p-5">
          <h2 className="mb-3 font-semibold">{t("settings.clinic")}</h2>
          <p className="mb-4 text-lg">{org.name}</p>
          <dl className="grid gap-3 text-sm">
            {rows.map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4">
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="font-medium">{v}</dd>
              </div>
            ))}
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">{t("settings.verification")}</dt>
              <dd>
                <Badge variant={verified ? "default" : "outline"}>
                  {verified ? <ShieldCheckIcon aria-hidden /> : <ShieldQuestionIcon aria-hidden />}
                  {t(`settings.verificationStatus.${org.verificationStatus as "unverified"}`)}
                </Badge>
              </dd>
            </div>
          </dl>
          {!verified ? <p className="mt-4 text-xs text-muted-foreground">{t("settings.verificationHint")}</p> : null}
        </section> : null}

        {can(ctx, "org.staff.manage") ? (
          <section className="rounded-xl border bg-card p-5">
            <h2 className="mb-3 font-semibold">{t("settings.staff")}</h2>
            <ul className="divide-y">
              {staff.map((m) => (
                <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                  <div className="min-w-0">
                    <p className="font-medium">{[m.title, m.displayName].filter(Boolean).join(" ")}</p>
                    <p className="truncate text-xs text-muted-foreground">{m.email}</p>
                  </div>
                  <div className="flex gap-1.5">
                    {m.isProvider ? <Badge variant="secondary">{t("settings.provider")}</Badge> : null}
                    <Badge variant="outline">{t.has(`roles.${m.roleKey}` as never) ? t(`roles.${m.roleKey}` as never) : m.roleName}</Badge>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </>
  );
}
