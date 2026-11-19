import type { Metadata } from "next";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { ButtonLink } from "@/components/button-link";
import { ForbiddenState, PageHeader } from "@/components/app/page-header";
import { ACQUISITION_PERIODS, getAcquisitionReport } from "@/features/reports/acquisition";
import { todayInZone } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { formatPhone } from "@/lib/phone";
import { cn } from "@/lib/utils";
import { can, requireClinicContext } from "@/server/auth/context";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acquisition.report"))("title") };
}

function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="rounded-2xl border bg-card p-4 shadow-sm">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="min-w-0 rounded-2xl border bg-card p-4 shadow-sm sm:p-5">
      <h2 className="text-lg font-semibold">{title}</h2>
      {hint ? <p className="mt-1 text-sm text-muted-foreground">{hint}</p> : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}

export default async function AcquisitionReportPage(props: PageProps<"/reports/acquisition">) {
  const ctx = await requireClinicContext();
  const t = await getTranslations("acquisition");
  if (!can(ctx, "report.operational")) return <ForbiddenState message={(await getTranslations("errors"))("forbiddenPage")} />;
  const sp = await props.searchParams;
  const months = ACQUISITION_PERIODS.find((p) => String(p) === sp.months) ?? 6;
  const [report, locale] = await Promise.all([getAcquisitionReport(ctx, { today: todayInZone(ctx.organization.timezone), months }), getLocale()]);

  const intl = locale === "ar" ? "ar-DZ-u-nu-latn" : locale === "en" ? "en-GB" : "fr-FR";
  const monthLabel = (ym: string) => new Intl.DateTimeFormat(intl, { month: "short", year: "2-digit", timeZone: "UTC" }).format(new Date(`${ym}-01T00:00:00Z`));
  const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)} %` : "—");
  const money = (minor: number) => formatMoney(minor, report.currency, locale === "ar" ? "ar-DZ-u-nu-latn" : "fr-DZ", ctx.organization.settings.currencyDisplay);
  const label = (c: string) => t(`channels.${c}` as "channels.facebook");
  const rows = report.channels.filter((c) => c.newPatients > 0).sort((a, b) => b.newPatients - a.newPatients);
  const known = report.total - report.unknown;
  const max = Math.max(1, ...rows.map((r) => r.newPatients));
  const showMoney = report.channels[0]?.productionMinor !== null;

  return (
    <>
      <PageHeader
        title={t("report.title")}
        description={t("report.subtitle")}
        back={<ButtonLink href="/reports" variant="ghost">← {(await getTranslations("reports"))("title")}</ButtonLink>}
        actions={
          <nav className="inline-flex rounded-lg border bg-card p-0.5 text-sm" aria-label={t("report.period")}>
            {ACQUISITION_PERIODS.map((p) => (
              <Link key={p} href={`/reports/acquisition?months=${p}`} aria-current={p === months ? "page" : undefined}
                className={cn("rounded-md px-3 py-1.5 font-medium", p === months ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
                {t("report.months", { count: p })}
              </Link>
            ))}
          </nav>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={t("report.newPatients")} value={report.total} hint={t("report.sinceMonth", { month: monthLabel(report.months[0]!) })} />
        <Stat label={t("report.sourceKnown")} value={pct(known, report.total)} hint={t("report.sourceKnownHint", { count: report.unknown })} />
        <Stat label={t("report.treated")} value={pct(report.treated, report.total)} hint={t("report.treatedHint", { count: report.treated })} />
        <Stat label={t("report.bookingsApproved")} value={`${report.bookings.approved} / ${report.bookings.received}`} hint={t("report.bookingsHint")} />
      </div>

      {report.unknown > 0 && report.total > 0 ? (
        <p className="mb-5 rounded-xl border border-amber-300/60 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">{t("report.askHint")}</p>
      ) : null}

      <div className="grid gap-5">
        <Section title={t("report.byChannel")} hint={t("report.byChannelHint")}>
          {rows.length ? (
            <div className="overflow-x-auto rounded-xl border">
              <table className="w-full min-w-[36rem] text-sm">
                <thead className="bg-muted/50 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-start">{t("report.channel")}</th>
                    <th className="px-3 py-2 text-end">{t("report.newPatients")}</th>
                    <th className="px-3 py-2 text-end">{t("report.share")}</th>
                    <th className="px-3 py-2 text-end">{t("report.treatedShort")}</th>
                    {showMoney ? <th className="px-3 py-2 text-end">{t("report.production")}</th> : null}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rows.map((r) => (
                    <tr key={r.channel}>
                      <td className="px-3 py-2">
                        <span className="font-medium">{label(r.channel)}</span>
                        <span className="mt-1 block h-1.5 rounded-full bg-muted" aria-hidden>
                          <span className={cn("block h-full rounded-full", r.channel === "unknown" ? "bg-muted-foreground/40" : "bg-primary")} style={{ width: `${(r.newPatients / max) * 100}%` }} />
                        </span>
                      </td>
                      <td className="px-3 py-2 text-end tabular-nums">{r.newPatients}</td>
                      <td className="px-3 py-2 text-end tabular-nums">{pct(r.newPatients, report.total)}</td>
                      <td className="px-3 py-2 text-end tabular-nums">{r.treated} <span className="text-xs text-muted-foreground">({pct(r.treated, r.newPatients)})</span></td>
                      {showMoney ? <td className="px-3 py-2 text-end tabular-nums">{money(r.productionMinor ?? 0)}</td> : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t("report.empty")}</p>
          )}
        </Section>

        {rows.length ? (
          <Section title={t("report.byMonth")}>
            <div className="overflow-x-auto rounded-xl border">
              <table className="w-full min-w-[36rem] text-sm">
                <thead className="bg-muted/50 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-start">{t("report.channel")}</th>
                    {report.months.map((m) => <th key={m} className="px-3 py-2 text-end">{monthLabel(m)}</th>)}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rows.map((r) => (
                    <tr key={r.channel}>
                      <td className="px-3 py-2">{label(r.channel)}</td>
                      {r.perMonth.map((n, i) => <td key={i} className={cn("px-3 py-2 text-end tabular-nums", !n && "text-muted-foreground/60")}>{n}</td>)}
                    </tr>
                  ))}
                  <tr className="bg-muted/30 font-semibold">
                    <td className="px-3 py-2">{t("report.total")}</td>
                    {report.perMonthTotal.map((n, i) => <td key={i} className="px-3 py-2 text-end tabular-nums">{n}</td>)}
                  </tr>
                </tbody>
              </table>
            </div>
          </Section>
        ) : null}

        <div className="grid gap-5 lg:grid-cols-2">
          <Section title={t("report.bookingsTitle")} hint={t("report.bookingsTitleHint")}>
            <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
              {(["received", "approved", "pending", "declined", "lapsed"] as const).map((k) => (
                <div key={k} className="rounded-xl border p-3">
                  <dt className="text-xs text-muted-foreground">{t(`report.bookings.${k}`)}</dt>
                  <dd className="text-xl font-semibold tabular-nums">{report.bookings[k]}</dd>
                </div>
              ))}
            </dl>
          </Section>

          {can(ctx, "patient.read") ? (
            <Section title={t("report.referrersTitle")} hint={t("report.referrersHint")}>
              {report.referrers.length ? (
                <ol className="divide-y">
                  {report.referrers.map((r) => (
                    <li key={r.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                      <span className="min-w-0">
                        <Link href={`/patients/${r.id}`} className="font-medium text-primary underline-offset-4 hover:underline"><bdi>{r.lastName.toUpperCase()} {r.firstName}</bdi></Link>
                        <span className="block text-xs text-muted-foreground"><bdi>{r.patientNumber}</bdi>{r.phone ? <> · <span dir="ltr">{formatPhone(r.phone)}</span></> : null}</span>
                      </span>
                      <span className="shrink-0 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">{t("report.referred", { count: r.count })}</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-sm text-muted-foreground">{t("report.referrersEmpty")}</p>
              )}
            </Section>
          ) : null}
        </div>
      </div>
    </>
  );
}
