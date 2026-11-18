import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ArrowLeftIcon, FileSpreadsheetIcon } from "lucide-react";
import { ForbiddenState, PageHeader } from "@/components/app/page-header";
import { PrintButton } from "@/components/print/print-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { pageFormat } from "@/features/billing/page-format";
import { AGING_BUCKETS, getReceivablesAging } from "@/features/reports/aging";
import { formatDateOnly, formatDateTime, parseDateOnly, todayInZone } from "@/lib/dates";
import { formatPhone } from "@/lib/phone";
import { can, requireClinicContext } from "@/server/auth/context";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("aging"))("title") };
}

const num = "px-3 py-2 text-end tabular whitespace-nowrap";

export default async function AgingPage({ searchParams }: PageProps<"/reports/aging">) {
  const ctx = await requireClinicContext();
  const t = await getTranslations();
  if (!can(ctx, "report.financial")) return <ForbiddenState message={t("errors.forbiddenPage")} />;
  const sp = await searchParams;
  const today = todayInZone(ctx.organization.timezone);
  const asOf = parseDateOnly(typeof sp.asOf === "string" ? sp.asOf : "") ?? today;
  const [aging, fmt] = await Promise.all([getReceivablesAging(ctx, asOf), pageFormat(ctx)]);
  const m = (v: number) => (v ? fmt.money(v, aging.currency) : "—");

  return (
    <>
      <Link href="/reports" className="no-print mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeftIcon className="size-4 rtl:rotate-180" aria-hidden />
        {t("reports.title")}
      </Link>
      <PageHeader
        title={t("aging.title")}
        description={`${t("aging.asOf", { date: formatDateOnly(asOf) })} · ${t("reports.generatedAt", { date: formatDateTime(new Date(), ctx.organization.timezone, fmt.intl) })}`}
        actions={
          <form method="get" className="no-print flex flex-wrap items-end gap-2">
            <Input type="date" name="asOf" defaultValue={asOf} max={today} aria-label={t("aging.asOfLabel")} />
            <Button type="submit" variant="outline">{t("reports.show")}</Button>
            {can(ctx, "report.export") ? (
              <a href={`/api/exports/aging?asOf=${asOf}`} className="inline-flex h-10 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium hover:bg-muted md:h-9">
                <FileSpreadsheetIcon className="size-4" aria-hidden />
                Excel
              </a>
            ) : null}
            <PrintButton />
          </form>
        }
      />
      <p className="mb-4 text-xs text-muted-foreground">{t("aging.basis")}</p>
      <section className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {AGING_BUCKETS.map((b) => (
          <div key={b} className="rounded-xl border bg-card p-3">
            <p className="text-xs text-muted-foreground">{t(`aging.buckets.${b}`)}</p>
            <p className="font-semibold tabular">{m(aging.totals[b])}</p>
          </div>
        ))}
        <div className="rounded-xl border border-primary/40 bg-card p-3">
          <p className="text-xs text-muted-foreground">{t("billing.total")}</p>
          <p className="font-semibold tabular">{m(aging.grandTotal)}</p>
        </div>
      </section>
      {aging.patients.length === 0 ? (
        <p className="rounded-xl border border-dashed bg-card p-8 text-center text-sm text-muted-foreground">{t("aging.empty")}</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-xs text-muted-foreground">
                <th className="px-3 py-2 text-start">{t("billing.patient")}</th>
                {AGING_BUCKETS.map((b) => <th key={b} className="px-3 py-2 text-end">{t(`aging.buckets.${b}`)}</th>)}
                <th className="px-3 py-2 text-end">{t("billing.total")}</th>
              </tr>
            </thead>
            <tbody>
              {aging.patients.map((p) => (
                <tr key={p.patientId} className="border-b align-top">
                  <td className="px-3 py-2">
                    <Link href={`/patients/${p.patientId}?tab=finance`} className="font-medium hover:underline"><bdi>{p.name}</bdi></Link>
                    <span className="block text-xs text-muted-foreground">
                      {p.patientNumber}
                      {p.phone ? <> · <span dir="ltr">{formatPhone(p.phone, ctx.organization.countryCode)}</span></> : null}
                    </span>
                    <span className="block text-xs text-muted-foreground tabular">
                      {p.invoices.map((i) => `${i.number} (${t("aging.days", { n: i.ageDays })})`).join(" · ")}
                    </span>
                  </td>
                  {AGING_BUCKETS.map((b) => <td key={b} className={num}>{m(p.buckets[b])}</td>)}
                  <td className={`${num} font-semibold`}>{m(p.total)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-semibold">
                <td className="px-3 py-2">{t("reports.grandTotal")}</td>
                {AGING_BUCKETS.map((b) => <td key={b} className={num}>{m(aging.totals[b])}</td>)}
                <td className={num}>{m(aging.grandTotal)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </>
  );
}
