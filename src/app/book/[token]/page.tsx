import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { CalendarCheckIcon, ClockIcon, StethoscopeIcon } from "lucide-react";
import { BookingContactForm } from "@/features/booking/components/booking-contact-form";
import { getPublicAvailability, getPublicBookingInfo } from "@/features/booking/server";
import { INTL_LOCALE, isLocale } from "@/i18n/config";
import { parseDateOnly } from "@/lib/dates";
import { cn } from "@/lib/utils";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("booking"))("title"), robots: { index: false } };
}

const chip = "inline-flex min-h-11 items-center justify-center rounded-lg border bg-card px-3 text-sm font-medium transition-colors hover:border-primary hover:bg-accent";

export default async function PublicBookingPage({ params, searchParams }: PageProps<"/book/[token]">) {
  const { token } = await params;
  const sp = await searchParams;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const info = await getPublicBookingInfo(token);
  if (!info) notFound();
  const t = await getTranslations("booking");
  const raw = await getLocale();
  const locale = isLocale(raw) ? raw : "fr";
  const intl = INTL_LOCALE[locale];
  const label = (n: { fr: string; en?: string; ar?: string }) => n[locale] || n.fr;

  const type = info.types.find((x) => x.id === str(sp.type));
  const avail = type ? await getPublicAvailability(token, type.id, parseDateOnly(str(sp.date))) : null;
  const time = str(sp.time);
  const provider = info.providers.find((p) => p.id === str(sp.provider));
  const chosen = type && avail?.selected && provider && avail.slots.find((s) => s.providerId === provider.id)?.times.includes(time);
  const base = `/book/${token}`;
  const dayLabel = (d: string) =>
    new Intl.DateTimeFormat(intl, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${d}T12:00:00Z`));
  const longDay = (d: string) =>
    new Intl.DateTimeFormat(intl, { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${d}T12:00:00Z`));

  return (
    <div className="space-y-6">
      <header className="pt-2">
        <p className="text-sm text-muted-foreground">{t("title")}</p>
        <h1 className="text-2xl font-semibold tracking-tight"><bdi>{info.clinicName}</bdi></h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("intro")}</p>
      </header>

      <section aria-labelledby="step-type" className="rounded-xl border bg-card p-4">
        <h2 id="step-type" className="mb-3 flex items-center gap-2 font-semibold">
          <StethoscopeIcon className="size-4 text-primary" aria-hidden />
          {t("stepType")}
        </h2>
        {info.types.length === 0 ? <p className="text-sm text-muted-foreground">{t("noTypes")}</p> : null}
        <div className="flex flex-wrap gap-2">
          {info.types.map((x) => (
            <Link key={x.id} href={`${base}?type=${x.id}`} aria-current={type?.id === x.id ? "true" : undefined} className={cn(chip, type?.id === x.id && "border-primary bg-primary text-primary-foreground hover:bg-primary")}>
              {label(x.name)} · {t("minutes", { n: x.durationMin })}
            </Link>
          ))}
        </div>
      </section>

      {type && avail ? (
        <section aria-labelledby="step-day" className="rounded-xl border bg-card p-4">
          <h2 id="step-day" className="mb-3 flex items-center gap-2 font-semibold">
            <CalendarCheckIcon className="size-4 text-primary" aria-hidden />
            {t("stepDay")}
          </h2>
          {avail.days.length === 0 ? <p className="text-sm text-muted-foreground">{t("noAvailability")}</p> : null}
          <div className="flex gap-2 overflow-x-auto pb-1">
            {avail.days.map((d) => (
              <Link key={d} href={`${base}?type=${type.id}&date=${d}`} className={cn(chip, "shrink-0", avail.selected === d && "border-primary bg-primary text-primary-foreground hover:bg-primary")}>
                {dayLabel(d)}
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {type && avail?.selected ? (
        <section aria-labelledby="step-time" className="rounded-xl border bg-card p-4">
          <h2 id="step-time" className="mb-3 flex items-center gap-2 font-semibold">
            <ClockIcon className="size-4 text-primary" aria-hidden />
            {t("stepTime", { date: longDay(avail.selected) })}
          </h2>
          <div className="space-y-4">
            {avail.slots.map((s) => {
              const p = info.providers.find((x) => x.id === s.providerId);
              return (
                <div key={s.providerId}>
                  {info.providers.length > 1 ? <p className="mb-2 text-sm font-medium"><bdi>{p?.name}</bdi></p> : null}
                  <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
                    {s.times.map((tm) => (
                      <Link
                        key={tm}
                        href={`${base}?type=${type.id}&date=${avail.selected}&time=${tm}&provider=${s.providerId}`}
                        className={cn(chip, "tabular", time === tm && provider?.id === s.providerId && "border-primary bg-primary text-primary-foreground hover:bg-primary")}
                        dir="ltr"
                      >
                        {tm}
                      </Link>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {chosen ? (
        <section aria-labelledby="step-contact" className="rounded-xl border-2 border-primary/40 bg-card p-4">
          <h2 id="step-contact" className="mb-1 font-semibold">{t("stepContact")}</h2>
          <p className="mb-4 text-sm text-muted-foreground">
            {label(type!.name)} · {longDay(avail!.selected!)} · <span dir="ltr">{time}</span> · <bdi>{provider!.name}</bdi>
          </p>
          <BookingContactForm token={token} slot={{ typeId: type!.id, providerId: provider!.id, date: avail!.selected!, time }} />
        </section>
      ) : null}

      <p className="text-center text-xs text-muted-foreground">{t("privacyNote")}</p>
    </div>
  );
}
