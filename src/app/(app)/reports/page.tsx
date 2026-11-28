import type { Metadata } from "next";
import Link from "next/link";
import { Fragment } from "react";
import { getTranslations } from "next-intl/server";
import { FileSpreadsheetIcon } from "lucide-react";
import { ForbiddenState } from "@/components/app/page-header";
import { PrintButton } from "@/components/print/print-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { pageFormat } from "@/features/billing/page-format";
import { getReport, monthPeriod, type Report } from "@/features/reports/server";
import { formatDateOnly, formatDateTime, parseDateOnly, todayInZone } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { can, requireClinicContext } from "@/server/auth/context";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("reports"))("title") };
}

function Kpi({ label, value, basis, extra }: { label: string; value: string; basis: string; extra?: string }) {
  return (
    <div className="avoid-break rounded-xl border bg-card p-4 print:rounded-none print:p-2">
      <p className="text-sm font-medium">{label}</p>
      <p className="text-2xl font-semibold tabular print:text-lg">{value}</p>
      {extra ? <p className="text-xs text-muted-foreground tabular">{extra}</p> : null}
      <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{basis}</p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6 overflow-hidden rounded-xl border bg-card print:rounded-none print:border-0">
      <h2 className="border-b bg-muted/40 px-4 py-2.5 text-sm font-semibold print:bg-transparent print:px-0">{title}</h2>
      <div className="overflow-x-auto">{children}</div>
    </section>
  );
}

const th = "px-3 py-2 text-start text-xs font-semibold text-muted-foreground whitespace-nowrap";
const td = "px-3 py-2 align-top";
const num = "px-3 py-2 text-end tabular whitespace-nowrap";

export default async function ReportsPage({ searchParams }: PageProps<"/reports">) {
  const ctx = await requireClinicContext();
  const t = await getTranslations();
  if (!can(ctx, "report.operational") && !can(ctx, "report.financial")) return <ForbiddenState message={t("errors.forbiddenPage")} />;
  const sp = await searchParams;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const today = todayInZone(ctx.organization.timezone);
  const view = sp.view === "monthly" ? "monthly" : "daily";
  const date = parseDateOnly(str(sp.date)) ?? today;
  const month = monthPeriod(str(sp.month)) ? str(sp.month) : today.slice(0, 7);
  const period = view === "daily" ? { from: date, to: date } : monthPeriod(month)!;
  const [report, fmt] = await Promise.all([getReport(ctx, period), pageFormat(ctx)]);
  const m = (v: number) => fmt.money(v, report.currency);
  const monthLabel = new Intl.DateTimeFormat(fmt.intl, { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-01T00:00:00Z`));
  const title = view === "daily" ? t("reports.dailyTitle", { date: formatDateOnly(date) }) : t("reports.monthlyTitle", { month: monthLabel });
  const f = report.finance;

  return (
    <div className="print-report">
      <div className="no-print mb-4 flex flex-wrap items-end justify-between gap-3">
        <nav className="inline-flex rounded-lg border bg-card p-0.5 text-sm" aria-label={t("reports.title")}>
          {(["daily", "monthly"] as const).map((v) => (
            <Link
              key={v}
              href={v === "daily" ? `/reports?date=${date}` : `/reports?view=monthly&month=${month}`}
              aria-current={view === v ? "page" : undefined}
              className={cn("rounded-md px-3 py-1.5 font-medium", view === v ? "bg-primary text-primary-foreground" : "text-muted-foreground")}
            >
              {t(`reports.${v}`)}
            </Link>
          ))}
        </nav>
        <form method="get" className="flex items-end gap-2">
          {view === "monthly" ? <input type="hidden" name="view" value="monthly" /> : null}
          <label className="grid gap-1 text-xs text-muted-foreground">
            {view === "daily" ? t("reports.day") : t("reports.month")}
            {view === "daily" ? (
              <Input type="date" name="date" defaultValue={date} max={today} />
            ) : (
              <Input type="month" name="month" defaultValue={month} max={today.slice(0, 7)} />
            )}
          </label>
          <Button type="submit" variant="outline">{t("reports.show")}</Button>
          {can(ctx, "report.export") ? (
            <>
              <a href={`/api/exports/report?${view === "monthly" ? `view=monthly&month=${month}` : `date=${date}`}`} className="inline-flex h-10 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium hover:bg-muted md:h-9">
                <FileSpreadsheetIcon className="size-4" aria-hidden />
                Excel
              </a>
              <a href={`/api/exports/report?format=csv&sheet=1&${view === "monthly" ? `view=monthly&month=${month}` : `date=${date}`}`} className="inline-flex h-10 items-center rounded-lg border px-3 text-sm font-medium hover:bg-muted md:h-9" title={t("reports.export.csvHint")}>
                CSV
              </a>
            </>
          ) : null}
          {can(ctx, "report.financial") ? (
            <Link href="/reports/aging" className="inline-flex h-10 items-center rounded-lg border px-3 text-sm font-medium hover:bg-muted md:h-9">{t("aging.title")}</Link>
          ) : null}
          {can(ctx, "report.operational") ? (
            <Link href="/reports/acquisition" className="inline-flex h-10 items-center rounded-lg border px-3 text-sm font-medium hover:bg-muted md:h-9">{t("acquisition.report.shortTitle")}</Link>
          ) : null}
          <PrintButton />
        </form>
      </div>

      <header className="mb-4">
        <p className="text-sm text-muted-foreground"><bdi>{ctx.organization.name}</bdi></p>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="text-xs text-muted-foreground">
          {t("reports.generatedAt", { date: formatDateTime(report.generatedAt, ctx.organization.timezone, fmt.intl) })} · {t("reports.currencyNote", { currency: fmt.symbol })}
          {report.otherCurrencies.length ? ` · ${t("reports.otherCurrencies", { list: report.otherCurrencies.join(", ") })}` : ""}
        </p>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 print:grid-cols-4">
        <Kpi label={t("reports.kpi.production")} value={m(report.productionMinor)} basis={t("reports.kpi.productionBasis")} extra={t("reports.reversedNote", { count: report.reversedCount })} />
        <Kpi label={t("reports.kpi.unbilled")} value={m(report.unbilledMinor)} basis={t("reports.kpi.unbilledBasis")} />
        {f ? (
          <>
            <Kpi label={t("reports.kpi.invoiced")} value={m(f.invoicedSalesMinor)} basis={t("reports.kpi.invoicedBasis")} />
            <Kpi
              label={t("reports.kpi.net")}
              value={m(f.netCollectionsMinor)}
              basis={t("reports.kpi.netBasis")}
              extra={`${t("reports.kpi.received")} ${m(f.grossReceivedMinor)} · ${t("reports.kpi.deposits")} ${m(f.depositsMinor)} · ${t("reports.refunded")} ${m(f.refundsMinor)}`}
            />
          </>
        ) : null}
      </section>
      {!f ? <p className="mt-3 text-sm text-muted-foreground">{t("reports.financeHidden")}</p> : null}

      {view === "daily" ? <DailySections report={report} m={m} label={fmt.label} t={t} /> : <MonthlySections report={report} m={m} label={fmt.label} t={t} />}

      {f ? (
        <Section title={t("reports.paymentsTitle")}>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className={th}>{t("billing.method")}</th>
                <th className={cn(th, "text-end")}>{t("reports.count")}</th>
                <th className={cn(th, "text-end")}>{t("reports.received")}</th>
                <th className={cn(th, "text-end")}>{t("reports.refunded")}</th>
                <th className={cn(th, "text-end")}>{t("reports.net")}</th>
              </tr>
            </thead>
            <tbody>
              {f.byMethod.map((r) => (
                <tr key={r.method} className="border-b">
                  <td className={td}>{t(`billing.methods.${r.method as "cash"}`)}</td>
                  <td className={num}>{r.count}</td>
                  <td className={num}>{m(r.receivedMinor)}</td>
                  <td className={num}>{m(r.refundedMinor)}</td>
                  <td className={num}>{m(r.receivedMinor - r.refundedMinor)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-semibold">
                <td className={td}>{t("reports.grandTotal")}</td>
                <td className={num} />
                <td className={num}>{m(f.grossReceivedMinor)}</td>
                <td className={num}>{m(f.refundsMinor)}</td>
                <td className={num}>{m(f.netCollectionsMinor)}</td>
              </tr>
            </tfoot>
          </table>
          {view === "daily" && f.payments.length ? (
            <table className="mt-2 w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className={th}>{t("billing.receiptNumber")}</th>
                  <th className={th}>{t("billing.patient")}</th>
                  <th className={th}>{t("billing.method")}</th>
                  <th className={cn(th, "text-end")}>{t("billing.amount")}</th>
                </tr>
              </thead>
              <tbody>
                {f.payments.map((p) => (
                  <tr key={p.id} className="border-b">
                    <td className={cn(td, "tabular")}><Link href={`/payments/${p.id}`} className="hover:underline">{p.receiptNumber}</Link></td>
                    <td className={td}><bdi>{p.patientName}</bdi></td>
                    <td className={td}>{t(`billing.methods.${p.method}`)} · {t(`billing.purpose.${p.purpose}`)}</td>
                    <td className={num}>{m(p.amountMinor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </Section>
      ) : null}
      {report.procedures.length === 0 && !(f && (f.invoices.length || f.payments.length)) ? (
        <p className="mt-6 rounded-xl border border-dashed bg-card p-8 text-center text-sm text-muted-foreground">{t("reports.noData")}</p>
      ) : null}
    </div>
  );
}

type T = Awaited<ReturnType<typeof getTranslations>>;
type Props = { report: Report; m: (v: number) => string; label: (n: Report["procedures"][number]["name"]) => string; t: T };

function DailySections({ report, m, label, t }: Props) {
  const f = report.finance;
  const invoiceById = new Map((f?.invoices ?? []).map((i) => [i.id, i]));
  return (
    <>
      <Section title={t("reports.groupedTitle")}>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b">
              <th className={th}>{t("billing.patient")}</th>
              <th className={th}>{t("billing.service")}</th>
              <th className={th}>{t("billing.tooth")}</th>
              <th className={th}>{t("billing.provider")}</th>
              <th className={cn(th, "text-end")}>{t("billing.qty")}</th>
              <th className={cn(th, "text-end")}>{t("billing.amount")}</th>
            </tr>
          </thead>
          <tbody>
            {report.grouped.map((g) => {
              const inv = g.invoiceId ? invoiceById.get(g.invoiceId) : undefined;
              const subtotal = g.lines.reduce((s, l) => s + l.amountMinor, 0);
              return (
                <Fragment key={g.invoiceId ?? "unbilled"}>
                  <tr className="border-b bg-muted/50">
                    <td colSpan={6} className="px-3 py-2 font-semibold">
                      {g.invoiceId ? (
                        <>
                          <Link href={`/invoices/${g.invoiceId}`} className="tabular hover:underline">{g.invoiceNumber ?? t("billing.draftNumber")}</Link>
                          {g.invoiceStatus === "draft" ? ` (${t("reports.draft")})` : ""}
                          {inv ? (
                            <span className="ms-3 font-normal text-muted-foreground tabular">
                              {t("reports.invoiceTotal")} {m(inv.totalMinor)} · {t("reports.paidToDate")} {m(inv.paidMinor)} · {t("billing.balance")} {m(inv.balanceMinor)}
                            </span>
                          ) : null}
                        </>
                      ) : (
                        t("reports.unbilledGroup")
                      )}
                    </td>
                  </tr>
                  {g.lines.map((l) => (
                    <tr key={l.id} className="border-b">
                      <td className={td}><Link href={`/patients/${l.patientId}`} className="hover:underline"><bdi>{l.patientName}</bdi></Link></td>
                      <td className={td}><bdi>{label(l.name)}</bdi></td>
                      <td className={td}>{l.toothNumber ?? ""}</td>
                      <td className={td}><bdi>{l.providerName}</bdi></td>
                      <td className={num}>{l.quantity}</td>
                      <td className={num}>{m(l.amountMinor)}</td>
                    </tr>
                  ))}
                  <tr className="border-b text-muted-foreground">
                    <td colSpan={5} className="px-3 py-1.5 text-end text-xs">{t("reports.groupSubtotal")}</td>
                    <td className={cn(num, "text-xs")}>{m(subtotal)}</td>
                  </tr>
                </Fragment>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="font-semibold">
              <td colSpan={5} className="px-3 py-2 text-end">{t("reports.grandTotal")}</td>
              <td className={num}>{m(report.productionMinor)}</td>
            </tr>
          </tfoot>
        </table>
        {f ? <p className="px-3 pb-3 text-[11px] text-muted-foreground">{t("reports.paidToDateNote")}</p> : null}
      </Section>
      {f && f.invoices.length ? <InvoicesTable report={report} m={m} t={t} /> : null}
    </>
  );
}

function InvoicesTable({ report, m, t }: Omit<Props, "label">) {
  const f = report.finance!;
  return (
    <Section title={t("reports.invoicesTitle")}>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b">
            <th className={th}>{t("billing.number")}</th>
            <th className={th}>{t("billing.date")}</th>
            <th className={th}>{t("billing.patient")}</th>
            <th className={cn(th, "text-end")}>{t("billing.subtotal")}</th>
            <th className={cn(th, "text-end")}>{t("billing.tax")}</th>
            <th className={cn(th, "text-end")}>{t("billing.total")}</th>
            <th className={cn(th, "text-end")}>{t("reports.paidToDate")}</th>
            <th className={cn(th, "text-end")}>{t("billing.balance")}</th>
          </tr>
        </thead>
        <tbody>
          {f.invoices.map((i) => (
            <tr key={i.id} className={cn("border-b", i.status === "void" && "text-muted-foreground line-through")}>
              <td className={cn(td, "tabular")}><Link href={`/invoices/${i.id}`} className="hover:underline">{i.number}</Link></td>
              <td className={cn(td, "tabular")}>{formatDateOnly(i.documentDate)}</td>
              <td className={td}><bdi>{i.patientName}</bdi></td>
              <td className={num}>{m(i.subtotalMinor - i.discountMinor)}</td>
              <td className={num}>{m(i.taxMinor)}</td>
              <td className={num}>{m(i.totalMinor)}</td>
              <td className={num}>{m(i.paidMinor)}</td>
              <td className={num}>{m(i.balanceMinor)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="font-semibold">
            <td colSpan={5} className="px-3 py-2 text-end">{t("reports.grandTotal")}</td>
            <td className={num}>{m(f.invoicedTotalMinor)}</td>
            <td className={num}>{m(f.issuedPaidToDateMinor)}</td>
            <td className={num}>{m(f.issuedBalanceMinor)}</td>
          </tr>
        </tfoot>
      </table>
      {f.credits.length ? (
        <table className="mt-2 w-full text-sm">
          <thead>
            <tr className="border-b">
              <th className={th}>{t("reports.creditsTitle")}</th>
              <th className={th}>{t("billing.number")}</th>
              <th className={th}>{t("billing.creditReason")}</th>
              <th className={cn(th, "text-end")}>{t("billing.amount")}</th>
            </tr>
          </thead>
          <tbody>
            {f.credits.map((c) => (
              <tr key={c.id} className="border-b">
                <td className={cn(td, "tabular")}>{c.number} · {formatDateOnly(c.documentDate)}</td>
                <td className={cn(td, "tabular")}>{c.invoiceNumber}</td>
                <td className={td}>{c.reason}</td>
                <td className={num}>−{m(c.amountMinor)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </Section>
  );
}

function MonthlySections({ report, m, label, t }: Props) {
  const f = report.finance;
  return (
    <>
      <Section title={t("reports.byDay")}>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b">
              <th className={th}>{t("billing.date")}</th>
              <th className={cn(th, "text-end")}>{t("reports.kpi.production")}</th>
              {f ? (
                <>
                  <th className={cn(th, "text-end")}>{t("reports.kpi.invoiced")}</th>
                  <th className={cn(th, "text-end")}>{t("reports.received")}</th>
                  <th className={cn(th, "text-end")}>{t("reports.refunded")}</th>
                </>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {report.days.map((d) => (
              <tr key={d.date} className="border-b">
                <td className={cn(td, "tabular")}><Link href={`/reports?date=${d.date}`} className="hover:underline">{formatDateOnly(d.date)}</Link></td>
                <td className={num}>{m(d.productionMinor)}</td>
                {f ? (
                  <>
                    <td className={num}>{m(d.invoicedMinor)}</td>
                    <td className={num}>{m(d.receivedMinor)}</td>
                    <td className={num}>{m(d.refundedMinor)}</td>
                  </>
                ) : null}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-semibold">
              <td className={td}>{t("reports.grandTotal")}</td>
              <td className={num}>{m(report.productionMinor)}</td>
              {f ? (
                <>
                  <td className={num}>{m(f.invoicedSalesMinor)}</td>
                  <td className={num}>{m(f.grossReceivedMinor)}</td>
                  <td className={num}>{m(f.refundsMinor)}</td>
                </>
              ) : null}
            </tr>
          </tfoot>
        </table>
      </Section>
      <div className="grid gap-x-4 lg:grid-cols-2">
        <Section title={t("reports.byService")}>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className={th}>{t("billing.service")}</th>
                <th className={cn(th, "text-end")}>{t("reports.count")}</th>
                <th className={cn(th, "text-end")}>{t("billing.amount")}</th>
              </tr>
            </thead>
            <tbody>
              {report.byService.map((s) => (
                <tr key={s.code} className="border-b">
                  <td className={td}><bdi>{label(s.name)}</bdi> <span className="text-xs text-muted-foreground">{s.code}</span></td>
                  <td className={num}>{s.count}</td>
                  <td className={num}>{m(s.amountMinor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
        <Section title={t("reports.byProvider")}>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className={th}>{t("billing.provider")}</th>
                <th className={cn(th, "text-end")}>{t("reports.count")}</th>
                <th className={cn(th, "text-end")}>{t("billing.amount")}</th>
              </tr>
            </thead>
            <tbody>
              {report.byProvider.map((p) => (
                <tr key={p.name} className="border-b">
                  <td className={td}><bdi>{p.name}</bdi></td>
                  <td className={num}>{p.count}</td>
                  <td className={num}>{m(p.amountMinor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
        {report.bySite.length > 1 ? (
          <Section title={t("sites.reportTitle")}>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className={th}>{t("sites.site")}</th>
                  <th className={cn(th, "text-end")}>{t("sites.production")}</th>
                  {report.bySite.some((s) => s.collectedMinor !== null) ? <th className={cn(th, "text-end")}>{t("sites.collected")}</th> : null}
                </tr>
              </thead>
              <tbody>
                {report.bySite.map((s) => (
                  <tr key={s.siteId} className="border-b">
                    <td className={td}><bdi>{s.name}</bdi></td>
                    <td className={num}>{m(s.productionMinor)}</td>
                    {s.collectedMinor !== null ? <td className={num}>{m(s.collectedMinor)}</td> : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
        ) : null}
      </div>
      {f && f.invoices.length ? <InvoicesTable report={report} m={m} t={t} /> : null}
    </>
  );
}
