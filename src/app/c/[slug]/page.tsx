import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { CalendarCheckIcon, ClockIcon, MapPinIcon, MessageCircleIcon, NavigationIcon, PhoneIcon, StethoscopeIcon } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { WEEK_ORDER } from "@/features/public-page/helpers";
import { getPublicClinicPage } from "@/features/public-page/server";
import { telUrl, whatsappUrl } from "@/features/follow-ups/messages";
import { formatMoney } from "@/lib/money";
import { formatPhone } from "@/lib/phone";
import { cn } from "@/lib/utils";

type About = { fr?: string; en?: string; ar?: string };
const pick = (text: About, locale: string) => (text as Record<string, string | undefined>)[locale] || text.fr || text.en || text.ar || "";

export async function generateMetadata(props: PageProps<"/c/[slug]">): Promise<Metadata> {
  const { slug } = await props.params;
  const [page, locale, t] = await Promise.all([getPublicClinicPage(slug), getLocale(), getTranslations("publicPage.public")]);
  if (!page) return { title: t("notFound") };
  const description = pick(page.about, locale) || t("defaultDescription", { name: page.name });
  return { title: page.name, description, openGraph: { title: page.name, description, type: "website" } };
}

function Card({ title, icon: Icon, children }: { title: string; icon: typeof ClockIcon; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border bg-card p-4 shadow-sm sm:p-5">
      <h2 className="mb-3 flex items-center gap-2 font-semibold"><Icon className="size-4 text-primary" aria-hidden />{title}</h2>
      {children}
    </section>
  );
}

export default async function ClinicPublicPage(props: PageProps<"/c/[slug]">) {
  const { slug } = await props.params;
  const [page, locale, t] = await Promise.all([getPublicClinicPage(slug), getLocale(), getTranslations("publicPage.public")]);
  if (!page) notFound();
  const intl = locale === "ar" ? "ar-DZ-u-nu-latn" : locale === "en" ? "en-GB" : "fr-FR";
  const weekday = (iso: number) => new Intl.DateTimeFormat(intl, { weekday: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2024, 0, iso)));
  const about = pick(page.about, locale);
  const name = (n: { fr: string; en?: string; ar?: string }) => (n as Record<string, string | undefined>)[locale] || n.fr;
  const hasHours = WEEK_ORDER.some((d) => page.hours[d]!.length);

  return (
    <div className="grid gap-4">
      <section className="rounded-2xl border bg-card p-5 shadow-sm sm:p-6">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl"><bdi>{page.name}</bdi></h1>
        {page.branches[0]?.address ? <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground"><MapPinIcon className="size-4" aria-hidden /><bdi>{page.branches[0].address}</bdi></p> : null}
        {about ? <p className="mt-4 whitespace-pre-line text-sm leading-relaxed" dir="auto">{about}</p> : null}
        <div className="mt-5 grid gap-2 sm:grid-cols-2">
          {page.bookingToken ? (
            <a href={`/book/${page.bookingToken}`} className={cn(buttonVariants({ size: "lg" }), "sm:col-span-2")}>
              <CalendarCheckIcon aria-hidden />{t("book")}
            </a>
          ) : null}
          {page.phone ? <a href={telUrl(page.phone)} className={buttonVariants({ variant: "outline", size: "lg" })}><PhoneIcon aria-hidden /><span dir="ltr">{formatPhone(page.phone)}</span></a> : null}
          {page.whatsappPhone ? (
            <a href={whatsappUrl(page.whatsappPhone, t("whatsappText", { name: page.name }))} target="_blank" rel="noreferrer"
              className={cn(buttonVariants({ size: "lg" }), "bg-[#1f8f4e] text-white hover:bg-[#1a7a42]")}>
              <MessageCircleIcon aria-hidden />{t("whatsapp")}
            </a>
          ) : null}
          {page.mapUrl ? <a href={page.mapUrl} target="_blank" rel="noreferrer" className={cn(buttonVariants({ variant: "outline", size: "lg" }), "sm:col-span-2")}><NavigationIcon aria-hidden />{t("directions")}</a> : null}
        </div>
        {page.bookingToken ? <p className="mt-3 text-xs text-muted-foreground">{t("bookingNote")}</p> : null}
      </section>

      {hasHours ? (
        <Card title={t("hours")} icon={ClockIcon}>
          <dl className="divide-y text-sm">
            {WEEK_ORDER.map((d) => (
              <div key={d} className="flex justify-between gap-4 py-1.5">
                <dt className="capitalize">{weekday(d)}</dt>
                <dd className={cn("tabular-nums", !page.hours[d]!.length && "text-muted-foreground")} dir="ltr">
                  {page.hours[d]!.length ? page.hours[d]!.map((r) => `${r.start}–${r.end}`).join(" · ") : t("closed")}
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-2 text-xs text-muted-foreground">{t("hoursNote")}</p>
        </Card>
      ) : null}

      {page.services.length ? (
        <Card title={t("services")} icon={StethoscopeIcon}>
          <ul className="divide-y text-sm">
            {page.services.map((s) => (
              <li key={s.id} className="flex justify-between gap-4 py-2">
                <bdi>{name(s.name)}</bdi>
                {s.priceMinor !== null ? (
                  <span className="shrink-0 text-muted-foreground tabular-nums">
                    {t("from", { price: formatMoney(s.priceMinor, page.currency, locale === "ar" ? "ar-DZ-u-nu-latn" : "fr-DZ", page.currencyDisplay ?? undefined) })}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
          {page.services.some((s) => s.priceMinor !== null) ? <p className="mt-2 text-xs text-muted-foreground">{t("pricesNote")}</p> : null}
        </Card>
      ) : null}

      {page.branches.length > 1 ? (
        <Card title={t("addresses")} icon={MapPinIcon}>
          <ul className="grid gap-3 text-sm">
            {page.branches.map((b, i) => (
              <li key={i}>
                <p className="font-medium"><bdi>{b.name}</bdi></p>
                {b.address ? <p className="text-muted-foreground"><bdi>{b.address}</bdi></p> : null}
                {b.phone ? <a href={telUrl(b.phone)} className="text-primary underline-offset-4 hover:underline" dir="ltr">{formatPhone(b.phone)}</a> : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {page.facebookUrl || page.instagramUrl ? (
        <div className="flex flex-wrap justify-center gap-2">
          {page.facebookUrl ? <a href={page.facebookUrl} target="_blank" rel="noreferrer" className={buttonVariants({ variant: "ghost", size: "sm" })}>Facebook</a> : null}
          {page.instagramUrl ? <a href={page.instagramUrl} target="_blank" rel="noreferrer" className={buttonVariants({ variant: "ghost", size: "sm" })}>Instagram</a> : null}
        </div>
      ) : null}
    </div>
  );
}
