import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ForbiddenState } from "@/components/app/page-header";
import { DocumentHeader } from "@/components/print/document-header";
import { getPrintBranding } from "@/features/clinic-identity/server";
import { PrintButton } from "@/components/print/print-button";
import { pageFormat } from "@/features/billing/page-format";
import { getPayment } from "@/features/billing/server";
import { patientDisplayName } from "@/features/patients/display";
import { formatDateOnly, formatDateTime } from "@/lib/dates";
import { can, requireClinicContext } from "@/server/auth/context";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("billing"))("receiptTitle") };
}

export default async function PrintReceiptPage({ params }: PageProps<"/print/receipts/[id]">) {
  const { id } = await params;
  const ctx = await requireClinicContext();
  const t = await getTranslations("billing");
  if (!can(ctx, "payment.read")) return <ForbiddenState message={t("noFinanceAccess")} />;
  const data = await getPayment(ctx, id);
  if (!data) notFound();
  const [fmt, branding] = await Promise.all([pageFormat(ctx), getPrintBranding(ctx)]);
  const { payment: p, patient } = data;
  const m = (v: number) => fmt.money(v, p.currency);

  return (
    <article className="max-w-[148mm]">
      <div className="no-print mb-4 flex justify-end">
        <PrintButton />
      </div>
      <DocumentHeader
        clinicName={ctx.organization.name}
        issuer={p.issuerSnapshot ?? branding.issuer}
        logoVersion={branding.logoVersion}
        title={t("receiptTitle")}
        subtitle={
          <>
            <p className="font-semibold tabular">{p.receiptNumber}</p>
            <p>{formatDateOnly(p.receivedOn)}</p>
            {p.status === "reversed" ? <p className="font-bold text-red-700">{t("reversed")}</p> : null}
          </>
        }
      />
      <dl className="space-y-1.5">
        <div className="flex justify-between gap-4"><dt>{t("patient")}</dt><dd><bdi>{patientDisplayName(patient)}</bdi> · {patient.patientNumber}</dd></div>
        {p.payerName ? <div className="flex justify-between gap-4"><dt>{t("payerName")}</dt><dd><bdi>{p.payerName}</bdi></dd></div> : null}
        <div className="flex justify-between gap-4"><dt>{t("method")}</dt><dd>{t(`methods.${p.method}`)}{p.reference ? ` · ${p.reference}` : ""}</dd></div>
        <div className="flex justify-between gap-4 border-t pt-2 text-lg font-bold"><dt>{t("amountReceived")}</dt><dd className="num">{m(p.amountMinor)}</dd></div>
      </dl>
      {data.allocations.length ? (
        <table className="mt-4">
          <thead>
            <tr>
              <th>{t("allocatedTo")}</th>
              <th className="num">{t("amount")}</th>
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
        <p className="mt-3 flex justify-between"><span>{t("unappliedShort")}</span><span className="num">{m(data.unappliedMinor)}</span></p>
      ) : null}
      <footer className="mt-8 border-t pt-2 text-[10px] text-neutral-600">
        <p>{t("legalNotice")}</p>
        <p>{t("printedOn", { date: formatDateTime(new Date(), ctx.organization.timezone, fmt.intl) })}</p>
      </footer>
    </article>
  );
}
