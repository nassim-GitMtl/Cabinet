import type { Metadata } from "next";
import { headers } from "next/headers";
import { getLocale, getTranslations } from "next-intl/server";
import { InboxIcon } from "lucide-react";
import { ForbiddenState, PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { LinkRow, NewLinkForm, RequestCard } from "@/features/booking/components/request-inbox";
import { listBookingLinks, listBookingRequests } from "@/features/booking/server";
import { INTL_LOCALE, isLocale } from "@/i18n/config";
import { formatDateTime } from "@/lib/dates";
import { formatPhone } from "@/lib/phone";
import { can, requireClinicContext } from "@/server/auth/context";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("booking"))("inboxTitle") };
}

function waitingLabel(since: Date, locale: string) {
  const minutes = Math.max(1, Math.round((Date.now() - since.getTime()) / 60_000));
  const [value, unit] = minutes < 60 ? [minutes, "minute"] : minutes < 48 * 60 ? [Math.round(minutes / 60), "hour"] : [Math.round(minutes / 1440), "day"];
  return new Intl.NumberFormat(locale, { style: "unit", unit, unitDisplay: "short" }).format(value);
}

export default async function BookingRequestsPage() {
  const ctx = await requireClinicContext();
  const t = await getTranslations();
  if (!can(ctx, "appointment.read")) return <ForbiddenState message={t("errors.forbiddenPage")} />;
  const raw = await getLocale();
  const locale = isLocale(raw) ? raw : "fr";
  const intl = INTL_LOCALE[locale];
  const [pending, decided, links] = await Promise.all([listBookingRequests(ctx, "pending"), listBookingRequests(ctx, "decided"), listBookingLinks(ctx)]);
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const origin = host ? `${h.get("x-forwarded-proto") ?? "http"}://${host}` : (process.env.APP_URL ?? "");
  const label = (n: { fr: string; en?: string; ar?: string }) => n[locale] || n.fr;
  const tz = ctx.organization.timezone;

  return (
    <>
      <PageHeader title={t("booking.inboxTitle")} description={t("booking.inboxHint")} />

      <section className="mb-6" aria-labelledby="pending-title">
        <h2 id="pending-title" className="mb-3 flex items-center gap-2 font-semibold">
          {t("booking.pending")} <Badge>{pending.length}</Badge>
        </h2>
        {pending.length === 0 ? (
          <div className="rounded-xl border border-dashed bg-card p-8 text-center text-sm text-muted-foreground">
            <InboxIcon className="mx-auto mb-2 size-8" aria-hidden />
            {t("booking.noPending")}
          </div>
        ) : (
          <ul className="space-y-3">
            {pending.map(({ r, typeName, providerName, providerTitle }) => (
              <RequestCard
                key={r.id}
                canApprove={can(ctx, "booking.approve") && can(ctx, "appointment.manage")}
                item={{
                  id: r.id,
                  contactName: r.contactName,
                  contactPhone: r.contactPhone,
                  phoneDisplay: formatPhone(r.contactPhone, ctx.organization.countryCode),
                  contactEmail: r.contactEmail,
                  declaresExistingPatient: r.declaresExistingPatient,
                  typeName: label(typeName),
                  providerName: [providerTitle, providerName].filter(Boolean).join(" "),
                  when: formatDateTime(r.requestedStartsAt, tz, intl),
                  waiting: waitingLabel(r.createdAt, intl),
                  message: r.message,
                  channel: r.acquisitionChannel ? t(`acquisition.channels.${r.acquisitionChannel}`) : null,
                }}
              />
            ))}
          </ul>
        )}
      </section>

      {decided.length ? (
        <section className="mb-6 overflow-hidden rounded-xl border bg-card" aria-labelledby="decided-title">
          <h2 id="decided-title" className="border-b px-4 py-3 text-sm font-semibold">{t("booking.decided")}</h2>
          <ul className="divide-y text-sm">
            {decided.slice(0, 20).map(({ r, typeName, patientFirstName, patientLastName }) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                <span>
                  <bdi>{patientLastName ? `${patientLastName} ${patientFirstName}` : r.contactName}</bdi> · {label(typeName)} · {formatDateTime(r.requestedStartsAt, tz, intl)}
                </span>
                <Badge variant={r.status === "approved" ? "default" : "outline"}>{t(`booking.requestStatus.${r.status as "approved"}`)}</Badge>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="rounded-xl border bg-card p-4" aria-labelledby="links-title">
        <h2 id="links-title" className="font-semibold">{t("booking.links")}</h2>
        <p className="mb-3 text-sm text-muted-foreground">{t("booking.linksHint")}</p>
        {links.length ? (
          <ul className="mb-3 divide-y">
            {links.map((l) => (
              <LinkRow key={l.id} id={l.id} url={`${origin}/book/${l.token}`} label={l.label} active={l.isActive} />
            ))}
          </ul>
        ) : null}
        {can(ctx, "appointment.manage") ? <NewLinkForm /> : null}
      </section>
    </>
  );
}
