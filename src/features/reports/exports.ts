import "server-only";
import { currencyExponent } from "@/lib/money";
import type { ExportSheet } from "@/lib/export/table";
import type { LocalizedText } from "@/server/db/schema/_shared";
import type { AgingReport } from "./aging";
import type { Report } from "./server";

type T = (key: string, values?: Record<string, string | number>) => string;

/** Builds the export sheets of a daily/monthly report from the same data as the screen. */
export function reportSheets(report: Report, t: T, label: (n: LocalizedText) => string): ExportSheet[] {
  const exp = currencyExponent(report.currency);
  const sheets: ExportSheet[] = [];
  const f = report.finance;
  const summary: ExportSheet = {
    name: t("reports.export.summary"),
    moneyExponent: exp,
    columns: [
      { header: t("reports.export.metric"), kind: "text" },
      { header: t("billing.amount"), kind: "money" },
      { header: t("reports.export.basis"), kind: "text" },
    ],
    rows: [
      [t("reports.kpi.production"), report.productionMinor, t("reports.kpi.productionBasis")],
      [t("reports.kpi.unbilled"), report.unbilledMinor, t("reports.kpi.unbilledBasis")],
      ...(f
        ? ([
            [t("reports.kpi.invoiced"), f.invoicedSalesMinor, t("reports.kpi.invoicedBasis")],
            [t("reports.kpi.received"), f.grossReceivedMinor, t("reports.kpi.receivedBasis")],
            [t("reports.refunded"), f.refundsMinor, ""],
            [t("reports.kpi.net"), f.netCollectionsMinor, t("reports.kpi.netBasis")],
          ] as [string, number, string][])
        : []),
    ],
  };
  sheets.push(summary);
  sheets.push({
    name: t("reports.export.procedures"),
    moneyExponent: exp,
    columns: [
      { header: t("billing.serviceDate"), kind: "date" },
      { header: t("patients.columns.number"), kind: "text" },
      { header: t("billing.patient"), kind: "text" },
      { header: t("catalog.columns.code"), kind: "text" },
      { header: t("billing.service"), kind: "text" },
      { header: t("billing.tooth"), kind: "text" },
      { header: t("billing.provider"), kind: "text" },
      { header: t("billing.qty"), kind: "number" },
      { header: t("billing.unitPrice"), kind: "money" },
      { header: t("billing.amount"), kind: "money" },
      { header: t("billing.number"), kind: "text" },
    ],
    rows: report.procedures.map((p) => [
      p.serviceDate,
      p.patientNumber,
      p.patientName,
      p.code,
      label(p.name),
      p.toothNumber,
      p.providerName,
      p.quantity,
      p.unitPriceMinor,
      p.amountMinor,
      p.invoiceNumber ?? (p.invoiceId ? t("reports.draft") : t("reports.unbilledGroup")),
    ]),
  });
  if (f) {
    sheets.push({
      name: t("reports.export.invoices"),
      moneyExponent: exp,
      columns: [
        { header: t("billing.number"), kind: "text" },
        { header: t("billing.date"), kind: "date" },
        { header: t("billing.patient"), kind: "text" },
        { header: t("billing.subtotal"), kind: "money" },
        { header: t("billing.tax"), kind: "money" },
        { header: t("billing.total"), kind: "money" },
        { header: t("reports.paidToDate"), kind: "money" },
        { header: t("billing.balance"), kind: "money" },
        { header: t("billing.status"), kind: "text" },
      ],
      rows: f.invoices.map((i) => [
        i.number,
        i.documentDate,
        i.patientName,
        i.subtotalMinor - i.discountMinor,
        i.taxMinor,
        i.totalMinor,
        i.paidMinor,
        i.balanceMinor,
        t(`billing.state.${i.status === "void" ? "void" : i.balanceMinor <= 0 ? "paid" : i.paidMinor > 0 || i.creditedMinor > 0 ? "partial" : "unpaid"}`),
      ]),
    });
    sheets.push({
      name: t("reports.export.payments"),
      moneyExponent: exp,
      columns: [
        { header: t("billing.receiptNumber"), kind: "text" },
        { header: t("billing.receivedOn"), kind: "date" },
        { header: t("billing.patient"), kind: "text" },
        { header: t("billing.method"), kind: "text" },
        { header: t("reports.export.type"), kind: "text" },
        { header: t("billing.amount"), kind: "money" },
      ],
      rows: f.payments.map((p) => [p.receiptNumber, p.receivedOn, p.patientName, t(`billing.methods.${p.method}`), t(`billing.purpose.${p.purpose}`), p.amountMinor]),
    });
    sheets.push({
      name: t("reports.export.refunds"),
      moneyExponent: exp,
      columns: [
        { header: t("billing.date"), kind: "date" },
        { header: t("billing.receiptNumber"), kind: "text" },
        { header: t("billing.method"), kind: "text" },
        { header: t("billing.creditReason"), kind: "text" },
        { header: t("billing.amount"), kind: "money" },
      ],
      rows: f.refunds.map((r) => [r.refundedOn, r.receiptNumber, t(`billing.methods.${r.method}`), r.reason, r.amountMinor]),
    });
    sheets.push({
      name: t("reports.creditsTitle"),
      moneyExponent: exp,
      columns: [
        { header: t("billing.number"), kind: "text" },
        { header: t("billing.date"), kind: "date" },
        { header: t("reports.export.invoice"), kind: "text" },
        { header: t("billing.creditReason"), kind: "text" },
        { header: t("billing.amount"), kind: "money" },
      ],
      rows: f.credits.map((c) => [c.number, c.documentDate, c.invoiceNumber, c.reason, c.amountMinor]),
    });
  }
  return sheets;
}

export function agingSheet(aging: AgingReport, t: T): ExportSheet {
  return {
    name: t("aging.title"),
    moneyExponent: currencyExponent(aging.currency),
    columns: [
      { header: t("patients.columns.number"), kind: "text" },
      { header: t("billing.patient"), kind: "text" },
      { header: t("patients.columns.phone"), kind: "text" },
      { header: t("aging.buckets.current"), kind: "money" },
      { header: t("aging.buckets.d31_60"), kind: "money" },
      { header: t("aging.buckets.d61_90"), kind: "money" },
      { header: t("aging.buckets.over90"), kind: "money" },
      { header: t("billing.total"), kind: "money" },
    ],
    rows: [
      ...aging.patients.map((p) => [p.patientNumber, p.name, p.phone, p.buckets.current, p.buckets.d31_60, p.buckets.d61_90, p.buckets.over90, p.total]),
      [null, t("reports.grandTotal"), null, aging.totals.current, aging.totals.d31_60, aging.totals.d61_90, aging.totals.over90, aging.grandTotal],
    ],
  };
}
