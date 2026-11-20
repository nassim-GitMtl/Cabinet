import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ForbiddenState } from "@/components/app/page-header";
import { DocumentControls } from "@/components/print/document-controls";
import { DocumentHeader } from "@/components/print/document-header";
import { DocumentText } from "@/components/print/document-text";
import { getPrintBranding } from "@/features/clinic-identity/server";
import { pageFormat } from "@/features/billing/page-format";
import { getInvoice } from "@/features/billing/server";
import { documentDirection, documentLocale, resolveDocumentLanguage } from "@/features/printing/document-language";
import { documentTranslation } from "@/features/printing/document-translations";
import { patientDisplayName } from "@/features/patients/display";
import { formatDateOnly, formatDateTime } from "@/lib/dates";
import { formatPhone } from "@/lib/phone";
import { can, requireClinicContext } from "@/server/auth/context";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("billing"))("invoiceTitle") };
}

export default async function PrintInvoicePage({ params, searchParams }: PageProps<"/print/invoices/[id]">) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await requireClinicContext();
  const uiT = await getTranslations("billing");
  if (!can(ctx, "invoice.read")) return <ForbiddenState message={uiT("noFinanceAccess")} />;
  const data = await getInvoice(ctx, id);
  if (!data || data.invoice.status === "draft") notFound();
  const { invoice: inv, patient, lines } = data;
  const language = resolveDocumentLanguage(sp.language, patient.preferredLocale);
  const locale = documentLocale(language);
  const [fmt, branding] = await Promise.all([
    pageFormat(ctx, locale),
    getPrintBranding(ctx),
  ]);
  const text = (key: string, values?: Record<string, string | number>) => (
    <DocumentText language={language} fr={documentTranslation("fr", `billing.${key}`, values)} ar={documentTranslation("ar", `billing.${key}`, values)} />
  );
  const m = (v: number) => fmt.money(v, inv.currency);

  return (
    <article lang={locale} dir={documentDirection(language)} className={language === "ar" ? "document-arabic" : undefined}>
      <DocumentControls language={language} />
      <DocumentHeader
        clinicName={ctx.organization.name}
        issuer={inv.issuerSnapshot ?? branding.issuer}
        logoVersion={branding.logoVersion}
        title={text("invoiceTitle")}
        subtitle={
          <>
            <p className="font-semibold tabular">{inv.number}</p>
            <p>{text("issuedOn", { date: formatDateOnly(inv.documentDate) })}</p>
            {inv.status === "void" ? <p className="font-bold text-red-700">{text("state.void")}</p> : null}
          </>
        }
      />

      <section className="avoid-break mb-5">
        <p className="text-[11px] uppercase text-neutral-600">{text("billedTo")}</p>
        <p className="font-semibold">
          <bdi>{patientDisplayName(patient)}</bdi> · {patient.patientNumber}
        </p>
        {patient.addressLine ? <p><bdi>{[patient.addressLine, patient.city, patient.region].filter(Boolean).join(", ")}</bdi></p> : null}
        {patient.phone ? <p dir="ltr" className="text-start">{formatPhone(patient.phone, ctx.organization.countryCode)}</p> : null}
      </section>

      <table>
        <thead>
          <tr>
            <th>{text("serviceDate")}</th>
            <th>{text("service")}</th>
            <th>{text("tooth")}</th>
            <th className="num">{text("qty")}</th>
            <th className="num">{text("unitPrice")}</th>
            <th className="num">{text("amount")}</th>
          </tr>
        </thead>
        <tbody>
          {lines.map(({ line, providerName, providerTitle }) => (
            <tr key={line.id}>
              <td className="num">{formatDateOnly(line.serviceDate)}</td>
              <td>
                <DocumentText language={language} fr={line.description.name.fr} ar={line.description.name.ar || line.description.name.fr} />
                <span className="block text-[10px] text-neutral-600">
                  {line.description.code}
                  {providerName ? <> · <bdi>{[providerTitle, providerName].filter(Boolean).join(" ")}</bdi></> : null}
                </span>
              </td>
              <td>{line.toothNumber ?? ""}</td>
              <td className="num">{line.quantity}</td>
              <td className="num">{m(line.unitPriceMinor)}</td>
              <td className="num">{m(line.totalMinor)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <section className="avoid-break ms-auto mt-4 w-full max-w-xs space-y-1">
        <p className="flex justify-between"><span>{text("subtotal")}</span><span className="num">{m(inv.subtotalMinor - inv.discountMinor)}</span></p>
        {inv.taxMinor ? <p className="flex justify-between"><span>{text("tax")}</span><span className="num">{m(inv.taxMinor)}</span></p> : null}
        <p className="flex justify-between border-t pt-1 text-base font-bold"><span>{text("total")}</span><span className="num">{m(inv.totalMinor)}</span></p>
        {data.creditedMinor ? <p className="flex justify-between"><span>{text("credited")}</span><span className="num">−{m(data.creditedMinor)}</span></p> : null}
        <p className="flex justify-between"><span>{text("paid")}</span><span className="num">{m(data.paidMinor)}</span></p>
        <p className="flex justify-between font-semibold"><span>{text("balance")}</span><span className="num">{m(data.balanceMinor)}</span></p>
      </section>

      {inv.notes ? <p className="mt-4 whitespace-pre-line"><bdi>{inv.notes}</bdi></p> : null}
      <footer className="mt-8 border-t pt-2 text-[10px] text-neutral-600">
        <p>{text("legalNotice")}</p>
        <p>{text("printedOn", { date: formatDateTime(new Date(), ctx.organization.timezone, fmt.intl) })}</p>
      </footer>
    </article>
  );
}
