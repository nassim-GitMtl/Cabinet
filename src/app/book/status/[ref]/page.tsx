import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { CalendarCheck2Icon, CalendarXIcon, HourglassIcon } from "lucide-react";
import { getRequestStatus } from "@/features/booking/server";
import { INTL_LOCALE, isLocale } from "@/i18n/config";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("booking"))("statusTitle"), robots: { index: false } };
}

/** Patient-facing status of one request, reachable only with its secret link. */
export default async function BookingStatusPage({ params }: PageProps<"/book/status/[ref]">) {
  const { ref } = await params;
  const status = await getRequestStatus(ref);
  if (!status) notFound();
  const t = await getTranslations("booking");
  const raw = await getLocale();
  const locale = isLocale(raw) ? raw : "fr";
  const when = new Intl.DateTimeFormat(INTL_LOCALE[locale], { dateStyle: "full", timeStyle: "short", hourCycle: "h23", timeZone: status.timezone }).format(status.startsAt);
  const typeName = status.typeName[locale] || status.typeName.fr;
  const pending = status.status === "submitted" || status.status === "under_review";
  const Icon = status.status === "approved" ? CalendarCheck2Icon : pending ? HourglassIcon : CalendarXIcon;
  const key = (["approved", "declined", "expired", "withdrawn"] as const).find((s) => s === status.status) ?? "pending";

  return (
    <div className="space-y-4 pt-4">
      <div className="rounded-xl border bg-card p-6 text-center">
        <Icon className="mx-auto mb-3 size-10 text-primary" aria-hidden />
        <h1 className="text-xl font-semibold">{t(`status.${key}.title`)}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t(`status.${key}.body`)}</p>
        <dl className="mt-5 space-y-1 text-sm">
          <div><dt className="sr-only">{t("clinic")}</dt><dd className="font-medium"><bdi>{status.clinicName}</bdi></dd></div>
          <div><dt className="sr-only">{t("stepType")}</dt><dd>{typeName}</dd></div>
          <div><dt className="sr-only">{t("when")}</dt><dd>{when}</dd></div>
        </dl>
        {status.status === "declined" && status.declineReason ? (
          <p className="mt-4 rounded-lg bg-muted p-3 text-sm">{status.declineReason}</p>
        ) : null}
      </div>
      <p className="text-center text-xs text-muted-foreground">{t("keepLink")}</p>
    </div>
  );
}
