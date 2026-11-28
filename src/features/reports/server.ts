import "server-only";
import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import { can, ForbiddenError, tenantTx, type ClinicContext } from "@/server/auth/context";
import { mainSiteId } from "@/server/sites";
import {
  branches,
  creditNotes,
  encounters,
  invoiceLines,
  invoices,
  memberships,
  patients,
  payments,
  performedProcedures,
  refunds,
} from "@/server/db/schema";
import type { LocalizedText } from "@/server/db/schema/_shared";
import { invoiceCreditedSql, invoicePaidSql } from "@/features/billing/sql";

/**
 * Report definitions (§18). Every figure is computed from ledger rows:
 * - production: completed procedures (qty × unit price, excl. tax) by SERVICE date;
 *   reversed / entered-in-error procedures are excluded and counted separately.
 * - invoiced sales: issued invoices (excl. tax) by DOCUMENT date, less credit notes by credit-note date;
 *   drafts and void invoices excluded.
 * - gross funds received: posted payments by RECEIPT date (deposits included; applying a deposit is not a receipt).
 * - refunds: by refund date. Net collections = gross funds received − refunds.
 * Amounts are in the clinic's single currency; mixed currencies are reported separately (never summed).
 */

export type Period = { from: string; to: string };

function requireReports(ctx: ClinicContext) {
  if (!can(ctx, "report.operational") && !can(ctx, "report.financial")) throw new ForbiddenError("report.operational");
}

type ProcRow = {
  id: string;
  serviceDate: string;
  code: string;
  name: LocalizedText;
  toothNumber: string | null;
  quantity: number;
  unitPriceMinor: number;
  amountMinor: number;
  currency: string;
  patientId: string;
  patientNumber: string;
  patientName: string;
  providerId: string;
  /** Site of the visit (null = recorded before sites: the main site). */
  siteId: string | null;
  providerName: string;
  invoiceId: string | null;
  invoiceNumber: string | null;
  invoiceStatus: "draft" | "issued" | "void" | null;
};

async function loadProcedures(ctx: ClinicContext, p: Period) {
  return tenantTx(ctx, async (tx) => {
    const rows = await tx
      .select({
        id: performedProcedures.id,
        serviceDate: performedProcedures.serviceDate,
        snapshot: performedProcedures.serviceSnapshot,
        toothNumber: performedProcedures.toothNumber,
        quantity: performedProcedures.quantity,
        unitPriceMinor: performedProcedures.unitPriceMinor,
        currency: performedProcedures.currency,
        status: performedProcedures.status,
        patientId: patients.id,
        patientNumber: patients.patientNumber,
        firstName: patients.firstName,
        lastName: patients.lastName,
        providerId: memberships.id,
        providerName: memberships.displayName,
        providerTitle: memberships.title,
        siteId: encounters.branchId,
        invoiceId: invoices.id,
        invoiceNumber: invoices.number,
        invoiceStatus: invoices.status,
      })
      .from(performedProcedures)
      .innerJoin(patients, eq(patients.id, performedProcedures.patientId))
      .innerJoin(memberships, eq(memberships.id, performedProcedures.performingProviderId))
      .leftJoin(encounters, eq(encounters.id, performedProcedures.encounterId))
      .leftJoin(invoiceLines, and(eq(invoiceLines.performedProcedureId, performedProcedures.id), eq(invoiceLines.released, false)))
      .leftJoin(invoices, eq(invoices.id, invoiceLines.invoiceId))
      .where(and(gte(performedProcedures.serviceDate, p.from), lte(performedProcedures.serviceDate, p.to)))
      .orderBy(asc(performedProcedures.serviceDate), asc(invoices.number), asc(performedProcedures.createdAt));
    const completed: ProcRow[] = [];
    let reversedCount = 0;
    for (const r of rows) {
      if (r.status !== "completed") {
        reversedCount += 1;
        continue;
      }
      completed.push({
        id: r.id,
        serviceDate: r.serviceDate,
        code: r.snapshot.code,
        name: r.snapshot.name,
        toothNumber: r.toothNumber,
        quantity: r.quantity,
        unitPriceMinor: r.unitPriceMinor,
        amountMinor: r.quantity * r.unitPriceMinor,
        currency: r.currency,
        patientId: r.patientId,
        patientNumber: r.patientNumber,
        patientName: `${r.lastName.toUpperCase()} ${r.firstName}`,
        providerId: r.providerId,
        providerName: [r.providerTitle, r.providerName].filter(Boolean).join(" "),
        siteId: r.siteId,
        invoiceId: r.invoiceId,
        invoiceNumber: r.invoiceNumber,
        invoiceStatus: r.invoiceStatus,
      });
    }
    return { procedures: completed, reversedCount };
  });
}

async function loadFinance(ctx: ClinicContext, p: Period) {
  return tenantTx(ctx, async (tx) => {
    const invoiceRows = await tx
      .select({
        id: invoices.id,
        number: invoices.number,
        status: invoices.status,
        documentDate: invoices.documentDate,
        subtotalMinor: invoices.subtotalMinor,
        discountMinor: invoices.discountMinor,
        taxMinor: invoices.taxMinor,
        totalMinor: invoices.totalMinor,
        currency: invoices.currency,
        paidMinor: invoicePaidSql,
        creditedMinor: invoiceCreditedSql,
        patientNumber: patients.patientNumber,
        firstName: patients.firstName,
        lastName: patients.lastName,
      })
      .from(invoices)
      .innerJoin(patients, eq(patients.id, invoices.patientId))
      .where(and(inArray(invoices.status, ["issued", "void"]), gte(invoices.documentDate, p.from), lte(invoices.documentDate, p.to)))
      .orderBy(asc(invoices.documentDate), asc(invoices.number));
    const credits = await tx
      .select({ id: creditNotes.id, number: creditNotes.number, documentDate: creditNotes.documentDate, amountMinor: creditNotes.amountMinor, currency: creditNotes.currency, invoiceNumber: invoices.number, reason: creditNotes.reason })
      .from(creditNotes)
      .innerJoin(invoices, eq(invoices.id, creditNotes.invoiceId))
      .where(and(gte(creditNotes.documentDate, p.from), lte(creditNotes.documentDate, p.to)))
      .orderBy(asc(creditNotes.documentDate), asc(creditNotes.number));
    const paymentRows = await tx
      .select({
        id: payments.id,
        receiptNumber: payments.receiptNumber,
        receivedOn: payments.receivedOn,
        method: payments.method,
        purpose: payments.purpose,
        amountMinor: payments.amountMinor,
        currency: payments.currency,
        siteId: payments.branchId,
        patientNumber: patients.patientNumber,
        firstName: patients.firstName,
        lastName: patients.lastName,
      })
      .from(payments)
      .innerJoin(patients, eq(patients.id, payments.patientId))
      .where(and(eq(payments.status, "posted"), gte(payments.receivedOn, p.from), lte(payments.receivedOn, p.to)))
      .orderBy(asc(payments.receivedOn), asc(payments.receiptNumber));
    const refundRows = await tx
      .select({ id: refunds.id, refundedOn: refunds.refundedOn, method: refunds.method, amountMinor: refunds.amountMinor, currency: payments.currency, receiptNumber: payments.receiptNumber, reason: refunds.reason, siteId: refunds.branchId })
      .from(refunds)
      .innerJoin(payments, eq(payments.id, refunds.paymentId))
      .where(and(gte(refunds.refundedOn, p.from), lte(refunds.refundedOn, p.to)))
      .orderBy(asc(refunds.refundedOn));
    return {
      invoices: invoiceRows.map((r) => ({
        ...r,
        paidMinor: Number(r.paidMinor),
        creditedMinor: Number(r.creditedMinor),
        balanceMinor: r.status === "issued" ? r.totalMinor - Number(r.paidMinor) - Number(r.creditedMinor) : 0,
        patientName: `${r.lastName.toUpperCase()} ${r.firstName}`,
      })),
      credits,
      payments: paymentRows.map((r) => ({ ...r, patientName: `${r.lastName.toUpperCase()} ${r.firstName}` })),
      refunds: refundRows,
    };
  });
}

const sum = <T>(rows: T[], f: (r: T) => number) => rows.reduce((s, r) => s + f(r), 0);

export async function getReport(ctx: ClinicContext, period: Period) {
  requireReports(ctx);
  const currency = ctx.organization.defaultCurrency;
  const { procedures, reversedCount } = await loadProcedures(ctx, period);
  const showFinance = can(ctx, "report.financial");
  const fin = showFinance ? await loadFinance(ctx, period) : null;
  const inCurrency = <T extends { currency: string }>(rows: T[]) => rows.filter((r) => r.currency === currency);
  const otherCurrencies = new Set<string>();
  for (const r of [...procedures, ...(fin?.invoices ?? []), ...(fin?.payments ?? [])]) if (r.currency !== currency) otherCurrencies.add(r.currency);

  const procs = inCurrency(procedures);
  const productionMinor = sum(procs, (r) => r.amountMinor);

  // Procedures grouped by invoice: each invoice's total appears once.
  const groups = new Map<string, { invoiceId: string | null; invoiceNumber: string | null; invoiceStatus: string | null; lines: ProcRow[] }>();
  for (const r of procs) {
    const key = r.invoiceId ?? "unbilled";
    if (!groups.has(key)) groups.set(key, { invoiceId: r.invoiceId, invoiceNumber: r.invoiceNumber, invoiceStatus: r.invoiceStatus, lines: [] });
    groups.get(key)!.lines.push(r);
  }
  const grouped = [...groups.values()].sort((a, b) => (a.invoiceId ? 0 : 1) - (b.invoiceId ? 0 : 1) || (a.invoiceNumber ?? "").localeCompare(b.invoiceNumber ?? ""));
  const unbilledMinor = sum(groups.get("unbilled")?.lines ?? [], (r) => r.amountMinor);

  // Production by service and by provider.
  const byService = new Map<string, { code: string; name: LocalizedText; count: number; amountMinor: number }>();
  const byProvider = new Map<string, { name: string; count: number; amountMinor: number }>();
  for (const r of procs) {
    const s = byService.get(r.code) ?? { code: r.code, name: r.name, count: 0, amountMinor: 0 };
    s.count += r.quantity;
    s.amountMinor += r.amountMinor;
    byService.set(r.code, s);
    const pv = byProvider.get(r.providerId) ?? { name: r.providerName, count: 0, amountMinor: 0 };
    pv.count += r.quantity;
    pv.amountMinor += r.amountMinor;
    byProvider.set(r.providerId, pv);
  }

  let finance = null;
  if (fin) {
    const issued = inCurrency(fin.invoices).filter((i) => i.status === "issued");
    const credits = inCurrency(fin.credits);
    const pays = inCurrency(fin.payments);
    const refs = inCurrency(fin.refunds);
    const invoicedNetMinor = sum(issued, (i) => i.subtotalMinor - i.discountMinor);
    const creditsMinor = sum(credits, (c) => c.amountMinor);
    const grossReceivedMinor = sum(pays, (p) => p.amountMinor);
    const refundsMinor = sum(refs, (r) => r.amountMinor);
    const byMethod = new Map<string, { method: string; receivedMinor: number; refundedMinor: number; count: number }>();
    for (const p of pays) {
      const m = byMethod.get(p.method) ?? { method: p.method, receivedMinor: 0, refundedMinor: 0, count: 0 };
      m.receivedMinor += p.amountMinor;
      m.count += 1;
      byMethod.set(p.method, m);
    }
    for (const r of refs) {
      const m = byMethod.get(r.method) ?? { method: r.method, receivedMinor: 0, refundedMinor: 0, count: 0 };
      m.refundedMinor += r.amountMinor;
      byMethod.set(r.method, m);
    }
    finance = {
      invoices: fin.invoices,
      credits: fin.credits,
      payments: fin.payments,
      refunds: fin.refunds,
      invoicedSalesMinor: invoicedNetMinor - creditsMinor,
      invoicedTaxMinor: sum(issued, (i) => i.taxMinor),
      invoicedTotalMinor: sum(issued, (i) => i.totalMinor),
      creditsMinor,
      grossReceivedMinor,
      depositsMinor: sum(pays.filter((p) => p.purpose === "advance_deposit"), (p) => p.amountMinor),
      refundsMinor,
      netCollectionsMinor: grossReceivedMinor - refundsMinor,
      issuedPaidToDateMinor: sum(issued, (i) => i.paidMinor),
      issuedBalanceMinor: sum(issued, (i) => i.balanceMinor),
      byMethod: [...byMethod.values()].sort((a, b) => b.receivedMinor - a.receivedMinor),
    };
  }

  // Per-day breakdown (used by the monthly view).
  const days = new Map<string, { date: string; productionMinor: number; invoicedMinor: number; receivedMinor: number; refundedMinor: number }>();
  const day = (d: string) => days.get(d) ?? days.set(d, { date: d, productionMinor: 0, invoicedMinor: 0, receivedMinor: 0, refundedMinor: 0 }).get(d)!;
  for (const r of procs) day(r.serviceDate).productionMinor += r.amountMinor;
  if (fin) {
    for (const i of inCurrency(fin.invoices)) if (i.status === "issued" && i.documentDate) day(i.documentDate).invoicedMinor += i.subtotalMinor - i.discountMinor;
    for (const c of inCurrency(fin.credits)) day(c.documentDate).invoicedMinor -= c.amountMinor;
    for (const p of inCurrency(fin.payments)) day(p.receivedOn).receivedMinor += p.amountMinor;
    for (const r of inCurrency(fin.refunds)) day(r.refundedOn).refundedMinor += r.amountMinor;
  }

  // Per site (clinic groups): production by the site of the visit, net collections by the site that took the money.
  const sites = ctx.sites.length > 1
    ? await tenantTx(ctx, async (tx) => ({
        main: await mainSiteId(tx),
        rows: await tx.select({ id: branches.id, name: branches.name }).from(branches).orderBy(asc(branches.createdAt), asc(branches.id)),
      }))
    : null;
  const bySite = sites
    ? sites.rows.map((b) => {
        const mine = (id: string | null) => (id ?? sites.main) === b.id;
        return {
          siteId: b.id,
          name: b.name,
          productionMinor: sum(procs.filter((r) => mine(r.siteId)), (r) => r.amountMinor),
          collectedMinor: fin
            ? sum(inCurrency(fin.payments).filter((r) => mine(r.siteId)), (r) => r.amountMinor) - sum(inCurrency(fin.refunds).filter((r) => mine(r.siteId)), (r) => r.amountMinor)
            : null,
        };
      }).filter((s) => s.productionMinor !== 0 || (s.collectedMinor ?? 0) !== 0 || ctx.sites.some((a) => a.id === s.siteId))
    : [];

  return {
    period,
    currency,
    bySite,
    otherCurrencies: [...otherCurrencies],
    generatedAt: new Date(),
    procedures: procs,
    reversedCount,
    productionMinor,
    unbilledMinor,
    grouped,
    byService: [...byService.values()].sort((a, b) => b.amountMinor - a.amountMinor),
    byProvider: [...byProvider.values()].sort((a, b) => b.amountMinor - a.amountMinor),
    days: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)),
    finance,
  };
}

export type Report = Awaited<ReturnType<typeof getReport>>;

/** Inclusive date bounds of a YYYY-MM month. */
export function monthPeriod(month: string): Period | null {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  if (mo < 1 || mo > 12) return null;
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return { from: `${m[1]}-${m[2]}-01`, to: `${m[1]}-${m[2]}-${String(last).padStart(2, "0")}` };
}

