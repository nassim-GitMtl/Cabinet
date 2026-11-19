import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ForbiddenState } from "@/components/app/page-header";
import { DocumentHeader } from "@/components/print/document-header";
import { getPrintBranding } from "@/features/clinic-identity/server";
import { PrintButton } from "@/components/print/print-button";
import { pageFormat } from "@/features/billing/page-format";
import { getPatientStatement } from "@/features/billing/statement";
import { patientDisplayName } from "@/features/patients/display";
import { getPatient } from "@/features/patients/server";
import { formatDateOnly, formatDateTime, parseDateOnly, todayInZone } from "@/lib/dates";
import { can, requireClinicContext } from "@/server/auth/context";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("statement"))("title") };
}

/** Printable account statement (use the browser's "Save as PDF" for a PDF). */
export default async function StatementPage({ params, searchParams }: PageProps<"/print/statements/[patientId]">) {
  const { patientId } = await params;
  const sp = await searchParams;
  const ctx = await requireClinicContext();
  const t = await getTranslations();
  if (!can(ctx, "invoice.read") || !can(ctx, "payment.read")) return <ForbiddenState message={t("billing.noFinanceAccess")} />;
  const data = await getPatient(ctx, patientId);
  if (!data) notFound();
  const today = todayInZone(ctx.organization.timezone);
  const to = parseDateOnly(typeof sp.to === "string" ? sp.to : "") ?? today;
  const from = parseDateOnly(typeof sp.from === "string" ? sp.from : "") ?? `${to.slice(0, 4)}-01-01`;
  const [st, fmt, branding] = await Promise.all([getPatientStatement(ctx, patientId, from, to), pageFormat(ctx), getPrintBranding(ctx)]);
  const m = (v: number) => fmt.money(v, st.currency);
  const p = data.patient;

  return (
    <article>
      <form method="get" className="no-print mb-4 flex flex-wrap items-end justify-end gap-2 text-sm">
        <label className="grid gap-1">{t("billing.from")}<input type="date" name="from" defaultValue={from} className="rounded-md border px-2 py-1" /></label>
        <label className="grid gap-1">{t("billing.to")}<input type="date" name="to" defaultValue={to} max={today} className="rounded-md border px-2 py-1" /></label>
        <button type="submit" className="rounded-md border px-3 py-1.5">{t("reports.show")}</button>
        <PrintButton />
      </form>
      <DocumentHeader
        issuer={branding.issuer}
        logoVersion={branding.logoVersion}
        clinicName={ctx.organization.name}
        title={t("statement.title")}
        subtitle={<p>{t("statement.period", { from: formatDateOnly(from), to: formatDateOnly(to) })}</p>}
      />
      <section className="avoid-break mb-4">
        <p className="font-semibold"><bdi>{patientDisplayName(p)}</bdi> · {p.patientNumber}</p>
        {p.addressLine ? <p>{[p.addressLine, p.city, p.region].filter(Boolean).join(", ")}</p> : null}
      </section>
      <table>
        <thead>
          <tr>
            <th>{t("billing.date")}</th>
            <th>{t("statement.document")}</th>
            <th>{t("statement.detail")}</th>
            <th className="num">{t("statement.debit")}</th>
            <th className="num">{t("statement.credit")}</th>
            <th className="num">{t("statement.balance")}</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="num">{formatDateOnly(from)}</td>
            <td colSpan={4} className="font-medium">{t("statement.opening")}</td>
            <td className="num font-medium">{m(st.openingMinor)}</td>
          </tr>
          {st.lines.map((l, i) => (
            <tr key={i}>
              <td className="num">{formatDateOnly(l.date)}</td>
              <td>{t(`statement.kinds.${l.kind}`)} <span className="tabular">{l.reference}</span></td>
              <td>{l.kind === "payment" && l.detail ? t(`billing.methods.${l.detail as "cash"}`) : l.detail ?? ""}</td>
              <td className="num">{l.debitMinor ? m(l.debitMinor) : ""}</td>
              <td className="num">{l.creditMinor ? m(l.creditMinor) : ""}</td>
              <td className="num">{m(l.balanceMinor)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="font-bold">
            <td colSpan={3}>{t("statement.closing")}</td>
            <td className="num">{m(st.totalDebitMinor)}</td>
            <td className="num">{m(st.totalCreditMinor)}</td>
            <td className="num">{m(st.closingMinor)}</td>
          </tr>
        </tfoot>
      </table>
      <p className="mt-4">{st.closingMinor > 0 ? t("statement.owes", { amount: m(st.closingMinor) }) : st.closingMinor < 0 ? t("statement.credit_balance", { amount: m(-st.closingMinor) }) : t("statement.settled")}</p>
      <footer className="mt-8 border-t pt-2 text-[10px] text-neutral-600">
        <p>{t("statement.basis")}</p>
        <p>{t("billing.printedOn", { date: formatDateTime(new Date(), ctx.organization.timezone, fmt.intl) })}</p>
      </footer>
    </article>
  );
}
