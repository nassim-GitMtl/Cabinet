import type { Metadata } from "next";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { CalendarDaysIcon, ChevronLeftIcon, ChevronRightIcon, InboxIcon, Settings2Icon } from "lucide-react";
import { PageHeader, ForbiddenState } from "@/components/app/page-header";
import { ButtonLink } from "@/components/button-link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AppointmentCard, EmptyAgenda, NewAppointmentButton, type AppointmentViewItem } from "@/features/agenda/components/agenda-ui";
import { getAgendaSetup, getBookingPatient, listAppointments } from "@/features/agenda/server";
import { countPendingRequests } from "@/features/booking/server";
import { addDays, isoWeekday, parseDateOnly, timeInZone, todayInZone, zonedToUtc } from "@/lib/dates";
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
  const view = sp.view === "week" ? "week" : "day";
  // Weeks start on Sunday (Algerian working week Sun–Thu).
  const weekStart = addDays(date, -(isoWeekday(date) % 7));
  const days = view === "week" ? Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)) : [date];
  const from = zonedToUtc(days[0]!, "00:00", ctx.organization.timezone);
  const to = zonedToUtc(addDays(days[days.length - 1]!, 1), "00:00", ctx.organization.timezone);
  const step = view === "week" ? 7 : 1;
  const href = (d: string) => `/agenda?date=${d}${view === "week" ? "&view=week" : ""}`;
  const bookFor = typeof sp.patient === "string" && can(ctx, "appointment.manage") ? sp.patient : null;
  const [setup, rows, locale, pendingRequests, bookingPatient] = await Promise.all([
    getAgendaSetup(ctx), listAppointments(ctx, from, to), getLocale(), countPendingRequests(ctx), bookFor ? getBookingPatient(ctx, bookFor) : null,
  ]);
  const tb = await getTranslations("booking");
  const ts = await getTranslations("agendaSettings");
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
  const intl = language === "ar" ? "ar-DZ" : language === "en" ? "en-GB" : "fr-DZ";
  const fmtDay = (d: string, opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(intl, { ...opts, timeZone: "UTC" }).format(new Date(`${d}T12:00:00Z`));
  const displayDate =
    view === "week"
      ? `${fmtDay(days[0]!, { day: "numeric", month: "short" })} – ${fmtDay(days[6]!, { day: "numeric", month: "short", year: "numeric" })}`
      : fmtDay(date, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const today = todayInZone(ctx.organization.timezone);

  return (
    <>
      <PageHeader
        title={t("title")}
        description={displayDate}
        actions={
          <>
            <ButtonLink href="/settings/agenda" variant="ghost" size="icon" aria-label={ts("title")}>
              <Settings2Icon aria-hidden />
            </ButtonLink>
            <ButtonLink href="/agenda/requests" variant="outline">
              <InboxIcon aria-hidden />
              {tb("requests")}
              {pendingRequests ? <span className="rounded-full bg-primary px-1.5 text-xs text-primary-foreground tabular">{pendingRequests}</span> : null}
            </ButtonLink>
            {can(ctx, "appointment.manage") ? <NewAppointmentButton key={bookingPatient?.id ?? "new"} setup={setupView} date={date} patient={bookingPatient} /> : null}
          </>
        }
      />
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-3 no-print">
        <div className="flex items-center gap-2">
          <ButtonLink href={href(addDays(date, -step))} variant="outline" size="icon" aria-label={t(view === "week" ? "previousWeek" : "previousDay")}>
            <ChevronLeftIcon className="rtl:rotate-180" aria-hidden />
          </ButtonLink>
          <ButtonLink href={href(today)} variant="outline">{t("today")}</ButtonLink>
          <ButtonLink href={href(addDays(date, step))} variant="outline" size="icon" aria-label={t(view === "week" ? "nextWeek" : "nextDay")}>
            <ChevronRightIcon className="rtl:rotate-180" aria-hidden />
          </ButtonLink>
          <nav className="ms-1 inline-flex rounded-lg border p-0.5 text-sm" aria-label={t("viewLabel")}>
            {(["day", "week"] as const).map((v) => (
              <Link
                key={v}
                href={`/agenda?date=${date}${v === "week" ? "&view=week" : ""}`}
                aria-current={view === v ? "page" : undefined}
                className={view === v ? "rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground" : "rounded-md px-3 py-1.5 font-medium text-muted-foreground"}
              >
                {t(v === "day" ? "dayView" : "weekView")}
              </Link>
            ))}
          </nav>
        </div>
        <form className="flex items-center gap-2" action="/agenda">
          {view === "week" ? <input type="hidden" name="view" value="week" /> : null}
          <Input type="date" name="date" defaultValue={date} aria-label={t("date")} className="w-auto" />
          <Button type="submit" variant="outline"><CalendarDaysIcon aria-hidden />{t("go")}</Button>
        </form>
      </div>

      {view === "week" ? (
        <div className="grid gap-3 md:grid-cols-7">
          {days.map((d) => {
            const dayItems = items.filter((item) => item.date === d);
            return (
              <section key={d} className={d === today ? "min-w-0 rounded-xl border border-primary/50 bg-accent/30 p-2" : "min-w-0 rounded-xl border bg-muted/20 p-2"} aria-label={fmtDay(d, { weekday: "long", day: "numeric", month: "long" })}>
                <Link href={`/agenda?date=${d}`} className="mb-2 flex items-baseline justify-between gap-1 px-1 hover:underline">
                  <span className="text-sm font-semibold capitalize">{fmtDay(d, { weekday: "short", day: "numeric" })}</span>
                  <span className="text-xs text-muted-foreground tabular">{dayItems.length}</span>
                </Link>
                <ul className="space-y-1.5">
                  {dayItems.map((item) => (
                    <li key={item.id}>
                      <Link href={`/agenda?date=${d}`} className="block rounded-lg border bg-card px-2 py-1.5 text-xs hover:border-primary/40">
                        <span className="block font-semibold tabular" dir="ltr">{item.startTime}</span>
                        <span className="block truncate"><bdi>{item.patientName}</bdi></span>
                        {setup.providers.length > 1 ? <span className="block truncate text-muted-foreground"><bdi>{item.providerName}</bdi></span> : null}
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      ) : setup.providers.length ? (
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
