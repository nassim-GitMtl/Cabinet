import "server-only";
import { and, asc, desc, eq, gte, inArray, isNull, lte, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { audit } from "@/server/audit";
import { can, requirePermission, tenantTx, ForbiddenError, type ClinicContext } from "@/server/auth/context";
import type { Tx } from "@/server/db/client";
import {
  honorariumEntries,
  honorariumPayments,
  honorariumPeriodClosures,
  invoiceLines,
  invoices,
  memberships,
  patients,
  providerServiceTermHistory,
  providerServiceTerms,
  serviceCategories,
  services,
} from "@/server/db/schema";
import { parseDateOnly, todayInZone } from "@/lib/dates";
import { assertCashDayOpen } from "@/features/cash/server";
import { currentSiteId, mainSiteId } from "@/server/sites";
import { invoiceCreditedSql, invoicePaidSql } from "@/features/billing/sql";
import { withTitle } from "@/features/activity/server";
import { calculateHonorarium, isValidRule, resolveRule, type FeeRule } from "./calculation";

/**
 * Practitioner fees ("honoraires"). The share of each billed act is frozen in an append-only ledger when the
 * invoice is issued (snapshotInvoiceHonoraria). What a practitioner can be paid follows what the patient paid:
 * payable = share x min(paid, invoice net of credit notes) / invoice total. Payments to practitioners and month
 * closures are append-only too; mistakes are corrected with reversal and adjustment rows.
 */

export type HonorariumErrorCode =
  | "providerUnavailable"
  | "serviceUnavailable"
  | "invalidRule"
  | "invalidAmount"
  | "invalidDate"
  | "invalidPeriod"
  | "periodClosed"
  | "periodNotEnded"
  | "lineUnavailable"
  | "alreadyRecorded"
  | "invalidAdjustment"
  | "reasonRequired"
  | "paymentUnavailable"
  | "alreadyReversed";

export class HonorariumError extends Error {
  constructor(public readonly code: HonorariumErrorCode) {
    super(code);
  }
}

export type PayoutMethod = "cash" | "card" | "bank_transfer" | "cheque" | "other";
export const PAYOUT_METHODS: readonly PayoutMethod[] = ["cash", "card", "bank_transfer", "cheque", "other"];

const staff = (ctx: ClinicContext) => ({ organizationId: ctx.organizationId, actorType: "staff" as const, actorUserId: ctx.userId });
const monthStart = (date: string) => `${date.slice(0, 7)}-01`;

// ---------------------------------------------------------------------------
// Who sees what
// ---------------------------------------------------------------------------

const ANY_HONORARIUM = ["honorarium.read.all", "honorarium.manage", "honorarium.pay", "honorarium.close"] as const;

/** Practitioners whose fees this user may see: everyone, or only themself (honorarium.read.own). */
function readScope(ctx: ClinicContext, requested?: string | null): { providerId: string | null } {
  if (ANY_HONORARIUM.some((p) => can(ctx, p))) return { providerId: requested || null };
  if (can(ctx, "honorarium.read.own")) return { providerId: ctx.membershipId };
  throw new ForbiddenError("honorarium.read.own");
}

export function canSeeHonoraria(ctx: ClinicContext) {
  return can(ctx, "honorarium.read.own") || ANY_HONORARIUM.some((p) => can(ctx, p));
}

async function requireProvider(tx: Tx, providerId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(providerId)) throw new HonorariumError("providerUnavailable");
  const [provider] = await tx
    .select({ id: memberships.id, displayName: memberships.displayName, title: memberships.title, specialty: memberships.specialty, defaultFeeRateBp: memberships.defaultFeeRateBp })
    .from(memberships)
    .where(and(eq(memberships.id, providerId), eq(memberships.isProvider, true)))
    .limit(1);
  if (!provider) throw new HonorariumError("providerUnavailable");
  return provider;
}

/** A practitioner/service rule, or null when it falls back to the practitioner's default percentage. */
export function termRule(term: { ruleType: FeeRule["type"] | null; ruleValue: number | null } | undefined | null): FeeRule | null {
  return term?.ruleType && term.ruleValue !== null ? { type: term.ruleType, value: term.ruleValue } : null;
}

async function monthClosed(tx: Tx, providerId: string, date: string) {
  const [closed] = await tx
    .select({ id: honorariumPeriodClosures.id })
    .from(honorariumPeriodClosures)
    .where(and(eq(honorariumPeriodClosures.providerId, providerId), eq(honorariumPeriodClosures.periodMonth, monthStart(date))))
    .limit(1);
  return Boolean(closed);
}

/** The day a fee counts in: its own date, or today when that month is already closed for the practitioner. */
async function openDate(tx: Tx, providerId: string, date: string, today: string) {
  return (await monthClosed(tx, providerId, date)) ? today : date;
}

// ---------------------------------------------------------------------------
// Ledger entries
// ---------------------------------------------------------------------------

/**
 * Freezes the practitioner share of every line of an invoice that was just issued. Runs inside the issue
 * transaction (the caller holds invoice.issue); a line without a practitioner gets no entry.
 */
export async function snapshotInvoiceHonoraria(tx: Tx, ctx: ClinicContext, invoiceId: string) {
  const [inv] = await tx
    .select({ patientId: invoices.patientId, status: invoices.status, currency: invoices.currency })
    .from(invoices)
    .where(eq(invoices.id, invoiceId))
    .limit(1);
  if (!inv || inv.status !== "issued") return;
  const lines = await tx
    .select({ line: invoiceLines, deductLab: services.deductLabBeforeShare })
    .from(invoiceLines)
    .leftJoin(services, eq(services.id, invoiceLines.serviceId))
    .where(eq(invoiceLines.invoiceId, invoiceId))
    .orderBy(asc(invoiceLines.sortOrder));
  const billed = lines.filter((l) => l.line.providerId);
  if (!billed.length) return;

  const providerIds = [...new Set(billed.map((l) => l.line.providerId!))];
  const [people, terms, recorded, closures] = await Promise.all([
    // Any membership: a practitioner who left keeps the fees for the acts they performed.
    tx.select({ id: memberships.id, displayName: memberships.displayName, title: memberships.title, specialty: memberships.specialty, defaultFeeRateBp: memberships.defaultFeeRateBp })
      .from(memberships)
      .where(inArray(memberships.id, providerIds)),
    tx.select().from(providerServiceTerms).where(inArray(providerServiceTerms.providerId, providerIds)),
    tx.select({ lineId: honorariumEntries.invoiceLineId })
      .from(honorariumEntries)
      .where(and(eq(honorariumEntries.invoiceId, invoiceId), inArray(honorariumEntries.kind, ["earned", "backfill"]))),
    tx.select({ providerId: honorariumPeriodClosures.providerId, month: honorariumPeriodClosures.periodMonth })
      .from(honorariumPeriodClosures)
      .where(inArray(honorariumPeriodClosures.providerId, providerIds)),
  ]);
  const done = new Set(recorded.map((r) => r.lineId));
  const closed = new Set(closures.map((c) => `${c.providerId}:${c.month}`));
  const today = todayInZone(ctx.organization.timezone);

  const values = billed
    .filter(({ line }) => !done.has(line.id))
    .map(({ line, deductLab }) => {
      const provider = people.find((p) => p.id === line.providerId);
      if (!provider) throw new HonorariumError("providerUnavailable");
      const term = terms.find((t) => t.providerId === provider.id && t.serviceId === line.serviceId);
      const lineRule = line.honorariumRuleType && line.honorariumRuleValue !== null
        ? { type: line.honorariumRuleType as FeeRule["type"], value: line.honorariumRuleValue }
        : null;
      const rule = resolveRule(lineRule, termRule(term), provider.defaultFeeRateBp);
      const deductLabBeforeShare = deductLab ?? false;
      const calc = calculateHonorarium({
        unitPriceMinor: line.unitPriceMinor,
        quantity: line.quantity,
        discountMinor: line.discountMinor,
        labFeeMinor: line.labFeeMinor,
        deductLabBeforeShare,
        rule,
      });
      return {
        organizationId: ctx.organizationId,
        invoiceId,
        invoiceLineId: line.id,
        patientId: inv.patientId,
        providerId: provider.id,
        providerSnapshot: { displayName: provider.displayName, title: provider.title, specialty: provider.specialty },
        serviceSnapshot: line.description,
        kind: "earned" as const,
        effectiveDate: closed.has(`${provider.id}:${monthStart(line.serviceDate)}`) ? today : line.serviceDate,
        currency: inv.currency,
        unitPriceMinor: line.unitPriceMinor,
        quantity: line.quantity,
        discountMinor: line.discountMinor,
        labFeeMinor: line.labFeeMinor,
        deductLabBeforeShare,
        ...calc,
        ruleType: rule.type,
        ruleValue: rule.value,
        reason: line.honorariumOverrideReason,
        createdByUserId: ctx.userId,
      };
    });
  if (values.length) await tx.insert(honorariumEntries).values(values).onConflictDoNothing();
}

/** Issued invoice lines that have no fee entry yet (billed before practitioner fees were tracked). */
export async function listUnassignedLines(ctx: ClinicContext, f: { from: string; to: string }) {
  requirePermission(ctx, "honorarium.manage");
  return tenantTx(ctx, (tx) =>
    tx
      .select({
        id: invoiceLines.id,
        serviceId: invoiceLines.serviceId,
        description: invoiceLines.description,
        serviceDate: invoiceLines.serviceDate,
        unitPriceMinor: invoiceLines.unitPriceMinor,
        quantity: invoiceLines.quantity,
        discountMinor: invoiceLines.discountMinor,
        providerId: invoiceLines.providerId,
        currency: invoices.currency,
        invoiceNumber: invoices.number,
        patientFirstName: patients.firstName,
        patientLastName: patients.lastName,
        deductLabBeforeShare: services.deductLabBeforeShare,
      })
      .from(invoiceLines)
      .innerJoin(invoices, eq(invoices.id, invoiceLines.invoiceId))
      .innerJoin(patients, eq(patients.id, invoices.patientId))
      .leftJoin(services, eq(services.id, invoiceLines.serviceId))
      .leftJoin(honorariumEntries, and(eq(honorariumEntries.invoiceLineId, invoiceLines.id), inArray(honorariumEntries.kind, ["earned", "backfill"])))
      .where(and(eq(invoices.status, "issued"), gte(invoiceLines.serviceDate, f.from), lte(invoiceLines.serviceDate, f.to), isNull(honorariumEntries.id)))
      .orderBy(desc(invoiceLines.serviceDate), asc(invoiceLines.sortOrder))
      .limit(300),
  );
}

/** Assigns an old issued line to a practitioner (preview first in the UI; one line at a time, never automatic). */
export async function assignLineHonorarium(
  ctx: ClinicContext,
  input: { invoiceLineId: string; providerId: string; labFeeMinor: number; rule?: FeeRule | null; reason?: string | null },
) {
  requirePermission(ctx, "honorarium.manage");
  if (!Number.isSafeInteger(input.labFeeMinor) || input.labFeeMinor < 0) throw new HonorariumError("invalidAmount");
  if (input.rule && (!isValidRule(input.rule) || !input.reason?.trim())) throw new HonorariumError(input.rule && isValidRule(input.rule) ? "reasonRequired" : "invalidRule");
  return tenantTx(ctx, async (tx) => {
    const [row] = await tx
      .select({ line: invoiceLines, patientId: invoices.patientId, currency: invoices.currency, deductLab: services.deductLabBeforeShare })
      .from(invoiceLines)
      .innerJoin(invoices, eq(invoices.id, invoiceLines.invoiceId))
      .leftJoin(services, eq(services.id, invoiceLines.serviceId))
      .where(and(eq(invoiceLines.id, input.invoiceLineId), eq(invoices.status, "issued")))
      .limit(1);
    if (!row) throw new HonorariumError("lineUnavailable");
    const { line } = row;
    if (input.labFeeMinor > line.quantity * line.unitPriceMinor - line.discountMinor) throw new HonorariumError("invalidAmount");
    const provider = await requireProvider(tx, input.providerId);
    const [term] = line.serviceId
      ? await tx.select().from(providerServiceTerms)
          .where(and(eq(providerServiceTerms.providerId, provider.id), eq(providerServiceTerms.serviceId, line.serviceId)))
          .limit(1)
      : [];
    const rule = resolveRule(input.rule ?? null, termRule(term), provider.defaultFeeRateBp);
    const deductLabBeforeShare = row.deductLab ?? false;
    const calc = calculateHonorarium({ unitPriceMinor: line.unitPriceMinor, quantity: line.quantity, discountMinor: line.discountMinor, labFeeMinor: input.labFeeMinor, deductLabBeforeShare, rule });
    const today = todayInZone(ctx.organization.timezone);
    const [entry] = await tx
      .insert(honorariumEntries)
      .values({
        organizationId: ctx.organizationId,
        invoiceId: line.invoiceId,
        invoiceLineId: line.id,
        patientId: row.patientId,
        providerId: provider.id,
        providerSnapshot: { displayName: provider.displayName, title: provider.title, specialty: provider.specialty },
        serviceSnapshot: line.description,
        kind: "backfill",
        effectiveDate: await openDate(tx, provider.id, line.serviceDate, today),
        currency: row.currency,
        unitPriceMinor: line.unitPriceMinor,
        quantity: line.quantity,
        discountMinor: line.discountMinor,
        labFeeMinor: input.labFeeMinor,
        deductLabBeforeShare,
        ...calc,
        ruleType: rule.type,
        ruleValue: rule.value,
        reason: input.rule ? input.reason!.trim() : null,
        createdByUserId: ctx.userId,
      })
      .onConflictDoNothing()
      .returning({ id: honorariumEntries.id });
    if (!entry) throw new HonorariumError("alreadyRecorded");
    await audit(tx, {
      ...staff(ctx),
      action: "honorarium.line.assigned",
      entityType: "honorarium_entry",
      entityId: entry.id,
      patientId: row.patientId,
      metadata: { providerId: provider.id, invoiceLineId: line.id, physicianShareMinor: calc.physicianShareMinor },
    });
    return { id: entry.id, ...calc };
  });
}

/** Signed correction of a base entry; the corrected share stays between zero and the line amount. */
export async function adjustHonorarium(ctx: ClinicContext, input: { entryId: string; deltaMinor: number; reason: string }) {
  requirePermission(ctx, "honorarium.manage");
  if (!Number.isSafeInteger(input.deltaMinor) || input.deltaMinor === 0) throw new HonorariumError("invalidAdjustment");
  if (!input.reason.trim()) throw new HonorariumError("reasonRequired");
  return tenantTx(ctx, async (tx) => {
    const [base] = await tx
      .select({ entry: honorariumEntries, invoiceStatus: invoices.status })
      .from(honorariumEntries)
      .innerJoin(invoices, eq(invoices.id, honorariumEntries.invoiceId))
      .where(and(eq(honorariumEntries.id, input.entryId), inArray(honorariumEntries.kind, ["earned", "backfill"])))
      // The ledger is append-only (no row locks on it): lock the invoice so two corrections of a line run one by one.
      .for("update", { of: invoices })
      .limit(1);
    if (!base || base.invoiceStatus !== "issued") throw new HonorariumError("lineUnavailable");
    const [{ adjusted }] = await tx
      .select({ adjusted: sql<number>`coalesce(sum(${honorariumEntries.physicianShareMinor}), 0)`.mapWith(Number) })
      .from(honorariumEntries)
      .where(eq(honorariumEntries.adjustsEntryId, base.entry.id));
    const corrected = base.entry.physicianShareMinor + adjusted + input.deltaMinor;
    if (corrected < 0 || corrected > base.entry.lineAmountMinor) throw new HonorariumError("invalidAdjustment");
    const e = base.entry;
    const [row] = await tx
      .insert(honorariumEntries)
      .values({
        organizationId: ctx.organizationId,
        invoiceId: e.invoiceId,
        invoiceLineId: e.invoiceLineId,
        patientId: e.patientId,
        providerId: e.providerId,
        providerSnapshot: e.providerSnapshot,
        serviceSnapshot: e.serviceSnapshot,
        kind: "adjustment",
        adjustsEntryId: e.id,
        effectiveDate: await openDate(tx, e.providerId, e.effectiveDate, todayInZone(ctx.organization.timezone)),
        currency: e.currency,
        unitPriceMinor: e.unitPriceMinor,
        quantity: e.quantity,
        discountMinor: e.discountMinor,
        labFeeMinor: e.labFeeMinor,
        deductLabBeforeShare: e.deductLabBeforeShare,
        baseMinor: 0,
        lineAmountMinor: 0,
        ruleType: e.ruleType,
        ruleValue: e.ruleValue,
        physicianShareMinor: input.deltaMinor,
        clinicShareMinor: -input.deltaMinor,
        reason: input.reason.trim(),
        createdByUserId: ctx.userId,
      })
      .returning({ id: honorariumEntries.id, effectiveDate: honorariumEntries.effectiveDate });
    await audit(tx, {
      ...staff(ctx),
      action: "honorarium.adjusted",
      entityType: "honorarium_entry",
      entityId: row!.id,
      patientId: e.patientId,
      metadata: { adjustsEntryId: e.id, deltaMinor: input.deltaMinor, effectiveDate: row!.effectiveDate },
    });
    return row!.id;
  });
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const netSql = sql`greatest(${invoices.totalMinor} - ${invoiceCreditedSql}, 0)`;
/** Share net of credit notes on the invoice. */
const earnedSql = sql<number>`(case when ${invoices.totalMinor} > 0
  then round(${honorariumEntries.physicianShareMinor}::numeric * ${netSql} / ${invoices.totalMinor})
  else ${honorariumEntries.physicianShareMinor} end)`;
/** Share of what the patient actually paid. */
const payableSql = sql<number>`(case when ${invoices.totalMinor} > 0
  then round(${honorariumEntries.physicianShareMinor}::numeric * least(greatest(${invoicePaidSql}, 0), ${netSql}) / ${invoices.totalMinor})
  else ${honorariumEntries.physicianShareMinor} end)`;

export type HonorariumFilters = { providerId?: string | null; from: string; to: string };

export async function getHonorariumReport(ctx: ClinicContext, f: HonorariumFilters, opts: { rowLimit?: number } = {}) {
  const { providerId } = readScope(ctx, f.providerId);
  const from = parseDateOnly(f.from);
  const to = parseDateOnly(f.to);
  if (!from || !to || from > to) throw new HonorariumError("invalidPeriod");
  return tenantTx(ctx, async (tx) => {
    const byProvider = (column: AnyPgColumn): SQL | undefined => (providerId ? eq(column, providerId) : undefined);
    const inPeriod = and(
      eq(invoices.status, "issued"),
      gte(honorariumEntries.effectiveDate, from),
      lte(honorariumEntries.effectiveDate, to),
      byProvider(honorariumEntries.providerId),
    );

    const rowQuery = tx
      .select({
        id: honorariumEntries.id,
        kind: honorariumEntries.kind,
        adjustsEntryId: honorariumEntries.adjustsEntryId,
        effectiveDate: honorariumEntries.effectiveDate,
        providerId: honorariumEntries.providerId,
        providerSnapshot: honorariumEntries.providerSnapshot,
        serviceSnapshot: honorariumEntries.serviceSnapshot,
        currency: honorariumEntries.currency,
        lineAmountMinor: honorariumEntries.lineAmountMinor,
        labFeeMinor: honorariumEntries.labFeeMinor,
        baseMinor: honorariumEntries.baseMinor,
        ruleType: honorariumEntries.ruleType,
        ruleValue: honorariumEntries.ruleValue,
        physicianShareMinor: honorariumEntries.physicianShareMinor,
        clinicShareMinor: honorariumEntries.clinicShareMinor,
        reason: honorariumEntries.reason,
        earnedMinor: earnedSql.mapWith(Number),
        payableMinor: payableSql.mapWith(Number),
        invoiceId: invoices.id,
        invoiceNumber: invoices.number,
        patientId: patients.id,
        patientFirstName: patients.firstName,
        patientLastName: patients.lastName,
        patientNumber: patients.patientNumber,
      })
      .from(honorariumEntries)
      .innerJoin(invoices, eq(invoices.id, honorariumEntries.invoiceId))
      .innerJoin(patients, eq(patients.id, honorariumEntries.patientId))
      .where(inPeriod)
      .orderBy(desc(honorariumEntries.effectiveDate), desc(honorariumEntries.createdAt));
    const rows = await (opts.rowLimit ? rowQuery.limit(opts.rowLimit) : rowQuery);

    const periodByProvider = await tx
      .select({
        providerId: honorariumEntries.providerId,
        lines: sql<number>`count(*) filter (where ${honorariumEntries.kind} <> 'adjustment')`.mapWith(Number),
        producedMinor: sql<number>`coalesce(sum(${honorariumEntries.lineAmountMinor}), 0)`.mapWith(Number),
        earnedMinor: sql<number>`coalesce(sum(${earnedSql}), 0)`.mapWith(Number),
        payableMinor: sql<number>`coalesce(sum(${payableSql}), 0)`.mapWith(Number),
        clinicMinor: sql<number>`coalesce(sum(${honorariumEntries.clinicShareMinor}), 0)`.mapWith(Number),
      })
      .from(honorariumEntries)
      .innerJoin(invoices, eq(invoices.id, honorariumEntries.invoiceId))
      .where(inPeriod)
      .groupBy(honorariumEntries.providerId);

    const payments = await tx
      .select()
      .from(honorariumPayments)
      .where(and(gte(honorariumPayments.paidOn, from), lte(honorariumPayments.paidOn, to), byProvider(honorariumPayments.providerId)))
      .orderBy(desc(honorariumPayments.paidOn), desc(honorariumPayments.createdAt));
    const reversed = new Set(
      (await tx
        .select({ id: honorariumPayments.reversesPaymentId })
        .from(honorariumPayments)
        .where(and(sql`${honorariumPayments.reversesPaymentId} is not null`, byProvider(honorariumPayments.providerId))))
        .map((r) => r.id),
    );

    // Running balance, all time: what patients paid towards each practitioner's fees minus what was handed over.
    const [allTimeEarned, allTimePaid] = await Promise.all([
      tx
        .select({
          providerId: honorariumEntries.providerId,
          earnedMinor: sql<number>`coalesce(sum(${earnedSql}), 0)`.mapWith(Number),
          payableMinor: sql<number>`coalesce(sum(${payableSql}), 0)`.mapWith(Number),
        })
        .from(honorariumEntries)
        .innerJoin(invoices, eq(invoices.id, honorariumEntries.invoiceId))
        .where(and(eq(invoices.status, "issued"), byProvider(honorariumEntries.providerId)))
        .groupBy(honorariumEntries.providerId),
      tx
        .select({ providerId: honorariumPayments.providerId, paidMinor: sql<number>`coalesce(sum(${honorariumPayments.amountMinor}), 0)`.mapWith(Number) })
        .from(honorariumPayments)
        .where(byProvider(honorariumPayments.providerId))
        .groupBy(honorariumPayments.providerId),
    ]);

    const closures = await tx
      .select({ id: honorariumPeriodClosures.id, providerId: honorariumPeriodClosures.providerId, periodMonth: honorariumPeriodClosures.periodMonth, closedAt: honorariumPeriodClosures.closedAt, note: honorariumPeriodClosures.note })
      .from(honorariumPeriodClosures)
      .where(byProvider(honorariumPeriodClosures.providerId))
      .orderBy(desc(honorariumPeriodClosures.periodMonth))
      .limit(48);

    const providerIds = [...new Set([...periodByProvider, ...allTimeEarned, ...allTimePaid].map((r) => r.providerId))];
    const names = providerIds.length
      ? await tx.select({ id: memberships.id, displayName: memberships.displayName, title: memberships.title }).from(memberships).where(inArray(memberships.id, providerIds))
      : [];
    const nameOf = (id: string) => {
      const m = names.find((n) => n.id === id);
      return m ? [m.title, m.displayName].filter(Boolean).join(" ") : "";
    };

    const paidInPeriod = new Map<string, number>();
    for (const p of payments) paidInPeriod.set(p.providerId, (paidInPeriod.get(p.providerId) ?? 0) + p.amountMinor);
    const summary = providerIds
      .map((id) => {
        const period = periodByProvider.find((r) => r.providerId === id);
        const all = allTimeEarned.find((r) => r.providerId === id);
        const paidAll = allTimePaid.find((r) => r.providerId === id)?.paidMinor ?? 0;
        return {
          providerId: id,
          name: nameOf(id),
          lines: period?.lines ?? 0,
          producedMinor: period?.producedMinor ?? 0,
          earnedMinor: period?.earnedMinor ?? 0,
          payableMinor: period?.payableMinor ?? 0,
          clinicMinor: period?.clinicMinor ?? 0,
          paidMinor: paidInPeriod.get(id) ?? 0,
          /** All time: collected share not yet handed over (negative = advance paid). */
          balanceMinor: (all?.payableMinor ?? 0) - paidAll,
          /** All time: share still waiting for the patient to pay. */
          awaitingPatientMinor: (all?.earnedMinor ?? 0) - (all?.payableMinor ?? 0),
        };
      })
      .sort((a, b) => b.earnedMinor - a.earnedMinor || a.name.localeCompare(b.name));

    const sum = (k: "producedMinor" | "earnedMinor" | "payableMinor" | "clinicMinor" | "paidMinor" | "balanceMinor" | "awaitingPatientMinor") =>
      summary.reduce((n, r) => n + r[k], 0);
    return {
      from,
      to,
      providerId,
      rows: rows.map((r) => ({ ...r, patientName: `${r.patientFirstName} ${r.patientLastName}` })),
      rowsTruncated: Boolean(opts.rowLimit && rows.length >= opts.rowLimit),
      payments: payments.map((p) => ({ ...p, providerName: nameOf(p.providerId), reversed: reversed.has(p.id) })),
      closures: closures.map((c) => ({ ...c, providerName: nameOf(c.providerId) })),
      summary,
      totals: {
        producedMinor: sum("producedMinor"),
        earnedMinor: sum("earnedMinor"),
        payableMinor: sum("payableMinor"),
        clinicMinor: sum("clinicMinor"),
        paidMinor: sum("paidMinor"),
        balanceMinor: sum("balanceMinor"),
        awaitingPatientMinor: sum("awaitingPatientMinor"),
      },
    };
  });
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Practitioners this user may see (all, or only themself), with their fee profile. */
export async function listFeeProviders(ctx: ClinicContext) {
  const { providerId } = readScope(ctx);
  return tenantTx(ctx, (tx) =>
    tx
      .select({ id: memberships.id, displayName: memberships.displayName, title: memberships.title, specialty: memberships.specialty, status: memberships.status, defaultFeeRateBp: memberships.defaultFeeRateBp })
      .from(memberships)
      .where(and(eq(memberships.isProvider, true), providerId ? eq(memberships.id, providerId) : undefined))
      .orderBy(asc(memberships.displayName)),
  );
}

/**
 * What the checkout needs for practitioner fees. Rates, rules and shares go to the owner only (honorarium.manage):
 * anyone else creating an invoice only gets which services take a lab fee off first, so they can type it.
 * `enabled` is false for a clinic that never set a fee rule: checkout then stays as before.
 */
export async function getCheckoutFeeSupport(ctx: ClinicContext) {
  requirePermission(ctx, "invoice.create");
  const canManage = can(ctx, "honorarium.manage");
  return tenantTx(ctx, async (tx) => {
    const [providers, terms, deductLab] = await Promise.all([
      tx
        .select({ id: memberships.id, displayName: memberships.displayName, title: memberships.title, defaultFeeRateBp: memberships.defaultFeeRateBp })
        .from(memberships)
        .where(and(eq(memberships.isProvider, true), eq(memberships.status, "active")))
        .orderBy(asc(memberships.displayName)),
      tx
        .select({ providerId: providerServiceTerms.providerId, serviceId: providerServiceTerms.serviceId, ruleType: providerServiceTerms.ruleType, ruleValue: providerServiceTerms.ruleValue })
        .from(providerServiceTerms),
      tx.select({ id: services.id }).from(services).where(eq(services.deductLabBeforeShare, true)),
    ]);
    const rules = terms.flatMap((t) => {
      const rule = termRule(t);
      return rule ? [{ providerId: t.providerId, serviceId: t.serviceId, ruleType: rule.type, ruleValue: rule.value }] : [];
    });
    return {
      enabled: providers.some((p) => p.defaultFeeRateBp > 0) || rules.length > 0,
      canManage,
      providers: canManage ? providers.map((p) => ({ id: p.id, name: withTitle(p.title, p.displayName), defaultFeeRateBp: p.defaultFeeRateBp })) : [],
      terms: canManage ? rules : [],
      deductLabServiceIds: deductLab.map((s) => s.id),
    };
  });
}

/** Practitioner/service rules with a fee rule set (assigning older lines). */
export async function listFeeTerms(ctx: ClinicContext) {
  requirePermission(ctx, "honorarium.manage");
  const rows = await tenantTx(ctx, (tx) =>
    tx
      .select({ providerId: providerServiceTerms.providerId, serviceId: providerServiceTerms.serviceId, ruleType: providerServiceTerms.ruleType, ruleValue: providerServiceTerms.ruleValue })
      .from(providerServiceTerms),
  );
  return rows.flatMap((t) => {
    const rule = termRule(t);
    return rule ? [{ providerId: t.providerId, serviceId: t.serviceId, ruleType: rule.type, ruleValue: rule.value }] : [];
  });
}

/**
 * One practitioner's price list: for each service of the catalog, the catalog price, this practitioner's own price
 * and his fee rule (empty = catalog price / default percentage). The owner edits it; a practitioner may read his own.
 */
export async function getProviderPriceList(ctx: ClinicContext, providerId: string) {
  if (!can(ctx, "honorarium.manage")) {
    requirePermission(ctx, "honorarium.read.own");
    if (providerId !== ctx.membershipId) throw new ForbiddenError("honorarium.manage");
  }
  return tenantTx(ctx, async (tx) => {
    const provider = await requireProvider(tx, providerId);
    const [rows, terms] = await Promise.all([
      tx
        .select({
          id: services.id,
          code: services.code,
          name: services.name,
          priceMinor: services.priceMinor,
          currency: services.currency,
          isActive: services.isActive,
          deductLabBeforeShare: services.deductLabBeforeShare,
          categoryId: services.categoryId,
          categoryName: serviceCategories.name,
          categoryOrder: serviceCategories.sortOrder,
        })
        .from(services)
        .innerJoin(serviceCategories, eq(serviceCategories.id, services.categoryId))
        .orderBy(asc(serviceCategories.sortOrder), asc(services.code)),
      tx.select().from(providerServiceTerms).where(eq(providerServiceTerms.providerId, provider.id)),
    ]);
    return {
      provider,
      services: rows.map((s) => {
        const term = terms.find((t) => t.serviceId === s.id);
        return { ...s, ownPriceMinor: term?.priceMinor ?? null, rule: termRule(term), updatedAt: term?.updatedAt ?? null };
      }),
    };
  });
}

export async function saveProviderFeeProfile(ctx: ClinicContext, input: { providerId: string; specialty: string | null; defaultFeeRateBp: number }) {
  requirePermission(ctx, "honorarium.manage");
  if (!Number.isSafeInteger(input.defaultFeeRateBp) || input.defaultFeeRateBp < 0 || input.defaultFeeRateBp > 10_000) throw new HonorariumError("invalidRule");
  return tenantTx(ctx, async (tx) => {
    const before = await requireProvider(tx, input.providerId);
    await tx
      .update(memberships)
      .set({ specialty: input.specialty?.trim().slice(0, 120) || null, defaultFeeRateBp: input.defaultFeeRateBp })
      .where(eq(memberships.id, before.id));
    await audit(tx, {
      ...staff(ctx),
      action: "honorarium.provider.updated",
      entityType: "membership",
      entityId: before.id,
      metadata: { fromRateBp: before.defaultFeeRateBp, toRateBp: input.defaultFeeRateBp },
    });
  });
}

export async function saveProviderServiceTerm(
  ctx: ClinicContext,
  input: { providerId: string; serviceId: string; priceMinor: number | null; rule: FeeRule | null; reason?: string | null },
) {
  requirePermission(ctx, "honorarium.manage");
  if (input.rule && !isValidRule(input.rule)) throw new HonorariumError("invalidRule");
  if (input.priceMinor !== null && (!Number.isSafeInteger(input.priceMinor) || input.priceMinor < 0)) throw new HonorariumError("invalidAmount");
  return tenantTx(ctx, async (tx) => {
    const provider = await requireProvider(tx, input.providerId);
    const [service] = await tx.select({ id: services.id }).from(services).where(eq(services.id, input.serviceId)).limit(1);
    if (!service) throw new HonorariumError("serviceUnavailable");
    const [current] = await tx
      .select()
      .from(providerServiceTerms)
      .where(and(eq(providerServiceTerms.providerId, provider.id), eq(providerServiceTerms.serviceId, service.id)))
      .limit(1);
    const values = { priceMinor: input.priceMinor, ruleType: input.rule?.type ?? null, ruleValue: input.rule?.value ?? null, changedByUserId: ctx.userId };
    // Nothing set and nothing to clear, or nothing changed: no history line.
    if (!current && values.priceMinor === null && values.ruleType === null) return null;
    if (current && current.priceMinor === values.priceMinor && current.ruleType === values.ruleType && current.ruleValue === values.ruleValue) return current.id;
    const [term] = await tx
      .insert(providerServiceTerms)
      .values({ organizationId: ctx.organizationId, providerId: provider.id, serviceId: service.id, ...values })
      .onConflictDoUpdate({
        target: [providerServiceTerms.organizationId, providerServiceTerms.providerId, providerServiceTerms.serviceId],
        set: { ...values, updatedAt: new Date(), version: sql`${providerServiceTerms.version} + 1` },
      })
      .returning({ id: providerServiceTerms.id });
    await tx.insert(providerServiceTermHistory).values({
      organizationId: ctx.organizationId,
      termId: term!.id,
      providerId: provider.id,
      serviceId: service.id,
      ...values,
      reason: input.reason?.trim() || "price_list",
    });
    await audit(tx, {
      ...staff(ctx),
      action: "honorarium.term.updated",
      entityType: "provider_service_term",
      entityId: term!.id,
      metadata: { ruleType: values.ruleType, ruleValue: values.ruleValue, priceMinor: values.priceMinor },
    });
    return term!.id;
  });
}

// ---------------------------------------------------------------------------
// Paying practitioners
// ---------------------------------------------------------------------------

export async function recordHonorariumPayment(
  ctx: ClinicContext,
  input: { providerId: string; paidOn: string; amountMinor: number; method: PayoutMethod; reference?: string | null; note?: string | null },
) {
  requirePermission(ctx, "honorarium.pay");
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) throw new HonorariumError("invalidAmount");
  if (!PAYOUT_METHODS.includes(input.method)) throw new HonorariumError("invalidAmount");
  const paidOn = parseDateOnly(input.paidOn);
  if (!paidOn || paidOn > todayInZone(ctx.organization.timezone)) throw new HonorariumError("invalidDate");
  return tenantTx(ctx, async (tx) => {
    const provider = await requireProvider(tx, input.providerId);
    if (await monthClosed(tx, provider.id, paidOn)) throw new HonorariumError("periodClosed");
    // Cash handed over comes out of this site's cash drawer of that day (see cash day "expected").
    const siteId = await currentSiteId(tx, ctx);
    await assertCashDayOpen(tx, paidOn, input.method, siteId);
    const [row] = await tx
      .insert(honorariumPayments)
      .values({
        organizationId: ctx.organizationId,
        branchId: siteId,
        providerId: provider.id,
        paidOn,
        amountMinor: input.amountMinor,
        currency: ctx.organization.defaultCurrency,
        method: input.method,
        reference: input.reference?.trim() || null,
        note: input.note?.trim() || null,
        createdByUserId: ctx.userId,
      })
      .returning({ id: honorariumPayments.id });
    await audit(tx, {
      ...staff(ctx),
      action: "honorarium.payment.recorded",
      entityType: "honorarium_payment",
      entityId: row!.id,
      metadata: { providerId: provider.id, amountMinor: input.amountMinor, method: input.method, paidOn },
    });
    return row!.id;
  });
}

/** Cancels a payment recorded by mistake with a negative row dated today. */
export async function reverseHonorariumPayment(ctx: ClinicContext, paymentId: string, reason: string) {
  requirePermission(ctx, "honorarium.pay");
  if (!reason.trim()) throw new HonorariumError("reasonRequired");
  const today = todayInZone(ctx.organization.timezone);
  return tenantTx(ctx, async (tx) => {
    const [original] = await tx
      .select()
      .from(honorariumPayments)
      .where(and(eq(honorariumPayments.id, paymentId), isNull(honorariumPayments.reversesPaymentId)))
      .limit(1);
    if (!original) throw new HonorariumError("paymentUnavailable");
    const siteId = original.branchId ?? (await mainSiteId(tx));
    await assertCashDayOpen(tx, today, original.method, siteId);
    // A payment is reversed at most once (unique index on reverses_payment_id).
    const [row] = await tx
      .insert(honorariumPayments)
      .values({
        organizationId: ctx.organizationId,
        branchId: siteId,
        providerId: original.providerId,
        paidOn: today,
        amountMinor: -original.amountMinor,
        currency: original.currency,
        method: original.method,
        reference: original.reference,
        note: reason.trim(),
        reversesPaymentId: original.id,
        createdByUserId: ctx.userId,
      })
      .onConflictDoNothing()
      .returning({ id: honorariumPayments.id });
    if (!row) throw new HonorariumError("alreadyReversed");
    await audit(tx, {
      ...staff(ctx),
      action: "honorarium.payment.reversed",
      entityType: "honorarium_payment",
      entityId: original.id,
      metadata: { reversalId: row.id, amountMinor: original.amountMinor, method: original.method },
    });
    return row.id;
  });
}

/** Makes a past month final for a practitioner. Later fees, corrections and payments are dated in an open month. */
export async function closeHonorariumMonth(ctx: ClinicContext, input: { providerId: string; month: string; note?: string | null }) {
  requirePermission(ctx, "honorarium.close");
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.month)) throw new HonorariumError("invalidPeriod");
  if (input.month >= todayInZone(ctx.organization.timezone).slice(0, 7)) throw new HonorariumError("periodNotEnded");
  return tenantTx(ctx, async (tx) => {
    const provider = await requireProvider(tx, input.providerId);
    const [row] = await tx
      .insert(honorariumPeriodClosures)
      .values({ organizationId: ctx.organizationId, providerId: provider.id, periodMonth: `${input.month}-01`, closedByUserId: ctx.userId, note: input.note?.trim() || null })
      .onConflictDoNothing()
      .returning({ id: honorariumPeriodClosures.id });
    if (!row) throw new HonorariumError("periodClosed");
    await audit(tx, { ...staff(ctx), action: "honorarium.period.closed", entityType: "honorarium_period", entityId: row.id, metadata: { providerId: provider.id, month: input.month } });
    return row.id;
  });
}
