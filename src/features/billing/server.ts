import "server-only";
import { and, asc, count, desc, eq, gte, inArray, isNull, lte, ne, or, sql, type SQL } from "drizzle-orm";
import { audit } from "@/server/audit";
import { requirePermission, tenantTx, type ClinicContext } from "@/server/auth/context";
import type { Tx } from "@/server/db/client";
import {
  creditNotes,
  invoiceLines,
  invoices,
  legalEntities,
  memberships,
  patients,
  paymentAllocations,
  paymentInstallmentReceipts,
  payments,
  performedProcedures,
  refunds,
} from "@/server/db/schema";
import type { IssuerSnapshot } from "@/server/db/schema";
import { nextCounter } from "@/server/db/tenant";
import { todayInZone } from "@/lib/dates";
import { assertCashDayOpen } from "@/features/cash/server";
import { currentSiteId, mainSiteId } from "@/server/sites";
import { applyBasisPoints } from "@/lib/money";
import { isValidRule, type FeeRule } from "@/features/honoraria/calculation";
import { snapshotInvoiceHonoraria } from "@/features/honoraria/server";
import {
  invoiceBalanceSql,
  invoiceCreditedSql,
  invoicePaidSql,
  paymentAllocatedSql,
  paymentRefundedSql,
  paymentState,
  paymentUnappliedSql,
} from "./sql";

/** Domain error; `code` maps to `billing.errors.<code>` translations. */
export class BillingError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}

const staff = (ctx: ClinicContext) => ({ organizationId: ctx.organizationId, actorType: "staff" as const, actorUserId: ctx.userId });

/** Issuer details frozen onto an issued document (same SQL function as the 0039 backfill). */
const issuerSnapshotOf = (legalEntityId: string) => sql<IssuerSnapshot>`app_private.issuer_snapshot_for(${legalEntityId})`;

async function defaultLegalEntity(tx: Tx) {
  const [le] = await tx
    .select()
    .from(legalEntities)
    .orderBy(desc(legalEntities.isDefault), asc(legalEntities.createdAt))
    .limit(1);
  if (!le) throw new BillingError("noLegalEntity");
  return le;
}

async function documentNumber(tx: Tx, ctx: ClinicContext, kind: "invoice" | "credit" | "receipt", le: { id: string; invoicePrefix: string }, date: string) {
  const year = date.slice(0, 4);
  const n = await nextCounter(tx, ctx.organizationId, `${kind}:${le.id}:${year}`);
  const prefix = kind === "invoice" ? le.invoicePrefix : kind === "credit" ? "AV" : "R";
  return `${prefix}-${year}-${String(n).padStart(5, "0")}`;
}

// ---------------------------------------------------------------------------
// Unbilled work and invoice creation
// ---------------------------------------------------------------------------

// Explicit identifiers: see the note in ./sql.ts about unqualified columns.
const unbilledCondition = sql`not exists (
  select 1 from invoice_lines il_u
   where il_u.performed_procedure_id = performed_procedures.id and il_u.released = false)`;

export async function listUnbilledProcedures(ctx: ClinicContext, patientId: string) {
  requirePermission(ctx, "invoice.create");
  return tenantTx(ctx, (tx) =>
    tx
      .select({
        id: performedProcedures.id,
        serviceSnapshot: performedProcedures.serviceSnapshot,
        toothNumber: performedProcedures.toothNumber,
        surfaces: performedProcedures.surfaces,
        quantity: performedProcedures.quantity,
        unitPriceMinor: performedProcedures.unitPriceMinor,
        currency: performedProcedures.currency,
        serviceDate: performedProcedures.serviceDate,
        providerId: performedProcedures.performingProviderId,
        serviceId: performedProcedures.serviceId,
        providerName: memberships.displayName,
        providerTitle: memberships.title,
      })
      .from(performedProcedures)
      .innerJoin(memberships, eq(memberships.id, performedProcedures.performingProviderId))
      .where(and(eq(performedProcedures.patientId, patientId), eq(performedProcedures.status, "completed"), unbilledCondition))
      .orderBy(asc(performedProcedures.serviceDate), asc(performedProcedures.createdAt)),
  );
}

/** Central billing work queue: completed clinical work that is not yet on a non-void invoice. */
export async function listPatientsReadyToInvoice(ctx: ClinicContext) {
  requirePermission(ctx, "invoice.create");
  return tenantTx(ctx, async (tx) => {
    const rows = await tx
      .select({
        patientId: patients.id,
        patientNumber: patients.patientNumber,
        firstName: patients.firstName,
        lastName: patients.lastName,
        procedureCount: count(),
        amountMinor: sql<number>`sum(${performedProcedures.quantity} * ${performedProcedures.unitPriceMinor})::bigint`,
        oldestDate: sql<string>`min(${performedProcedures.serviceDate})`,
        newestDate: sql<string>`max(${performedProcedures.serviceDate})`,
      })
      .from(performedProcedures)
      .innerJoin(patients, eq(patients.id, performedProcedures.patientId))
      .where(and(eq(performedProcedures.status, "completed"), unbilledCondition))
      .groupBy(patients.id, patients.patientNumber, patients.firstName, patients.lastName)
      .orderBy(asc(sql`min(${performedProcedures.serviceDate})`));
    return rows.map((row) => ({ ...row, amountMinor: Number(row.amountMinor) }));
  });
}

/**
 * Practitioner-fee details typed at checkout for one procedure: who is paid for it (defaults to who performed it),
 * the lab fee, and optionally a one-off rule with its reason. Frozen on the invoice line.
 */
export type CheckoutLineOption = {
  procedureId: string;
  providerId?: string | null;
  labFeeMinor?: number;
  rule?: FeeRule | null;
  ruleReason?: string | null;
};

export async function createInvoiceFromProcedures(
  ctx: ClinicContext,
  patientId: string,
  input: { procedureIds: string[]; issueNow: boolean; notes?: string | null; dueDate?: string | null; lineOptions?: CheckoutLineOption[] },
) {
  requirePermission(ctx, "invoice.create");
  if (input.issueNow) requirePermission(ctx, "invoice.issue");
  const ids = [...new Set(input.procedureIds)];
  if (ids.length === 0) throw new BillingError("noLines");

  return tenantTx(ctx, async (tx) => {
    const [patient] = await tx.select({ id: patients.id }).from(patients).where(eq(patients.id, patientId)).limit(1);
    if (!patient) throw new BillingError("notFound");
    // Lock the procedures so two checkouts cannot bill the same work.
    const procs = await tx
      .select()
      .from(performedProcedures)
      .where(and(inArray(performedProcedures.id, ids), eq(performedProcedures.patientId, patientId)))
      .for("update");
    if (procs.length !== ids.length || procs.some((p) => p.status !== "completed")) throw new BillingError("procedureUnavailable");
    const billed = await tx
      .select({ id: invoiceLines.performedProcedureId })
      .from(invoiceLines)
      .where(and(inArray(invoiceLines.performedProcedureId, ids), eq(invoiceLines.released, false)));
    if (billed.length) throw new BillingError("alreadyBilled");
    const currency = procs[0]!.currency;
    if (procs.some((p) => p.currency !== currency)) throw new BillingError("currencyMismatch");

    const le = await defaultLegalEntity(tx);
    if (le.currency !== currency) throw new BillingError("currencyMismatch");

    const options = new Map((input.lineOptions ?? []).map((o) => [o.procedureId, o]));
    // Who is paid for an act and its fee rule are the owner's decision; anyone billing may type a lab fee.
    if (procs.some((p) => { const o = options.get(p.id); return o?.rule || (o?.providerId && o.providerId !== p.performingProviderId); })) {
      requirePermission(ctx, "honorarium.manage");
    }
    // A practitioner other than the one who performed the act must be an active practitioner of this clinic.
    const reassigned = [
      ...new Set(
        procs.flatMap((p) => {
          const id = options.get(p.id)?.providerId;
          return id && id !== p.performingProviderId ? [id] : [];
        }),
      ),
    ];
    if (reassigned.length) {
      const valid = await tx
        .select({ id: memberships.id })
        .from(memberships)
        .where(and(inArray(memberships.id, reassigned), eq(memberships.isProvider, true), eq(memberships.status, "active")));
      if (valid.length !== reassigned.length) throw new BillingError("providerUnavailable");
    }
    const lines = procs
      .sort((a, b) => a.serviceDate.localeCompare(b.serviceDate) || a.createdAt.getTime() - b.createdAt.getTime())
      .map((p, i) => {
        const net = p.quantity * p.unitPriceMinor;
        const option = options.get(p.id);
        const labFeeMinor = option?.labFeeMinor ?? 0;
        if (!Number.isSafeInteger(labFeeMinor) || labFeeMinor < 0 || labFeeMinor > net) throw new BillingError("invalidLabFee");
        const rule = option?.rule ?? null;
        if (rule && !isValidRule(rule)) throw new BillingError("invalidFeeRule");
        if (rule && !option?.ruleReason?.trim()) throw new BillingError("feeRuleReasonRequired");
        const taxRateBp = p.serviceSnapshot.taxRateBp ?? null;
        const taxMinor = taxRateBp ? applyBasisPoints(net, taxRateBp) : 0;
        return {
          organizationId: ctx.organizationId,
          performedProcedureId: p.id,
          serviceId: p.serviceId,
          description: { code: p.serviceSnapshot.code, name: p.serviceSnapshot.name },
          toothNumber: p.toothNumber,
          surfaces: p.surfaces,
          quantity: p.quantity,
          unitPriceMinor: p.unitPriceMinor,
          discountMinor: 0,
          labFeeMinor,
          honorariumRuleType: rule?.type ?? null,
          honorariumRuleValue: rule?.value ?? null,
          honorariumOverrideReason: rule ? option!.ruleReason!.trim() : null,
          taxRateBp,
          taxMinor,
          totalMinor: net + taxMinor,
          serviceDate: p.serviceDate,
          providerId: option?.providerId || p.performingProviderId,
          sortOrder: i,
        };
      });
    const subtotal = lines.reduce((s, l) => s + l.quantity * l.unitPriceMinor, 0);
    const tax = lines.reduce((s, l) => s + l.taxMinor, 0);
    if (!Number.isSafeInteger(subtotal + tax)) throw new BillingError("invalidAmount");

    const [invoice] = await tx
      .insert(invoices)
      .values({
        organizationId: ctx.organizationId,
        legalEntityId: le.id,
        patientId,
        currency,
        subtotalMinor: subtotal,
        discountMinor: 0,
        taxMinor: tax,
        totalMinor: subtotal + tax,
        notes: input.notes || null,
        dueDate: input.dueDate || null,
        createdByUserId: ctx.userId,
      })
      .returning({ id: invoices.id });
    await tx.insert(invoiceLines).values(lines.map((l) => ({ ...l, invoiceId: invoice!.id })));
    await audit(tx, { ...staff(ctx), action: "invoice.created", entityType: "invoice", entityId: invoice!.id, patientId, metadata: { lines: lines.length } });
    if (input.issueNow) await issueInTx(tx, ctx, invoice!.id);
    return invoice!.id;
  });
}

async function issueInTx(tx: Tx, ctx: ClinicContext, invoiceId: string) {
  const [inv] = await tx.select().from(invoices).where(eq(invoices.id, invoiceId)).for("update");
  if (!inv) throw new BillingError("notFound");
  if (inv.status === "issued") return inv.number!; // idempotent retry
  if (inv.status !== "draft") throw new BillingError("notDraft");
  const reversed = await tx
    .select({ id: performedProcedures.id })
    .from(invoiceLines)
    .innerJoin(performedProcedures, eq(performedProcedures.id, invoiceLines.performedProcedureId))
    .where(and(eq(invoiceLines.invoiceId, invoiceId), ne(performedProcedures.status, "completed")));
  if (reversed.length) throw new BillingError("procedureUnavailable");
  const [le] = await tx.select().from(legalEntities).where(eq(legalEntities.id, inv.legalEntityId));
  const documentDate = todayInZone(ctx.organization.timezone);
  const number = await documentNumber(tx, ctx, "invoice", le!, documentDate);
  await tx
    .update(invoices)
    .set({ status: "issued", number, documentDate, issuerSnapshot: issuerSnapshotOf(le!.id), issuedAt: new Date(), issuedByUserId: ctx.userId, updatedAt: new Date(), version: sql`${invoices.version} + 1` })
    .where(eq(invoices.id, invoiceId));
  await snapshotInvoiceHonoraria(tx, ctx, invoiceId);
  await audit(tx, { ...staff(ctx), action: "invoice.issued", entityType: "invoice", entityId: invoiceId, patientId: inv.patientId, metadata: { number } });
  return number;
}

export async function issueInvoice(ctx: ClinicContext, invoiceId: string) {
  requirePermission(ctx, "invoice.issue");
  return tenantTx(ctx, (tx) => issueInTx(tx, ctx, invoiceId));
}

export async function deleteDraftInvoice(ctx: ClinicContext, invoiceId: string) {
  requirePermission(ctx, "invoice.create");
  return tenantTx(ctx, async (tx) => {
    const [inv] = await tx.select().from(invoices).where(eq(invoices.id, invoiceId)).for("update");
    if (!inv) throw new BillingError("notFound");
    if (inv.status !== "draft") throw new BillingError("notDraft");
    await tx.delete(invoices).where(eq(invoices.id, invoiceId));
    await audit(tx, { ...staff(ctx), action: "invoice.draft_deleted", entityType: "invoice", entityId: invoiceId, patientId: inv.patientId });
    return inv.patientId;
  });
}

/** Voids an issued invoice that has no payments or credits; its procedures become billable again. */
export async function voidInvoice(ctx: ClinicContext, invoiceId: string, reason: string) {
  requirePermission(ctx, "invoice.void");
  if (!reason.trim()) throw new BillingError("reasonRequired");
  return tenantTx(ctx, async (tx) => {
    const [inv] = await tx
      .select({ status: invoices.status, patientId: invoices.patientId, paid: invoicePaidSql, credited: invoiceCreditedSql })
      .from(invoices)
      .where(eq(invoices.id, invoiceId))
      .for("update", { of: invoices });
    if (!inv) throw new BillingError("notFound");
    if (inv.status !== "issued") throw new BillingError("notIssued");
    if (Number(inv.paid) !== 0 || Number(inv.credited) !== 0) throw new BillingError("hasPayments");
    await tx
      .update(invoices)
      .set({ status: "void", voidedAt: new Date(), voidedByUserId: ctx.userId, voidReason: reason.trim(), updatedAt: new Date(), version: sql`${invoices.version} + 1` })
      .where(eq(invoices.id, invoiceId));
    await tx.update(invoiceLines).set({ released: true }).where(eq(invoiceLines.invoiceId, invoiceId));
    await audit(tx, { ...staff(ctx), action: "invoice.voided", entityType: "invoice", entityId: invoiceId, patientId: inv.patientId });
  });
}

// ---------------------------------------------------------------------------
// Payments, deposits, allocations
// ---------------------------------------------------------------------------

export type PaymentInput = {
  patientId: string;
  amountMinor: number;
  method: "cash" | "card" | "bank_transfer" | "cheque" | "other";
  reference?: string | null;
  payerName?: string | null;
  receivedOn: string;
  idempotencyKey: string;
  /** Invoice to pay; "auto" = oldest open invoices; null = keep as deposit/credit. */
  allocateTo: string | "auto" | null;
  /** Optional installment classification. The receipt remains an unapplied deposit. */
  installmentId?: string | null;
};

async function openInvoices(tx: Tx, patientId: string, onlyId?: string) {
  const rows = await tx
    .select({ id: invoices.id, legalEntityId: invoices.legalEntityId, currency: invoices.currency, balance: invoiceBalanceSql })
    .from(invoices)
    .where(and(eq(invoices.patientId, patientId), eq(invoices.status, "issued"), onlyId ? eq(invoices.id, onlyId) : undefined))
    .orderBy(asc(invoices.documentDate), asc(invoices.createdAt))
    .for("update", { of: invoices });
  return rows.map((r) => ({ ...r, balance: Number(r.balance) })).filter((r) => r.balance > 0);
}

export async function recordPayment(ctx: ClinicContext, input: PaymentInput) {
  requirePermission(ctx, "payment.receive");
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) throw new BillingError("invalidAmount");
  if (input.receivedOn > todayInZone(ctx.organization.timezone)) throw new BillingError("futureDate");

  return tenantTx(ctx, async (tx) => {
    // Idempotent retry: same key returns the original payment, never a second receipt.
    const [existing] = await tx.select({ id: payments.id }).from(payments).where(eq(payments.idempotencyKey, input.idempotencyKey)).limit(1);
    if (existing) return { id: existing.id, duplicate: true };

    const [patient] = await tx.select({ id: patients.id }).from(patients).where(eq(patients.id, input.patientId)).limit(1);
    if (!patient) throw new BillingError("notFound");
    let installment: { id: string; scheduleId: string; currency: string } | null = null;
    if (input.installmentId) {
      if (input.allocateTo !== null) throw new BillingError("invalidAmount");
      // Serialize receipts per installment (row locks need UPDATE, which append-only tables never grant).
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`installment:${input.installmentId}`}, 0))`);
      const [row] = await tx.execute<{ id: string; schedule_id: string; currency: string; remaining: string }>(sql`
        select i.id, i.schedule_id, s.currency,
               (i.amount_minor - coalesce((select sum(case when p.status = 'posted' then p.amount_minor
                 - coalesce((select sum(r.amount_minor) from refunds r where r.payment_id = p.id), 0) else 0 end)
                 from payment_installment_receipts x join payments p on p.id = x.payment_id where x.installment_id = i.id), 0))::text remaining
          from payment_schedule_installments i join payment_schedules s on s.id = i.schedule_id
         where i.id = ${input.installmentId} and i.patient_id = ${input.patientId}
           and not exists (select 1 from payment_schedules n where n.supersedes_schedule_id = s.id)`);
      if (!row || Number(row.remaining) < input.amountMinor) throw new BillingError("invalidAmount");
      installment = { id: row.id, scheduleId: row.schedule_id, currency: row.currency };
    }
    const siteId = await currentSiteId(tx, ctx);
    await assertCashDayOpen(tx, input.receivedOn, input.method, siteId);
    const targets = input.allocateTo ? await openInvoices(tx, input.patientId, input.allocateTo === "auto" ? undefined : input.allocateTo) : [];
    if (input.allocateTo && input.allocateTo !== "auto" && targets.length === 0) throw new BillingError("invoiceNotOpen");

    const le = targets[0] ? (await tx.select().from(legalEntities).where(eq(legalEntities.id, targets[0].legalEntityId)))[0]! : await defaultLegalEntity(tx);
    if (installment && installment.currency !== le.currency) throw new BillingError("invalidAmount");
    const receiptNumber = await documentNumber(tx, ctx, "receipt", le, input.receivedOn);
    const [payment] = await tx
      .insert(payments)
      .values({
        organizationId: ctx.organizationId,
        legalEntityId: le.id,
        branchId: siteId,
        issuerSnapshot: issuerSnapshotOf(le.id),
        patientId: input.patientId,
        payerName: input.payerName || null,
        purpose: input.allocateTo ? "invoice_payment" : "advance_deposit",
        method: input.method,
        reference: input.reference || null,
        amountMinor: input.amountMinor,
        currency: le.currency,
        receivedOn: input.receivedOn,
        receiptNumber,
        idempotencyKey: input.idempotencyKey,
        createdByUserId: ctx.userId,
      })
      .returning({ id: payments.id });

    if (installment) await tx.insert(paymentInstallmentReceipts).values({
      organizationId: ctx.organizationId, scheduleId: installment.scheduleId, installmentId: installment.id,
      paymentId: payment!.id, patientId: input.patientId, createdByUserId: ctx.userId,
    });

    let remaining = input.amountMinor;
    for (const inv of targets) {
      if (remaining <= 0) break;
      if (inv.legalEntityId !== le.id || inv.currency !== le.currency) continue;
      const amount = Math.min(remaining, inv.balance);
      await tx.insert(paymentAllocations).values({ organizationId: ctx.organizationId, paymentId: payment!.id, invoiceId: inv.id, amountMinor: amount, createdByUserId: ctx.userId });
      remaining -= amount;
    }
    await audit(tx, {
      ...staff(ctx),
      action: "payment.received",
      entityType: "payment",
      entityId: payment!.id,
      patientId: input.patientId,
      metadata: { receiptNumber, method: input.method, amountMinor: input.amountMinor, unappliedMinor: remaining, installmentId: installment?.id ?? null },
    });
    return { id: payment!.id, duplicate: false };
  });
}

/** Applies available (unapplied) value of an existing payment/deposit to an invoice. Not a new receipt. */
export async function applyPaymentToInvoice(ctx: ClinicContext, paymentId: string, invoiceId: string, amountMinor?: number) {
  requirePermission(ctx, "payment.receive");
  return tenantTx(ctx, async (tx) => {
    const [inv] = await tx
      .select({ id: invoices.id, patientId: invoices.patientId, status: invoices.status, balance: invoiceBalanceSql })
      .from(invoices)
      .where(eq(invoices.id, invoiceId))
      .for("update", { of: invoices });
    const [pay] = await tx
      .select({ id: payments.id, patientId: payments.patientId, unapplied: paymentUnappliedSql })
      .from(payments)
      .where(eq(payments.id, paymentId))
      .for("update", { of: payments });
    if (!inv || !pay || inv.patientId !== pay.patientId) throw new BillingError("notFound");
    if (inv.status !== "issued") throw new BillingError("notIssued");
    const max = Math.min(Number(inv.balance), Number(pay.unapplied));
    const amount = amountMinor ?? max;
    if (amount <= 0 || amount > max) throw new BillingError("invalidAmount");
    await tx.insert(paymentAllocations).values({ organizationId: ctx.organizationId, paymentId, invoiceId, amountMinor: amount, reason: "credit_applied", createdByUserId: ctx.userId });
    await audit(tx, { ...staff(ctx), action: "payment.applied", entityType: "payment", entityId: paymentId, patientId: inv.patientId, metadata: { invoiceId, amountMinor: amount } });
  });
}

/**
 * Reduces an issued invoice's charge. If the invoice was already paid beyond the
 * new charge, the excess allocation is explicitly released back to the payment
 * (it becomes unapplied credit that can be refunded or applied elsewhere).
 */
export async function issueCreditNote(ctx: ClinicContext, invoiceId: string, amountMinor: number, reason: string) {
  requirePermission(ctx, "credit_note.issue");
  if (!reason.trim()) throw new BillingError("reasonRequired");
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) throw new BillingError("invalidAmount");
  return tenantTx(ctx, async (tx) => {
    const [inv] = await tx
      .select({ inv: invoices, paid: invoicePaidSql, credited: invoiceCreditedSql })
      .from(invoices)
      .where(eq(invoices.id, invoiceId))
      .for("update", { of: invoices });
    if (!inv) throw new BillingError("notFound");
    if (inv.inv.status !== "issued") throw new BillingError("notIssued");
    const charge = inv.inv.totalMinor - Number(inv.credited);
    if (amountMinor > charge) throw new BillingError("creditTooLarge");
    let excess = Number(inv.paid) - (charge - amountMinor);
    if (excess > 0) {
      // Release from the most recent allocations first.
      const allocs = await tx
        .select({ paymentId: paymentAllocations.paymentId, total: sql<number>`sum(${paymentAllocations.amountMinor})::bigint` })
        .from(paymentAllocations)
        .where(eq(paymentAllocations.invoiceId, invoiceId))
        .groupBy(paymentAllocations.paymentId)
        .orderBy(desc(sql`max(${paymentAllocations.createdAt})`));
      for (const a of allocs) {
        if (excess <= 0) break;
        const release = Math.min(excess, Number(a.total));
        if (release <= 0) continue;
        await tx.insert(paymentAllocations).values({ organizationId: ctx.organizationId, paymentId: a.paymentId, invoiceId, amountMinor: -release, reason: "released_by_credit_note", createdByUserId: ctx.userId });
        excess -= release;
      }
    }
    const [le] = await tx.select().from(legalEntities).where(eq(legalEntities.id, inv.inv.legalEntityId));
    const documentDate = todayInZone(ctx.organization.timezone);
    const number = await documentNumber(tx, ctx, "credit", le!, documentDate);
    const [cn] = await tx
      .insert(creditNotes)
      .values({ organizationId: ctx.organizationId, legalEntityId: le!.id, issuerSnapshot: issuerSnapshotOf(le!.id), invoiceId, number, documentDate, amountMinor, currency: inv.inv.currency, reason: reason.trim(), createdByUserId: ctx.userId })
      .returning({ id: creditNotes.id });
    await audit(tx, { ...staff(ctx), action: "credit_note.issued", entityType: "credit_note", entityId: cn!.id, patientId: inv.inv.patientId, metadata: { invoiceId, number, amountMinor } });
    return cn!.id;
  });
}

export async function refundPayment(
  ctx: ClinicContext,
  paymentId: string,
  input: { amountMinor: number; method: PaymentInput["method"]; reason: string; refundedOn: string; reference?: string | null },
) {
  requirePermission(ctx, "payment.refund");
  if (!input.reason.trim()) throw new BillingError("reasonRequired");
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) throw new BillingError("invalidAmount");
  if (input.refundedOn > todayInZone(ctx.organization.timezone)) throw new BillingError("futureDate");
  return tenantTx(ctx, async (tx) => {
    const [pay] = await tx
      .select({ id: payments.id, patientId: payments.patientId, status: payments.status, unapplied: paymentUnappliedSql })
      .from(payments)
      .where(eq(payments.id, paymentId))
      .for("update", { of: payments });
    if (!pay) throw new BillingError("notFound");
    if (pay.status !== "posted") throw new BillingError("paymentReversed");
    if (input.amountMinor > Number(pay.unapplied)) throw new BillingError("refundTooLarge");
    // Cash is handed back from the drawer of the site where the refund is made.
    const siteId = await currentSiteId(tx, ctx);
    await assertCashDayOpen(tx, input.refundedOn, input.method, siteId);
    const [r] = await tx
      .insert(refunds)
      .values({ organizationId: ctx.organizationId, branchId: siteId, paymentId, amountMinor: input.amountMinor, method: input.method, refundedOn: input.refundedOn, reference: input.reference || null, reason: input.reason.trim(), createdByUserId: ctx.userId })
      .returning({ id: refunds.id });
    await audit(tx, { ...staff(ctx), action: "payment.refunded", entityType: "refund", entityId: r!.id, patientId: pay.patientId, metadata: { paymentId, amountMinor: input.amountMinor } });
    return r!.id;
  });
}

/** Reverses a payment recorded in error (or a bounced cheque). Allocations are released explicitly first. */
export async function reversePayment(ctx: ClinicContext, paymentId: string, reason: string) {
  requirePermission(ctx, "payment.reverse");
  if (!reason.trim()) throw new BillingError("reasonRequired");
  return tenantTx(ctx, async (tx) => {
    const [pay] = await tx
      .select({ id: payments.id, patientId: payments.patientId, status: payments.status, refunded: paymentRefundedSql, method: payments.method, receivedOn: payments.receivedOn, branchId: payments.branchId })
      .from(payments)
      .where(eq(payments.id, paymentId))
      .for("update", { of: payments });
    if (!pay) throw new BillingError("notFound");
    if (pay.status !== "posted") throw new BillingError("paymentReversed");
    if (Number(pay.refunded) > 0) throw new BillingError("hasRefunds");
    // Reversing a cash receipt changes that day's drawer: refused once the day is closed (like any cash entry).
    await assertCashDayOpen(tx, pay.receivedOn, pay.method, pay.branchId ?? (await mainSiteId(tx)));
    const allocs = await tx
      .select({ invoiceId: paymentAllocations.invoiceId, total: sql<number>`sum(${paymentAllocations.amountMinor})::bigint` })
      .from(paymentAllocations)
      .where(eq(paymentAllocations.paymentId, paymentId))
      .groupBy(paymentAllocations.invoiceId);
    for (const a of allocs) {
      if (Number(a.total) > 0) {
        await tx.insert(paymentAllocations).values({ organizationId: ctx.organizationId, paymentId, invoiceId: a.invoiceId, amountMinor: -Number(a.total), reason: "released_by_payment_reversal", createdByUserId: ctx.userId });
      }
    }
    await tx.update(payments).set({ status: "reversed", reversedAt: new Date(), reversedByUserId: ctx.userId, reversalReason: reason.trim() }).where(eq(payments.id, paymentId));
    await audit(tx, { ...staff(ctx), action: "payment.reversed", entityType: "payment", entityId: paymentId, patientId: pay.patientId, metadata: { reopenedInvoices: allocs.length } });
  });
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export async function getInvoice(ctx: ClinicContext, invoiceId: string) {
  requirePermission(ctx, "invoice.read");
  return tenantTx(ctx, async (tx) => {
    const [row] = await tx
      .select({ inv: invoices, paid: invoicePaidSql, credited: invoiceCreditedSql, patient: patients, le: legalEntities })
      .from(invoices)
      .innerJoin(patients, eq(patients.id, invoices.patientId))
      .innerJoin(legalEntities, eq(legalEntities.id, invoices.legalEntityId))
      .where(eq(invoices.id, invoiceId))
      .limit(1);
    if (!row) return null;
    const lines = await tx
      .select({ line: invoiceLines, providerName: memberships.displayName, providerTitle: memberships.title })
      .from(invoiceLines)
      .leftJoin(memberships, eq(memberships.id, invoiceLines.providerId))
      .where(eq(invoiceLines.invoiceId, invoiceId))
      .orderBy(asc(invoiceLines.sortOrder));
    const allocations = await tx
      .select({
        id: paymentAllocations.id,
        amountMinor: paymentAllocations.amountMinor,
        reason: paymentAllocations.reason,
        createdAt: paymentAllocations.createdAt,
        paymentId: payments.id,
        receiptNumber: payments.receiptNumber,
        method: payments.method,
        receivedOn: payments.receivedOn,
      })
      .from(paymentAllocations)
      .innerJoin(payments, eq(payments.id, paymentAllocations.paymentId))
      .where(eq(paymentAllocations.invoiceId, invoiceId))
      .orderBy(asc(paymentAllocations.createdAt));
    const credits = await tx.select().from(creditNotes).where(eq(creditNotes.invoiceId, invoiceId)).orderBy(asc(creditNotes.createdAt));
    const paid = Number(row.paid);
    const credited = Number(row.credited);
    // Unapplied credit of the same patient that could settle this invoice.
    const available = can(ctx, "payment.receive")
      ? (
          await tx
            .select({ id: payments.id, receiptNumber: payments.receiptNumber, unapplied: paymentUnappliedSql })
            .from(payments)
            .where(and(eq(payments.patientId, row.inv.patientId), eq(payments.status, "posted"), eq(payments.legalEntityId, row.inv.legalEntityId)))
        )
          .map((p) => ({ ...p, unapplied: Number(p.unapplied) }))
          .filter((p) => p.unapplied > 0)
      : [];
    return {
      invoice: row.inv,
      patient: row.patient,
      legalEntity: row.le,
      lines,
      allocations: allocations.map((a) => ({ ...a, amountMinor: Number(a.amountMinor) })),
      credits,
      paidMinor: paid,
      creditedMinor: credited,
      balanceMinor: row.inv.totalMinor - paid - credited,
      state: paymentState({ status: row.inv.status, totalMinor: row.inv.totalMinor, paidMinor: paid, creditedMinor: credited }),
      availableCredit: available,
    };
  });
}

function can(ctx: ClinicContext, p: Parameters<typeof requirePermission>[1]) {
  return ctx.permissions.includes(p);
}

export type InvoiceFilter = {
  from?: string | null;
  to?: string | null;
  state?: "all" | "open" | "paid" | "draft" | "void";
  q?: string | null;
  patientId?: string | null;
  page?: number;
  pageSize?: number;
};

export async function listInvoices(ctx: ClinicContext, f: InvoiceFilter) {
  requirePermission(ctx, "invoice.read");
  const pageSize = Math.min(Math.max(f.pageSize ?? 25, 1), 200);
  const page = Math.max(f.page ?? 1, 1);
  const where: SQL[] = [];
  if (f.from) where.push(or(gte(invoices.documentDate, f.from), and(isNull(invoices.documentDate), gte(sql`${invoices.createdAt}::date`, f.from)))!);
  if (f.to) where.push(or(lte(invoices.documentDate, f.to), and(isNull(invoices.documentDate), lte(sql`${invoices.createdAt}::date`, f.to)))!);
  if (f.patientId) where.push(eq(invoices.patientId, f.patientId));
  if (f.state === "draft") where.push(eq(invoices.status, "draft"));
  else if (f.state === "void") where.push(eq(invoices.status, "void"));
  else if (f.state === "open") where.push(and(eq(invoices.status, "issued"), sql`${invoiceBalanceSql} > 0`)!);
  else if (f.state === "paid") where.push(and(eq(invoices.status, "issued"), sql`${invoiceBalanceSql} <= 0`)!);
  if (f.q?.trim()) {
    const term = `%${f.q.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")}%`;
    where.push(or(sql`lower(${invoices.number}) like ${term}`, sql`${patients.searchText} like ${term}`)!);
  }
  const cond = where.length ? and(...where) : undefined;
  return tenantTx(ctx, async (tx) => {
    const rows = await tx
      .select({
        id: invoices.id,
        number: invoices.number,
        status: invoices.status,
        documentDate: invoices.documentDate,
        createdAt: invoices.createdAt,
        currency: invoices.currency,
        totalMinor: invoices.totalMinor,
        paidMinor: invoicePaidSql,
        creditedMinor: invoiceCreditedSql,
        patientId: patients.id,
        patientNumber: patients.patientNumber,
        firstName: patients.firstName,
        lastName: patients.lastName,
      })
      .from(invoices)
      .innerJoin(patients, eq(patients.id, invoices.patientId))
      .where(cond)
      .orderBy(desc(sql`coalesce(${invoices.documentDate}, ${invoices.createdAt}::date)`), desc(invoices.number), desc(invoices.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    // Totals for the whole filtered result (issued only), separate from the page.
    const [totals] = await tx
      .select({
        n: count(),
        total: sql<number>`coalesce(sum(case when ${invoices.status} = 'issued' then ${invoices.totalMinor} end), 0)::bigint`,
        paid: sql<number>`coalesce(sum(case when ${invoices.status} = 'issued' then ${invoicePaidSql} end), 0)::bigint`,
        credited: sql<number>`coalesce(sum(case when ${invoices.status} = 'issued' then ${invoiceCreditedSql} end), 0)::bigint`,
      })
      .from(invoices)
      .innerJoin(patients, eq(patients.id, invoices.patientId))
      .where(cond);
    const mapped = rows.map((r) => {
      const paidMinor = Number(r.paidMinor);
      const creditedMinor = Number(r.creditedMinor);
      return { ...r, paidMinor, creditedMinor, balanceMinor: r.status === "issued" ? r.totalMinor - paidMinor - creditedMinor : 0, state: paymentState({ status: r.status, totalMinor: r.totalMinor, paidMinor, creditedMinor }) };
    });
    const total = Number(totals?.total ?? 0);
    const paid = Number(totals?.paid ?? 0);
    const credited = Number(totals?.credited ?? 0);
    return { rows: mapped, count: totals?.n ?? 0, page, pageSize, totals: { totalMinor: total, paidMinor: paid, creditedMinor: credited, balanceMinor: total - paid - credited } };
  });
}

/** Patient account: invoices, payments and the resulting balance / unapplied credit. */
export async function getPatientAccount(ctx: ClinicContext, patientId: string) {
  requirePermission(ctx, "invoice.read");
  const invoiceList = await listInvoices(ctx, { patientId, state: "all", pageSize: 200 });
  const paymentRows = can(ctx, "payment.read")
    ? await tenantTx(ctx, (tx) =>
        tx
          .select({
            id: payments.id,
            receiptNumber: payments.receiptNumber,
            receivedOn: payments.receivedOn,
            method: payments.method,
            purpose: payments.purpose,
            status: payments.status,
            amountMinor: payments.amountMinor,
            currency: payments.currency,
            allocatedMinor: paymentAllocatedSql,
            refundedMinor: paymentRefundedSql,
            unappliedMinor: paymentUnappliedSql,
          })
          .from(payments)
          .where(eq(payments.patientId, patientId))
          .orderBy(desc(payments.receivedOn), desc(payments.createdAt)),
      )
    : [];
  const paymentsList = paymentRows.map((p) => ({ ...p, allocatedMinor: Number(p.allocatedMinor), refundedMinor: Number(p.refundedMinor), unappliedMinor: Number(p.unappliedMinor) }));
  const outstandingMinor = invoiceList.rows.reduce((s, r) => s + (r.status === "issued" ? r.balanceMinor : 0), 0);
  const unappliedMinor = paymentsList.reduce((s, p) => s + p.unappliedMinor, 0);
  return { invoices: invoiceList.rows, payments: paymentsList, outstandingMinor, unappliedMinor };
}

export async function getPayment(ctx: ClinicContext, paymentId: string) {
  requirePermission(ctx, "payment.read");
  return tenantTx(ctx, async (tx) => {
    const [row] = await tx
      .select({ pay: payments, allocated: paymentAllocatedSql, refunded: paymentRefundedSql, unapplied: paymentUnappliedSql, patient: patients, le: legalEntities })
      .from(payments)
      .innerJoin(patients, eq(patients.id, payments.patientId))
      .innerJoin(legalEntities, eq(legalEntities.id, payments.legalEntityId))
      .where(eq(payments.id, paymentId))
      .limit(1);
    if (!row) return null;
    const allocations = await tx
      .select({ invoiceId: invoices.id, number: invoices.number, amountMinor: sql<number>`sum(${paymentAllocations.amountMinor})::bigint` })
      .from(paymentAllocations)
      .innerJoin(invoices, eq(invoices.id, paymentAllocations.invoiceId))
      .where(eq(paymentAllocations.paymentId, paymentId))
      .groupBy(invoices.id, invoices.number);
    const refundRows = await tx.select().from(refunds).where(eq(refunds.paymentId, paymentId)).orderBy(asc(refunds.createdAt));
    return {
      payment: row.pay,
      patient: row.patient,
      legalEntity: row.le,
      allocatedMinor: Number(row.allocated),
      refundedMinor: Number(row.refunded),
      unappliedMinor: Number(row.unapplied),
      allocations: allocations.map((a) => ({ ...a, amountMinor: Number(a.amountMinor) })).filter((a) => a.amountMinor !== 0),
      refunds: refundRows,
    };
  });
}
