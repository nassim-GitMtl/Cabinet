import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArrowLeftIcon, PrinterIcon } from "lucide-react";
import { ForbiddenState } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { RefundButton, ReversePaymentButton } from "@/features/billing/components/billing-dialogs";
import { pageFormat } from "@/features/billing/page-format";
import { getPayment } from "@/features/billing/server";
import { patientDisplayName } from "@/features/patients/display";
import { formatDateOnly } from "@/lib/dates";
import { can, requireClinicContext } from "@/server/auth/context";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("billing"))("receipt") };
}

export default async function PaymentPage({ params }: PageProps<"/payments/[id]">) {
  const { id } = await params;
  const ctx = await requireClinicContext();
  const t = await getTranslations();
  if (!can(ctx, "payment.read")) return <ForbiddenState message={t("errors.forbiddenPage")} />;
  const data = await getPayment(ctx, id);
  if (!data) notFound();
  const fmt = await pageFormat(ctx);
  const { payment: p, patient } = data;
  const m = (v: number) => fmt.money(v, p.currency);
  const posted = p.status === "posted";

  const rows: [string, React.ReactNode][] = [
    [t("billing.receivedOn"), formatDateOnly(p.receivedOn)],
    [t("billing.method"), t(`billing.methods.${p.method}`)],
    [t("billing.reference"), p.reference ?? "—"],
    [t("billing.payerName"), p.payerName ?? "—"],
    [t("billing.allocatedTo"), m(data.allocatedMinor)],
    [t("billing.refunds"), m(data.refundedMinor)],
    [t("billing.unappliedShort"), <span key="u" className="font-semibold">{m(data.unappliedMinor)}</span>],
  ];

  return (
    <>
      <Link href={`/patients/${patient.id}?tab=finance`} className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeftIcon className="size-4 rtl:rotate-180" aria-hidden />
        <bdi>{patientDisplayName(patient)}</bdi>
      </Link>
      <header className="mb-4 rounded-xl border bg-card p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm text-muted-foreground">{t(`billing.purpose.${p.purpose}`)}</p>
            <h1 className="text-2xl font-semibold tabular">{p.receiptNumber}</h1>
            {!posted ? <Badge variant="destructive">{t("billing.reversed")}</Badge> : null}
          </div>
          <p className={posted ? "text-2xl font-semibold tabular" : "text-2xl font-semibold tabular line-through"}>{m(p.amountMinor)}</p>
        </div>
        <div className="mt-4 flex flex-wrap gap-2 border-t pt-4">
          <a href={`/print/receipts/${p.id}`} target="_blank" rel="noopener" className="inline-flex h-10 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium hover:bg-muted md:h-9">
            <PrinterIcon className="size-4" aria-hidden />
            {t("billing.printReceipt")}
          </a>
          {posted && data.unappliedMinor > 0 && can(ctx, "payment.refund") ? <RefundButton paymentId={p.id} symbol={fmt.symbol} /> : null}
          {posted && data.refundedMinor === 0 && can(ctx, "payment.reverse") ? <ReversePaymentButton paymentId={p.id} /> : null}
        </div>
      </header>
      {!posted && p.reversalReason ? <p className="mb-4 text-sm text-destructive">{p.reversalReason}</p> : null}
      <div className="grid gap-4 lg:grid-cols-2">
        <dl className="grid gap-3 rounded-xl border bg-card p-4 text-sm">
          {rows.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="text-end tabular">{v}</dd>
            </div>
          ))}
        </dl>
        <section className="rounded-xl border bg-card p-4 text-sm">
          <h2 className="mb-2 font-semibold">{t("billing.allocatedTo")}</h2>
          {data.allocations.length === 0 ? (
            <p className="text-muted-foreground">—</p>
          ) : (
            <ul className="divide-y">
              {data.allocations.map((a) => (
                <li key={a.invoiceId} className="flex justify-between py-2">
                  <Link href={`/invoices/${a.invoiceId}`} className="font-medium text-primary hover:underline tabular">
                    {a.number}
                  </Link>
                  <span className="tabular">{m(a.amountMinor)}</span>
                </li>
              ))}
            </ul>
          )}
          {data.refunds.length ? (
            <>
              <h2 className="mt-4 mb-2 font-semibold">{t("billing.refunds")}</h2>
              <ul className="divide-y">
                {data.refunds.map((r) => (
                  <li key={r.id} className="flex justify-between gap-3 py-2">
                    <span>
                      {formatDateOnly(r.refundedOn)} · {t(`billing.methods.${r.method}`)}
                      <span className="block text-xs text-muted-foreground">{r.reason}</span>
                    </span>
                    <span className="tabular">−{m(r.amountMinor)}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </section>
      </div>
    </>
  );
}
