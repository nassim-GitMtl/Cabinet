import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ForbiddenState } from "@/components/app/page-header";
import { DocumentControls } from "@/components/print/document-controls";
import { DocumentHeader } from "@/components/print/document-header";
import { DocumentText } from "@/components/print/document-text";
import { getPrintBranding } from "@/features/clinic-identity/server";
import { pageFormat } from "@/features/billing/page-format";
import { getPayment } from "@/features/billing/server";
import { documentDirection, documentLocale, resolveDocumentLanguage } from "@/features/printing/document-language";
import { documentTranslation } from "@/features/printing/document-translations";
import { patientDisplayName } from "@/features/patients/display";
import { formatDateOnly, formatDateTime } from "@/lib/dates";
import { can, requireClinicContext } from "@/server/auth/context";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("billing"))("receiptTitle") };
}

export default async function PrintReceiptPage({ params, searchParams }: PageProps<"/print/receipts/[id]">) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await requireClinicContext();
  const uiT = await getTranslations("billing");
  if (!can(ctx, "payment.read")) return <ForbiddenState message={uiT("noFinanceAccess")} />;
  const data = await getPayment(ctx, id);
  if (!data) notFound();
  const { payment: p, patient } = data;
  const language = resolveDocumentLanguage(sp.language, patient.preferredLocale);
  const locale = documentLocale(language);
  const [fmt, branding] = await Promise.all([
    pageFormat(ctx, locale),
    getPrintBranding(ctx),
  ]);
  const text = (key: string, values?: Record<string, string | number>) => (
    <DocumentText language={language} fr={documentTranslation("fr", `billing.${key}`, values)} ar={documentTranslation("ar", `billing.${key}`, values)} />
  );
  const m = (v: number) => fmt.money(v, p.currency);

  return (
    <article lang={locale} dir={documentDirection(language)} className={language === "ar" ? "document-arabic max-w-[148mm]" : "max-w-[148mm]"}>
      <DocumentControls language={language} />
      <DocumentHeader
        clinicName={ctx.organization.name}
        issuer={p.issuerSnapshot ?? branding.issuer}
        logoVersion={branding.logoVersion}
        title={text("receiptTitle")}
        subtitle={
          <>
            <p className="font-semibold tabular">{p.receiptNumber}</p>
            <p>{formatDateOnly(p.receivedOn)}</p>
            {p.status === "reversed" ? <p className="font-bold text-red-700">{text("reversed")}</p> : null}
          </>
        }
      />
      <dl className="space-y-1.5">
        <div className="flex justify-between gap-4"><dt>{text("patient")}</dt><dd><bdi>{patientDisplayName(patient)}</bdi> · {patient.patientNumber}</dd></div>
        {p.payerName ? <div className="flex justify-between gap-4"><dt>{text("payerName")}</dt><dd><bdi>{p.payerName}</bdi></dd></div> : null}
        <div className="flex justify-between gap-4"><dt>{text("method")}</dt><dd>{text(`methods.${p.method}`)}{p.reference ? <> · <bdi>{p.reference}</bdi></> : null}</dd></div>
        <div className="flex justify-between gap-4 border-t pt-2 text-lg font-bold"><dt>{text("amountReceived")}</dt><dd className="num">{m(p.amountMinor)}</dd></div>
      </dl>
      {data.allocations.length ? (
        <table className="mt-4">
          <thead>
            <tr>
              <th>{text("allocatedTo")}</th>
              <th className="num">{text("amount")}</th>
            </tr>
          </thead>
          <tbody>
            {data.allocations.map((a) => (
              <tr key={a.invoiceId}>
                <td className="tabular">{a.number}</td>
                <td className="num">{m(a.amountMinor)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {data.unappliedMinor > 0 ? (
        <p className="mt-3 flex justify-between"><span>{text("unappliedShort")}</span><span className="num">{m(data.unappliedMinor)}</span></p>
      ) : null}
      <footer className="mt-8 border-t pt-2 text-[10px] text-neutral-600">
        <p>{text("printedOn", { date: formatDateTime(new Date(), ctx.organization.timezone, fmt.intl) })}</p>
      </footer>
    </article>
  );
}
