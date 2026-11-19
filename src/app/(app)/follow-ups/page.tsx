import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { getLocale, getTranslations } from "next-intl/server";
import { ChevronLeftIcon, ChevronRightIcon, SettingsIcon } from "lucide-react";
import { ButtonLink } from "@/components/button-link";
import { ForbiddenState, PageHeader } from "@/components/app/page-header";
import { composeMessage, resolveTemplates } from "@/features/follow-ups/compose";
import { FollowUpCard, type FollowUpItem } from "@/features/follow-ups/components/follow-up-card";
import { asMessageLocale, messageDate, type FollowUpReason } from "@/features/follow-ups/messages";
import { getFollowUps, getMessageContext, suggestReminderDate, type FollowUpPatient, type LastContact } from "@/features/follow-ups/server";
import { addDays, formatDateOnly, parseDateOnly, todayInZone } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { formatPhone } from "@/lib/phone";
import { cn } from "@/lib/utils";
import { can, requireClinicContext } from "@/server/auth/context";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("followUps"))("title") };
}

const TABS = ["reminders", "recall", "treatments", "estimates", "noShows"] as const;
type Tab = (typeof TABS)[number];
const REASON: Record<Tab, FollowUpReason> = {
  reminders: "appointment_reminder", recall: "recall", treatments: "treatment_followup", estimates: "estimate_followup", noShows: "no_show",
};
const SNOOZE: Record<Exclude<Tab, "reminders">, number> = { recall: 30, treatments: 14, estimates: 14, noShows: 14 };

export default async function FollowUpsPage(props: PageProps<"/follow-ups">) {
  const ctx = await requireClinicContext();
  const t = await getTranslations("followUps");
  if (!can(ctx, "patient.followup")) return <ForbiddenState message={(await getTranslations("errors"))("forbiddenPage")} />;
  const sp = await props.searchParams;
  const tab: Tab = TABS.find((x) => x === sp.tab) ?? "reminders";
  const today = todayInZone(ctx.organization.timezone);
  const date = (typeof sp.date === "string" && parseDateOnly(sp.date)) || (await suggestReminderDate(ctx, today));
  const [data, messageContext, uiLocale, h] = await Promise.all([getFollowUps(ctx, { today, reminderDate: date }), getMessageContext(ctx), getLocale(), headers()]);

  const host = h.get("x-forwarded-host") ?? h.get("host");
  const origin = host ? `${h.get("x-forwarded-proto") ?? "http"}://${host}` : (process.env.APP_URL ?? "");
  const composeContext = { ...messageContext, recallMonths: data.recallMonths, bookingUrl: messageContext.bookingToken ? `${origin}/book/${messageContext.bookingToken}` : null };
  const templates = resolveTemplates(ctx);
  const canConfirm = can(ctx, "appointment.manage");
  const money = (minor: number, currency: string) => formatMoney(minor, currency, uiLocale === "ar" ? "ar-DZ-u-nu-latn" : "fr-DZ", ctx.organization.settings.currencyDisplay);

  const lastContactText = (c: LastContact) =>
    c ? t("lastContact", { channel: t(`channels.${c.channel}`), outcome: t(`outcomes.${c.outcome}`), at: `${formatDateOnly(c.at.slice(0, 10))} ${c.at.slice(11)}`, by: c.by }) : null;
  const base = (reason: FollowUpReason, row: FollowUpPatient & { branchId?: string; date?: string; time?: string; provider?: string }, key: string) => ({
    key,
    reason,
    patientId: row.patientId,
    patientNumber: row.patientNumber,
    name: `${row.lastName.toUpperCase()} ${row.firstName}`,
    phone: row.phone,
    phoneDisplay: row.phone ? formatPhone(row.phone) : null,
    contactAllowed: row.contactAllowed,
    message: composeMessage(templates, reason, row, composeContext),
    lastContact: lastContactText(row.lastContact),
    appointmentId: null,
    planId: null,
    confirmation: null,
  });

  const items: FollowUpItem[] =
    tab === "reminders"
      ? data.reminders.map((r) => ({
          ...base(REASON.reminders, r, r.appointmentId), appointmentId: r.appointmentId,
          details: [r.time, t("withProvider", { name: r.provider })],
          confirmation: { status: r.confirmation, label: t(`confirmation.${r.confirmation as "pending"}`), canConfirm },
        }))
      : tab === "recall"
        ? data.recall.map((r) => ({ ...base(REASON.recall, r, r.patientId), details: [t("lastVisit", { date: formatDateOnly(r.lastVisit) })] }))
        : tab === "noShows"
          ? data.noShows.map((r) => ({
              ...base(REASON.noShows, r, r.appointmentId), appointmentId: r.appointmentId,
              details: [`${formatDateOnly(r.date)} ${r.time}`, t("withProvider", { name: r.provider })],
            }))
          : (tab === "treatments" ? data.treatments : data.estimates).map((r) => ({
              ...base(REASON[tab], r, r.planId), planId: r.planId,
              details: [
                ...(r.title ? [r.title] : []),
                ...(tab === "treatments" ? [t("remaining", { count: r.remaining })] : r.totalMinor !== null ? [money(r.totalMinor, r.currency)] : []),
                t("since", { date: formatDateOnly(r.since) }),
              ],
            }));

  const counts: Record<Tab, number> = {
    reminders: data.reminders.filter((r) => r.confirmation === "pending").length,
    recall: data.recall.length, treatments: data.treatments.length, estimates: data.estimates.length, noShows: data.noShows.length,
  };
  const dayLabel = messageDate(date, asMessageLocale(uiLocale));
  const href = (x: Tab, d = date) => `/follow-ups?tab=${x}${x === "reminders" ? `&date=${d}` : ""}`;
  const canSettings = can(ctx, "org.settings.manage");

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("subtitle")}
        actions={canSettings ? <ButtonLink href="/settings/follow-ups" variant="outline"><SettingsIcon aria-hidden />{t("settings.link")}</ButtonLink> : undefined}
      />

      {!messageContext.defaultPhone ? (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-300/60 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          <span>{t("noClinicPhone")}</span>
          {canSettings ? <ButtonLink href="/settings/follow-ups" size="sm" variant="outline">{t("addClinicPhone")}</ButtonLink> : null}
        </div>
      ) : null}

      <nav aria-label={t("title")} className="mb-4 flex gap-1 overflow-x-auto rounded-lg border bg-card p-1 text-sm">
        {TABS.map((x) => (
          <Link key={x} href={href(x)} aria-current={tab === x ? "page" : undefined}
            className={cn("flex shrink-0 items-center gap-2 rounded-md px-3 py-2 font-medium", tab === x ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
            {t(`tabs.${x}`)}
            {counts[x] ? <span className={cn("rounded-full px-1.5 text-xs tabular-nums", tab === x ? "bg-primary-foreground/20" : "bg-muted")}>{counts[x]}</span> : null}
          </Link>
        ))}
      </nav>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {tab === "reminders" ? t("hints.reminders", { date: dayLabel }) : tab === "recall" ? t("hints.recall", { months: data.recallMonths }) : t(`hints.${tab}`)}
        </p>
        {tab === "reminders" ? (
          <div className="flex items-center gap-1">
            <ButtonLink href={href("reminders", addDays(date, -1))} variant="outline" size="icon-sm" aria-label={t("previousDay")} title={t("previousDay")}><ChevronLeftIcon className="rtl:rotate-180" aria-hidden /></ButtonLink>
            <span className="min-w-36 px-2 text-center text-sm font-medium">{dayLabel}</span>
            <ButtonLink href={href("reminders", addDays(date, 1))} variant="outline" size="icon-sm" aria-label={t("nextDay")} title={t("nextDay")}><ChevronRightIcon className="rtl:rotate-180" aria-hidden /></ButtonLink>
          </div>
        ) : null}
      </div>

      {items.length ? (
        <div className="grid gap-3 lg:grid-cols-2">{items.map((item) => <FollowUpCard key={item.key} item={item} />)}</div>
      ) : (
        <p className="rounded-2xl border border-dashed bg-card p-8 text-center text-sm text-muted-foreground">{t(`empty.${tab}`)}</p>
      )}

      {tab !== "reminders" ? <p className="mt-4 text-xs text-muted-foreground">{t("hints.snooze", { days: SNOOZE[tab] })}</p> : null}
    </>
  );
}
