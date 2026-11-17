import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { CalendarDaysIcon, ChevronLeftIcon, ChevronRightIcon, InboxIcon } from "lucide-react";
import { PageHeader, ForbiddenState } from "@/components/app/page-header";
import { ButtonLink } from "@/components/button-link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AppointmentCard, EmptyAgenda, NewAppointmentButton, type AppointmentViewItem } from "@/features/agenda/components/agenda-ui";
import { getAgendaSetup, listAppointments } from "@/features/agenda/server";
import { countPendingRequests } from "@/features/booking/server";
import { addDays, parseDateOnly, timeInZone, todayInZone, zonedToUtc } from "@/lib/dates";
import { can, requireClinicContext } from "@/server/auth/context";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("agenda"))("title") };
}

export default async function AgendaPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireClinicContext();
  const t = await getTranslations("agenda");
  if (!can(ctx, "appointment.read")) return <ForbiddenState message={(await getTranslations("errors"))("forbiddenPage")} />;
  const sp = await searchParams;
  const rawDate = typeof sp.date === "string" ? sp.date : "";
  const date = parseDateOnly(rawDate) ?? todayInZone(ctx.organization.timezone);
  const from = zonedToUtc(date, "00:00", ctx.organization.timezone);
  const to = zonedToUtc(addDays(date, 1), "00:00", ctx.organization.timezone);
  const [setup, rows, locale, pendingRequests] = await Promise.all([getAgendaSetup(ctx), listAppointments(ctx, from, to), getLocale(), countPendingRequests(ctx)]);
  const tb = await getTranslations("booking");
  const language = locale === "ar" || locale === "en" ? locale : "fr";
  const items: AppointmentViewItem[] = rows.map((item) => ({
    ...item,
    patientName: `${item.firstName} ${item.lastName}`,
    providerTitle: item.providerTitle,
    chairName: item.chairName,
    typeName: item.typeName?.[language] ?? item.typeName?.fr ?? null,
    startTime: timeInZone(item.startsAt, ctx.organization.timezone),
    endTime: timeInZone(item.endsAt, ctx.organization.timezone),
    date: todayInZone(ctx.organization.timezone, item.startsAt),
    durationMin: Math.round((item.endsAt.getTime() - item.startsAt.getTime()) / 60_000),
  }));
  const setupView = {
    providers: setup.providers.map((provider) => ({ value: provider.id, label: [provider.title, provider.displayName].filter(Boolean).join(" ") })),
    chairs: setup.chairs.map((chair) => ({ value: chair.id, label: chair.name })),
    types: setup.types.map((type) => ({ value: type.id, label: type.name[language] ?? type.name.fr, durationMin: type.defaultDurationMin })),
  };
  const displayDate = new Intl.DateTimeFormat(language === "ar" ? "ar-DZ" : language === "en" ? "en-GB" : "fr-DZ", {
    weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00Z`));

  return (
    <>
      <PageHeader
        title={t("title")}
        description={displayDate}
        actions={
          <>
            <ButtonLink href="/agenda/requests" variant="outline">
              <InboxIcon aria-hidden />
              {tb("requests")}
              {pendingRequests ? <span className="rounded-full bg-primary px-1.5 text-xs text-primary-foreground tabular">{pendingRequests}</span> : null}
            </ButtonLink>
            {can(ctx, "appointment.manage") ? <NewAppointmentButton setup={setupView} date={date} /> : null}
          </>
        }
      />
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-3 no-print">
        <div className="flex items-center gap-2">
          <ButtonLink href={`/agenda?date=${addDays(date, -1)}`} variant="outline" size="icon" aria-label={t("previousDay")}>
            <ChevronLeftIcon className="rtl:rotate-180" aria-hidden />
          </ButtonLink>
          <ButtonLink href={`/agenda?date=${todayInZone(ctx.organization.timezone)}`} variant="outline">{t("today")}</ButtonLink>
          <ButtonLink href={`/agenda?date=${addDays(date, 1)}`} variant="outline" size="icon" aria-label={t("nextDay")}>
            <ChevronRightIcon className="rtl:rotate-180" aria-hidden />
          </ButtonLink>
        </div>
        <form className="flex items-center gap-2" action="/agenda">
          <Input type="date" name="date" defaultValue={date} aria-label={t("date")} className="w-auto" />
          <Button type="submit" variant="outline"><CalendarDaysIcon aria-hidden />{t("go")}</Button>
        </form>
      </div>

      {setup.providers.length ? (
        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {setup.providers.map((provider) => {
            const providerItems = items.filter((item) => item.providerId === provider.id);
            return (
              <section key={provider.id} className="min-w-0 rounded-xl border bg-muted/20 p-3" aria-labelledby={`provider-${provider.id}`}>
                <h2 id={`provider-${provider.id}`} className="mb-3 flex items-center justify-between gap-2 font-semibold">
                  <bdi>{[provider.title, provider.displayName].filter(Boolean).join(" ")}</bdi>
                  <span className="rounded-full bg-background px-2 py-0.5 text-xs text-muted-foreground">{providerItems.length}</span>
                </h2>
                {providerItems.length ? (
                  <div className="space-y-2">{providerItems.map((item) => <AppointmentCard key={item.id} item={item} canManage={can(ctx, "appointment.manage")} setup={setupView} />)}</div>
                ) : <EmptyAgenda />}
              </section>
            );
          })}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed p-8 text-center text-muted-foreground">{t("noProviders")}</div>
      )}
    </>
  );
}
