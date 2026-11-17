import type { Metadata } from "next";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { ArrowLeftIcon } from "lucide-react";
import { ForbiddenState, PageHeader } from "@/components/app/page-header";
import { ChairsCard, HoursCard, TimeOffCard, TypesCard } from "@/features/agenda/components/agenda-settings";
import { getAgendaSettings } from "@/features/agenda/settings";
import { INTL_LOCALE, isLocale } from "@/i18n/config";
import { addDays, formatDateTime, todayInZone } from "@/lib/dates";
import { can, requireClinicContext } from "@/server/auth/context";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("agendaSettings"))("title") };
}

export default async function AgendaSettingsPage() {
  const ctx = await requireClinicContext();
  const t = await getTranslations();
  if (!can(ctx, "appointment.read")) return <ForbiddenState message={t("errors.forbiddenPage")} />;
  const raw = await getLocale();
  const locale = isLocale(raw) ? raw : "fr";
  const intl = INTL_LOCALE[locale];
  const s = await getAgendaSettings(ctx);
  const tz = ctx.organization.timezone;
  // 2026-11-16 is a Monday: ISO weekday n is that date + (n - 1) days.
  const weekdayNames = Object.fromEntries(
    [1, 2, 3, 4, 5, 6, 7].map((wd) => [wd, new Intl.DateTimeFormat(intl, { weekday: "long", timeZone: "UTC" }).format(new Date(`${addDays("2026-11-16", wd - 1)}T12:00:00Z`))]),
  );
  const providerName = (p: { title: string | null; displayName: string }) => [p.title, p.displayName].filter(Boolean).join(" ");
  const manageSettings = can(ctx, "org.settings.manage");

  return (
    <>
      <Link href="/agenda" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeftIcon className="size-4 rtl:rotate-180" aria-hidden />
        {t("agenda.title")}
      </Link>
      <PageHeader title={t("agendaSettings.title")} description={t("agendaSettings.subtitle")} />
      <div className="grid gap-4 lg:grid-cols-2">
        <ChairsCard chairs={s.chairs} canManage={manageSettings} />
        <TypesCard types={s.types} canManage={manageSettings} locale={locale} />
      </div>
      <h2 className="mt-6 mb-3 text-lg font-semibold">{t("agendaSettings.hours")}</h2>
      <div className="grid gap-4 xl:grid-cols-2">
        {s.providers.map((p) => (
          <HoursCard
            key={p.id}
            provider={{ id: p.id, name: providerName(p) }}
            hours={s.hours.filter((h) => h.providerId === p.id)}
            weekdayNames={weekdayNames}
            canManage={manageSettings}
          />
        ))}
      </div>
      <div className="mt-6">
        <TimeOffCard
          canManage={can(ctx, "appointment.manage")}
          today={todayInZone(tz)}
          providers={s.providers.map((p) => ({ value: p.id, label: providerName(p) }))}
          items={s.timeOff.map(({ t: o, providerName: n, providerTitle }) => ({
            id: o.id,
            kind: o.kind,
            who: n ? [providerTitle, n].filter(Boolean).join(" ") : t("agendaSettings.wholeClinic"),
            label: `${formatDateTime(o.startsAt, tz, intl)} → ${formatDateTime(o.endsAt, tz, intl)}`,
            reason: o.reason,
          }))}
        />
      </div>
    </>
  );
}
