import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ForbiddenState } from "@/components/app/page-header";
import { DocumentHeader } from "@/components/print/document-header";
import { getPrintBranding } from "@/features/clinic-identity/server";
import { PrintButton } from "@/components/print/print-button";
import { pageFormat } from "@/features/billing/page-format";
import { getInvoice } from "@/features/billing/server";
import { patientDisplayName } from "@/features/patients/display";
import { formatDateOnly, formatDateTime } from "@/lib/dates";
import { formatPhone } from "@/lib/phone";
import { can, requireClinicContext } from "@/server/auth/context";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("billing"))("invoiceTitle") };
}

export default async function PrintInvoicePage({ params }: PageProps<"/print/invoices/[id]">) {
  const { id } = await params;
  const ctx = await requireClinicContext();
  const t = await getTranslations("billing");
  if (!can(ctx, "invoice.read")) return <ForbiddenState message={t("noFinanceAccess")} />;
  const data = await getInvoice(ctx, id);
  if (!data || data.invoice.status === "draft") notFound();
  const [fmt, branding] = await Promise.all([pageFormat(ctx), getPrintBranding(ctx)]);
  const { invoice: inv, patient, lines } = data;
  const m = (v: number) => fmt.money(v, inv.currency);

  return (
    <article>
      <div className="no-print mb-4 flex justify-end">
        <PrintButton />
      </div>
      <DocumentHeader
        clinicName={ctx.organization.name}
        issuer={inv.issuerSnapshot ?? branding.issuer}
        logoVersion={branding.logoVersion}
        title={t("invoiceTitle")}
        subtitle={
          <>
            <p className="font-semibold tabular">{inv.number}</p>
            <p>{t("issuedOn", { date: formatDateOnly(inv.documentDate) })}</p>
            {inv.status === "void" ? <p className="font-bold text-red-700">{t("state.void")}</p> : null}
          </>
        }
      />

      <section className="avoid-break mb-5">
        <p className="text-[11px] uppercase text-neutral-600">{t("billedTo")}</p>
        <p className="font-semibold">
          <bdi>{patientDisplayName(patient)}</bdi> · {patient.patientNumber}
        </p>
        {patient.addressLine ? <p>{[patient.addressLine, patient.city, patient.region].filter(Boolean).join(", ")}</p> : null}
        {patient.phone ? <p dir="ltr" className="text-start">{formatPhone(patient.phone, ctx.organization.countryCode)}</p> : null}
      </section>

      <table>
        <thead>
          <tr>
            <th>{t("serviceDate")}</th>
            <th>{t("service")}</th>
            <th>{t("tooth")}</th>
            <th className="num">{t("qty")}</th>
            <th className="num">{t("unitPrice")}</th>
            <th className="num">{t("amount")}</th>
          </tr>
        </thead>
        <tbody>
          {lines.map(({ line, providerName, providerTitle }) => (
            <tr key={line.id}>
              <td className="num">{formatDateOnly(line.serviceDate)}</td>
              <td>
                <bdi>{fmt.label(line.description.name)}</bdi>
                <span className="block text-[10px] text-neutral-600">
                  {line.description.code}
                  {providerName ? ` · ${[providerTitle, providerName].filter(Boolean).join(" ")}` : ""}
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
        <p className="flex justify-between"><span>{t("subtotal")}</span><span className="num">{m(inv.subtotalMinor - inv.discountMinor)}</span></p>
        {inv.taxMinor ? <p className="flex justify-between"><span>{t("tax")}</span><span className="num">{m(inv.taxMinor)}</span></p> : null}
        <p className="flex justify-between border-t pt-1 text-base font-bold"><span>{t("total")}</span><span className="num">{m(inv.totalMinor)}</span></p>
        {data.creditedMinor ? <p className="flex justify-between"><span>{t("credited")}</span><span className="num">−{m(data.creditedMinor)}</span></p> : null}
        <p className="flex justify-between"><span>{t("paid")}</span><span className="num">{m(data.paidMinor)}</span></p>
        <p className="flex justify-between font-semibold"><span>{t("balance")}</span><span className="num">{m(data.balanceMinor)}</span></p>
      </section>

      {inv.notes ? <p className="mt-4 whitespace-pre-line">{inv.notes}</p> : null}
      <footer className="mt-8 border-t pt-2 text-[10px] text-neutral-600">
        <p>{t("legalNotice")}</p>
        <p>{t("printedOn", { date: formatDateTime(new Date(), ctx.organization.timezone, fmt.intl) })}</p>
      </footer>
    </article>
  );
}
