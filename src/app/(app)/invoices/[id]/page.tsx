import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArrowLeftIcon, BanknoteIcon, PrinterIcon } from "lucide-react";
import { ForbiddenState } from "@/components/app/page-header";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  ApplyCreditButton,
  CreditNoteButton,
  DeleteDraftButton,
  IssueDraftButton,
  ReceivePaymentButton,
  VoidInvoiceButton,
} from "@/features/billing/components/billing-dialogs";
import { StateBadge } from "@/features/billing/components/state-badge";
import { pageFormat } from "@/features/billing/page-format";
import { getInvoice } from "@/features/billing/server";
import { patientDisplayName } from "@/features/patients/display";
import { formatDateOnly, todayInZone } from "@/lib/dates";
import { can, requireClinicContext } from "@/server/auth/context";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("billing"))("invoiceTitle") };
}

export default async function InvoicePage({ params }: PageProps<"/invoices/[id]">) {
  const { id } = await params;
  const ctx = await requireClinicContext();
  const t = await getTranslations();
  if (!can(ctx, "invoice.read")) return <ForbiddenState message={t("errors.forbiddenPage")} />;
  const data = await getInvoice(ctx, id);
  if (!data) notFound();
  const fmt = await pageFormat(ctx);
  const { invoice: inv, patient, lines, allocations, credits } = data;
  const m = (v: number) => fmt.money(v, inv.currency);
  const today = todayInZone(ctx.organization.timezone);

  return (
    <>
      <Link href={`/patients/${patient.id}?tab=finance`} className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeftIcon className="size-4 rtl:rotate-180" aria-hidden />
        <bdi>{patientDisplayName(patient)}</bdi>
      </Link>

      <header className="mb-4 rounded-xl border bg-card p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm text-muted-foreground">{t("billing.invoiceTitle")}</p>
            <h1 className="text-2xl font-semibold tracking-tight tabular">{inv.number ?? t("billing.draftNumber")}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              <bdi>{patientDisplayName(patient)}</bdi> · {patient.patientNumber}
              {inv.documentDate ? ` · ${t("billing.issuedOn", { date: formatDateOnly(inv.documentDate) })}` : ""}
            </p>
          </div>
          <div className="text-end">
            <StateBadge state={data.state} label={t(`billing.state.${data.state}`)} />
            <p className="mt-2 text-2xl font-semibold tabular">{m(inv.totalMinor)}</p>
            {inv.status === "issued" ? (
              <p className="text-sm text-muted-foreground">
                {t("billing.balance")}: <span className="font-semibold text-foreground tabular">{m(data.balanceMinor)}</span>
              </p>
            ) : null}
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2 border-t pt-4">
          {inv.status === "issued" && data.balanceMinor > 0 && can(ctx, "payment.receive") ? (
            <ReceivePaymentButton
              patientId={patient.id}
              allocateTo={inv.id}
              defaultAmountMinor={data.balanceMinor}
              currency={inv.currency}
              symbol={fmt.symbol}
              today={today}
              label={t("billing.receivePayment")}
              icon={<BanknoteIcon aria-hidden />}
            />
          ) : null}
          {inv.status === "draft" && can(ctx, "invoice.issue") ? <IssueDraftButton invoiceId={inv.id} /> : null}
          {inv.status === "draft" && can(ctx, "invoice.create") ? <DeleteDraftButton invoiceId={inv.id} /> : null}
          {inv.status !== "draft" ? (
            <a href={`/print/invoices/${inv.id}`} target="_blank" rel="noopener" className="inline-flex h-10 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium hover:bg-muted md:h-9">
              <PrinterIcon className="size-4" aria-hidden />
              {t("billing.print")}
            </a>
          ) : null}
          {inv.status === "issued" && data.balanceMinor > 0 && can(ctx, "credit_note.issue") ? <CreditNoteButton invoiceId={inv.id} symbol={fmt.symbol} /> : null}
          {inv.status === "issued" && data.paidMinor === 0 && data.creditedMinor === 0 && can(ctx, "invoice.void") ? <VoidInvoiceButton invoiceId={inv.id} /> : null}
        </div>
      </header>

      {inv.status === "draft" ? (
        <Alert className="mb-4">
          <AlertDescription>{t("billing.draftNotice")}</AlertDescription>
        </Alert>
      ) : null}
      {inv.status === "void" ? (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{t("billing.voidedNotice", { reason: inv.voidReason ?? "" })}</AlertDescription>
        </Alert>
      ) : null}

      {inv.status === "issued" && data.balanceMinor > 0 && data.availableCredit.length > 0 ? (
        <section className="mb-4 rounded-xl border border-success/40 bg-success/5 p-4">
          <h2 className="mb-2 text-sm font-semibold">{t("billing.availableCredit")}</h2>
          <ul className="space-y-2">
            {data.availableCredit.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="tabular">
                  {c.receiptNumber} · {m(c.unapplied)}
                </span>
                <ApplyCreditButton paymentId={c.id} invoiceId={inv.id} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="mb-4 overflow-hidden rounded-xl border bg-card">
        <h2 className="border-b px-4 py-3 text-sm font-semibold">{t("billing.lines")}</h2>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("billing.service")}</TableHead>
                <TableHead className="hidden sm:table-cell">{t("billing.serviceDate")}</TableHead>
                <TableHead className="text-end">{t("billing.qty")}</TableHead>
                <TableHead className="hidden text-end sm:table-cell">{t("billing.unitPrice")}</TableHead>
                <TableHead className="text-end">{t("billing.amount")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map(({ line, providerName, providerTitle }) => (
                <TableRow key={line.id}>
                  <TableCell className="whitespace-normal">
                    <bdi className="font-medium">{fmt.label(line.description.name)}</bdi>
                    <span className="block text-xs text-muted-foreground">
                      {line.description.code}
                      {line.toothNumber ? ` · ${t("billing.tooth")} ${line.toothNumber}` : ""}
                      {providerName ? <> · <bdi>{[providerTitle, providerName].filter(Boolean).join(" ")}</bdi></> : null}
                    </span>
                  </TableCell>
                  <TableCell className="hidden tabular sm:table-cell">{formatDateOnly(line.serviceDate)}</TableCell>
                  <TableCell className="text-end tabular">{line.quantity}</TableCell>
                  <TableCell className="hidden text-end tabular sm:table-cell">{m(line.unitPriceMinor)}</TableCell>
                  <TableCell className="text-end font-medium tabular">{m(line.totalMinor)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell colSpan={2} className="hidden sm:table-cell" />
                <TableCell colSpan={2} className="text-end">{t("billing.subtotal")}</TableCell>
                <TableCell className="text-end tabular">{m(inv.subtotalMinor - inv.discountMinor)}</TableCell>
              </TableRow>
              {inv.taxMinor ? (
                <TableRow>
                  <TableCell colSpan={2} className="hidden sm:table-cell" />
                  <TableCell colSpan={2} className="text-end">{t("billing.tax")}</TableCell>
                  <TableCell className="text-end tabular">{m(inv.taxMinor)}</TableCell>
                </TableRow>
              ) : null}
              <TableRow>
                <TableCell colSpan={2} className="hidden sm:table-cell" />
                <TableCell colSpan={2} className="text-end font-semibold">{t("billing.total")}</TableCell>
                <TableCell className="text-end font-semibold tabular">{m(inv.totalMinor)}</TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border bg-card p-4">
          <h2 className="mb-3 text-sm font-semibold">{t("billing.payments")}</h2>
          {allocations.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("billing.noPayments")}</p>
          ) : (
            <ul className="divide-y text-sm">
              {allocations.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3 py-2">
                  <span>
                    <Link href={`/payments/${a.paymentId}`} className="font-medium text-primary hover:underline tabular">
                      {a.receiptNumber}
                    </Link>
                    <span className="block text-xs text-muted-foreground">
                      {formatDateOnly(a.receivedOn)} · {t(`billing.methods.${a.method}`)}
                    </span>
                  </span>
                  <span className={a.amountMinor < 0 ? "text-destructive tabular" : "font-medium tabular"}>{m(a.amountMinor)}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 flex justify-between border-t pt-3 text-sm">
            <span>{t("billing.paid")}</span>
            <span className="font-semibold tabular">{m(data.paidMinor)}</span>
          </p>
        </section>
        <section className="rounded-xl border bg-card p-4">
          <h2 className="mb-3 text-sm font-semibold">{t("billing.creditNotes")}</h2>
          {credits.length === 0 ? (
            <p className="text-sm text-muted-foreground">—</p>
          ) : (
            <ul className="divide-y text-sm">
              {credits.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 py-2">
                  <span>
                    <span className="font-medium tabular">{c.number}</span>
                    <span className="block text-xs text-muted-foreground">
                      {formatDateOnly(c.documentDate)} · {c.reason}
                    </span>
                  </span>
                  <span className="font-medium tabular">−{m(c.amountMinor)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
