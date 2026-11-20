import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ForbiddenState } from "@/components/app/page-header";
import { DocumentControls } from "@/components/print/document-controls";
import { DocumentHeader } from "@/components/print/document-header";
import { DocumentText } from "@/components/print/document-text";
import { getPrintBranding } from "@/features/clinic-identity/server";
import { pageFormat } from "@/features/billing/page-format";
import { getPatientStatement } from "@/features/billing/statement";
import { documentDirection, documentLocale, resolveDocumentLanguage } from "@/features/printing/document-language";
import { documentTranslation } from "@/features/printing/document-translations";
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
  const uiT = await getTranslations();
  if (!can(ctx, "invoice.read") || !can(ctx, "payment.read")) return <ForbiddenState message={uiT("billing.noFinanceAccess")} />;
  const data = await getPatient(ctx, patientId);
  if (!data) notFound();
  const today = todayInZone(ctx.organization.timezone);
  const to = parseDateOnly(typeof sp.to === "string" ? sp.to : "") ?? today;
  const from = parseDateOnly(typeof sp.from === "string" ? sp.from : "") ?? `${to.slice(0, 4)}-01-01`;
  const language = resolveDocumentLanguage(sp.language, data.patient.preferredLocale);
  const locale = documentLocale(language);
  const [st, fmt, branding] = await Promise.all([
    getPatientStatement(ctx, patientId, from, to),
    pageFormat(ctx, locale),
    getPrintBranding(ctx),
  ]);
  const text = (key: string, values?: Record<string, string | number>) => (
    <DocumentText language={language} fr={documentTranslation("fr", key, values)} ar={documentTranslation("ar", key, values)} />
  );
  const m = (v: number) => fmt.money(v, st.currency);
  const p = data.patient;

  return (
    <article lang={locale} dir={documentDirection(language)} className={language === "ar" ? "document-arabic" : undefined}>
      <form method="get" className="no-print mb-2 flex flex-wrap items-end justify-end gap-2 text-sm" dir="ltr">
        <input type="hidden" name="language" value={language} />
        <label className="grid gap-1">{uiT("billing.from")}<input type="date" name="from" defaultValue={from} className="rounded-md border px-2 py-1" /></label>
        <label className="grid gap-1">{uiT("billing.to")}<input type="date" name="to" defaultValue={to} max={today} className="rounded-md border px-2 py-1" /></label>
        <button type="submit" className="rounded-md border px-3 py-1.5">{uiT("reports.show")}</button>
      </form>
      <DocumentControls language={language} hidden={{ from, to }} />
      <DocumentHeader
        issuer={branding.issuer}
        logoVersion={branding.logoVersion}
        clinicName={ctx.organization.name}
        title={text("statement.title")}
        subtitle={<p>{text("statement.period", { from: formatDateOnly(from), to: formatDateOnly(to) })}</p>}
      />
      <section className="avoid-break mb-4">
        <p className="font-semibold"><bdi>{patientDisplayName(p)}</bdi> · {p.patientNumber}</p>
        {p.addressLine ? <p><bdi>{[p.addressLine, p.city, p.region].filter(Boolean).join(", ")}</bdi></p> : null}
      </section>
      <table>
        <thead>
          <tr>
            <th>{text("billing.date")}</th>
            <th>{text("statement.document")}</th>
            <th>{text("statement.detail")}</th>
            <th className="num">{text("statement.debit")}</th>
            <th className="num">{text("statement.credit")}</th>
            <th className="num">{text("statement.balance")}</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="num">{formatDateOnly(from)}</td>
            <td colSpan={4} className="font-medium">{text("statement.opening")}</td>
            <td className="num font-medium">{m(st.openingMinor)}</td>
          </tr>
          {st.lines.map((l, i) => (
            <tr key={i}>
              <td className="num">{formatDateOnly(l.date)}</td>
              <td>{text(`statement.kinds.${l.kind}`)} <span className="tabular"><bdi>{l.reference}</bdi></span></td>
              <td>{l.kind === "payment" && l.detail ? text(`billing.methods.${l.detail}`) : <bdi>{l.detail ?? ""}</bdi>}</td>
              <td className="num">{l.debitMinor ? m(l.debitMinor) : ""}</td>
              <td className="num">{l.creditMinor ? m(l.creditMinor) : ""}</td>
              <td className="num">{m(l.balanceMinor)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="font-bold">
            <td colSpan={3}>{text("statement.closing")}</td>
            <td className="num">{m(st.totalDebitMinor)}</td>
            <td className="num">{m(st.totalCreditMinor)}</td>
            <td className="num">{m(st.closingMinor)}</td>
          </tr>
        </tfoot>
      </table>
      <p className="mt-4">{st.closingMinor > 0 ? text("statement.owes", { amount: m(st.closingMinor) }) : st.closingMinor < 0 ? text("statement.credit_balance", { amount: m(-st.closingMinor) }) : text("statement.settled")}</p>
      <footer className="mt-8 border-t pt-2 text-[10px] text-neutral-600">
        <p>{text("statement.basis")}</p>
        <p>{text("billing.printedOn", { date: formatDateTime(new Date(), ctx.organization.timezone, fmt.intl) })}</p>
      </footer>
    </article>
  );
}
