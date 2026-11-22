import "server-only";
import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { audit } from "@/server/audit";
import { requirePermission, tenantTx, type ClinicContext } from "@/server/auth/context";
import type { Tx } from "@/server/db/client";
import { cashMovements, cashSessions, expenses, honorariumPayments, legalEntities, payments, refunds, suppliers, users } from "@/server/db/schema";
import { todayInZone } from "@/lib/dates";

export class CashError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}

export const EXPENSE_CATEGORIES = [
  "rent",
  "salaries",
  "lab",
  "supplies",
  "equipment",
  "maintenance",
  "utilities",
  "taxes",
  "bank_fees",
  "other",
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];
export type PayMethod = "cash" | "card" | "bank_transfer" | "cheque" | "other";

const staff = (ctx: ClinicContext) => ({ organizationId: ctx.organizationId, actorType: "staff" as const, actorUserId: ctx.userId });

/**
 * Cash movements dated on a closed day would silently change a signed-off
 * count. Blocks cash entries for a business date whose session is closed.
 */
export async function assertCashDayOpen(tx: Tx, date: string, method: PayMethod) {
  if (method !== "cash") return;
  const [s] = await tx.select({ status: cashSessions.status }).from(cashSessions).where(eq(cashSessions.businessDate, date)).limit(1);
  if (s && s.status !== "open") throw new CashError("cashSessionClosed");
}

// ---------------------------------------------------------------------------
// Cash day
// ---------------------------------------------------------------------------

async function cashBreakdown(tx: Tx, date: string, sessionId: string | null) {
  const [rec] = await tx
    .select({ total: sql<number>`coalesce(sum(${payments.amountMinor}), 0)::bigint`, n: sql<number>`count(*)::int` })
    .from(payments)
    .where(and(eq(payments.status, "posted"), eq(payments.method, "cash"), eq(payments.receivedOn, date)));
  const nonCash = await tx
    .select({ method: payments.method, total: sql<number>`sum(${payments.amountMinor})::bigint` })
    .from(payments)
    .where(and(eq(payments.status, "posted"), sql`${payments.method} <> 'cash'`, eq(payments.receivedOn, date)))
    .groupBy(payments.method);
  const [ref] = await tx
    .select({ total: sql<number>`coalesce(sum(${refunds.amountMinor}), 0)::bigint` })
    .from(refunds)
    .where(and(eq(refunds.method, "cash"), eq(refunds.refundedOn, date)));
  const [exp] = await tx
    .select({ total: sql<number>`coalesce(sum(${expenses.amountMinor}), 0)::bigint` })
    .from(expenses)
    .where(and(eq(expenses.status, "paid"), eq(expenses.paymentMethod, "cash"), eq(expenses.paidOn, date)));
  // Practitioner fees handed over in cash (a reversal is a negative row: the money came back).
  const [fees] = await tx
    .select({ total: sql<number>`coalesce(sum(${honorariumPayments.amountMinor}), 0)::bigint` })
    .from(honorariumPayments)
    .where(and(eq(honorariumPayments.method, "cash"), eq(honorariumPayments.paidOn, date)));
  const movements = sessionId
    ? await tx.select().from(cashMovements).where(eq(cashMovements.cashSessionId, sessionId)).orderBy(asc(cashMovements.createdAt))
    : [];
  const transfersIn = movements.filter((m) => m.direction === "in").reduce((s, m) => s + m.amountMinor, 0);
  const transfersOut = movements.filter((m) => m.direction === "out").reduce((s, m) => s + m.amountMinor, 0);
  return {
    cashReceiptsMinor: Number(rec?.total ?? 0),
    cashReceiptCount: Number(rec?.n ?? 0),
    cashRefundsMinor: Number(ref?.total ?? 0),
    cashExpensesMinor: Number(exp?.total ?? 0),
    cashHonorariaMinor: Number(fees?.total ?? 0),
    transfersInMinor: transfersIn,
    transfersOutMinor: transfersOut,
    movements,
    nonCash: nonCash.map((n) => ({ method: n.method, totalMinor: Number(n.total) })),
  };
}

const expectedOf = (float: number, b: Awaited<ReturnType<typeof cashBreakdown>>) =>
  float + b.cashReceiptsMinor - b.cashRefundsMinor - b.cashExpensesMinor - b.cashHonorariaMinor + b.transfersInMinor - b.transfersOutMinor;

export async function getCashDay(ctx: ClinicContext, date: string) {
  requirePermission(ctx, "cash.manage");
  return tenantTx(ctx, async (tx) => {
    const [session] = await tx.select().from(cashSessions).where(eq(cashSessions.businessDate, date)).limit(1);
    const breakdown = await cashBreakdown(tx, date, session?.id ?? null);
    const liveExpected = session ? expectedOf(session.openingFloatMinor, breakdown) : null;
    const names = new Map<string, string>();
    if (session) {
      const ids = [session.openedByUserId, session.closedByUserId, session.approvedByUserId].filter(Boolean) as string[];
      for (const u of await tx.select({ id: users.id, name: users.fullName }).from(users).where(inArray(users.id, ids))) names.set(u.id, u.name);
    }
    return {
      date,
      session,
      breakdown,
      liveExpectedMinor: liveExpected,
      /** True when entries were dated on this day after it was closed (should not happen: blocked). */
      changedSinceClose: session && session.status !== "open" && liveExpected !== session.expectedMinor,
      names: Object.fromEntries(names),
    };
  });
}

export async function openCashSession(ctx: ClinicContext, date: string, openingFloatMinor: number) {
  requirePermission(ctx, "cash.manage");
  if (date > todayInZone(ctx.organization.timezone)) throw new CashError("futureDate");
  if (!Number.isSafeInteger(openingFloatMinor) || openingFloatMinor < 0) throw new CashError("invalidAmount");
  return tenantTx(ctx, async (tx) => {
    const [existing] = await tx.select({ id: cashSessions.id }).from(cashSessions).where(eq(cashSessions.businessDate, date)).limit(1);
    if (existing) return existing.id;
    const [s] = await tx
      .insert(cashSessions)
      .values({ organizationId: ctx.organizationId, businessDate: date, currency: ctx.organization.defaultCurrency, openingFloatMinor, openedByUserId: ctx.userId })
      .onConflictDoNothing()
      .returning({ id: cashSessions.id });
    const id = s?.id ?? (await tx.select({ id: cashSessions.id }).from(cashSessions).where(eq(cashSessions.businessDate, date)))[0]!.id;
    await audit(tx, { ...staff(ctx), action: "cash.session.opened", entityType: "cash_session", entityId: id, metadata: { date, openingFloatMinor } });
    return id;
  });
}

export async function addCashMovement(ctx: ClinicContext, sessionId: string, direction: "in" | "out", amountMinor: number, reason: string) {
  requirePermission(ctx, "cash.manage");
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) throw new CashError("invalidAmount");
  if (!reason.trim()) throw new CashError("reasonRequired");
  return tenantTx(ctx, async (tx) => {
    const [s] = await tx.select({ status: cashSessions.status }).from(cashSessions).where(eq(cashSessions.id, sessionId)).for("update");
    if (!s) throw new CashError("notFound");
    if (s.status !== "open") throw new CashError("cashSessionClosed");
    await tx.insert(cashMovements).values({ organizationId: ctx.organizationId, cashSessionId: sessionId, direction, amountMinor, reason: reason.trim(), createdByUserId: ctx.userId });
    await audit(tx, { ...staff(ctx), action: "cash.movement.added", entityType: "cash_session", entityId: sessionId, metadata: { direction, amountMinor } });
  });
}

export async function closeCashSession(ctx: ClinicContext, sessionId: string, countedMinor: number, discrepancyReason: string | null, notes: string | null) {
  requirePermission(ctx, "cash.close");
  if (!Number.isSafeInteger(countedMinor) || countedMinor < 0) throw new CashError("invalidAmount");
  return tenantTx(ctx, async (tx) => {
    const [s] = await tx.select().from(cashSessions).where(eq(cashSessions.id, sessionId)).for("update");
    if (!s) throw new CashError("notFound");
    if (s.status !== "open") throw new CashError("cashSessionClosed");
    const expected = expectedOf(s.openingFloatMinor, await cashBreakdown(tx, s.businessDate, s.id));
    if (countedMinor !== expected && !discrepancyReason?.trim()) throw new CashError("discrepancyReasonRequired");
    await tx
      .update(cashSessions)
      .set({
        status: "closed",
        expectedMinor: expected,
        countedMinor,
        discrepancyReason: countedMinor !== expected ? discrepancyReason!.trim() : null,
        notes: notes?.trim() || null,
        closedByUserId: ctx.userId,
        closedAt: new Date(),
      })
      .where(eq(cashSessions.id, sessionId));
    await audit(tx, { ...staff(ctx), action: "cash.session.closed", entityType: "cash_session", entityId: sessionId, metadata: { expectedMinor: expected, countedMinor, discrepancyMinor: countedMinor - expected } });
    return { expectedMinor: expected, discrepancyMinor: countedMinor - expected };
  });
}

export async function approveCashSession(ctx: ClinicContext, sessionId: string) {
  requirePermission(ctx, "cash.close.approve");
  return tenantTx(ctx, async (tx) => {
    const [s] = await tx.select({ status: cashSessions.status }).from(cashSessions).where(eq(cashSessions.id, sessionId)).for("update");
    if (!s) throw new CashError("notFound");
    if (s.status !== "closed") throw new CashError("notClosed");
    await tx.update(cashSessions).set({ status: "approved", approvedByUserId: ctx.userId, approvedAt: new Date() }).where(eq(cashSessions.id, sessionId));
    await audit(tx, { ...staff(ctx), action: "cash.session.approved", entityType: "cash_session", entityId: sessionId });
  });
}

export async function listCashSessions(ctx: ClinicContext, limit = 30) {
  requirePermission(ctx, "cash.manage");
  return tenantTx(ctx, (tx) => tx.select().from(cashSessions).orderBy(desc(cashSessions.businessDate)).limit(limit));
}

// ---------------------------------------------------------------------------
// Expenses
// ---------------------------------------------------------------------------

export type ExpenseInput = {
  category: ExpenseCategory;
  supplierName: string | null;
  reference: string | null;
  description: string;
  expenseDate: string;
  amountMinor: number;
  paid: boolean;
  paidOn: string | null;
  paymentMethod: PayMethod | null;
};

async function supplierId(tx: Tx, ctx: ClinicContext, name: string | null) {
  if (!name?.trim()) return null;
  const [found] = await tx.select({ id: suppliers.id }).from(suppliers).where(sql`lower(${suppliers.name}) = lower(${name.trim()})`).limit(1);
  if (found) return found.id;
  const [created] = await tx.insert(suppliers).values({ organizationId: ctx.organizationId, name: name.trim() }).returning({ id: suppliers.id });
  return created!.id;
}

export async function createExpense(ctx: ClinicContext, input: ExpenseInput) {
  requirePermission(ctx, "expense.manage");
  const today = todayInZone(ctx.organization.timezone);
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) throw new CashError("invalidAmount");
  if (input.expenseDate > today || (input.paidOn && input.paidOn > today)) throw new CashError("futureDate");
  if (input.paid && (!input.paidOn || !input.paymentMethod)) throw new CashError("paymentDetailsRequired");
  return tenantTx(ctx, async (tx) => {
    if (input.paid) await assertCashDayOpen(tx, input.paidOn!, input.paymentMethod!);
    const [le] = await tx.select().from(legalEntities).orderBy(desc(legalEntities.isDefault)).limit(1);
    const [e] = await tx
      .insert(expenses)
      .values({
        organizationId: ctx.organizationId,
        legalEntityId: le!.id,
        category: input.category,
        supplierId: await supplierId(tx, ctx, input.supplierName),
        reference: input.reference,
        description: input.description,
        expenseDate: input.expenseDate,
        amountMinor: input.amountMinor,
        currency: le!.currency,
        status: input.paid ? "paid" : "unpaid",
        paidOn: input.paid ? input.paidOn : null,
        paymentMethod: input.paid ? input.paymentMethod : null,
        createdByUserId: ctx.userId,
      })
      .returning({ id: expenses.id });
    await audit(tx, { ...staff(ctx), action: "expense.created", entityType: "expense", entityId: e!.id, metadata: { category: input.category, amountMinor: input.amountMinor, paid: input.paid } });
    return e!.id;
  });
}

export async function markExpensePaid(ctx: ClinicContext, id: string, paidOn: string, method: PayMethod) {
  requirePermission(ctx, "expense.manage");
  if (paidOn > todayInZone(ctx.organization.timezone)) throw new CashError("futureDate");
  return tenantTx(ctx, async (tx) => {
    const [e] = await tx.select({ status: expenses.status }).from(expenses).where(eq(expenses.id, id)).for("update");
    if (!e) throw new CashError("notFound");
    if (e.status !== "unpaid") throw new CashError("notUnpaid");
    await assertCashDayOpen(tx, paidOn, method);
    await tx.update(expenses).set({ status: "paid", paidOn, paymentMethod: method }).where(eq(expenses.id, id));
    await audit(tx, { ...staff(ctx), action: "expense.paid", entityType: "expense", entityId: id, metadata: { method } });
  });
}

export async function voidExpense(ctx: ClinicContext, id: string, reason: string) {
  requirePermission(ctx, "expense.manage");
  if (!reason.trim()) throw new CashError("reasonRequired");
  return tenantTx(ctx, async (tx) => {
    const [e] = await tx.select().from(expenses).where(eq(expenses.id, id)).for("update");
    if (!e) throw new CashError("notFound");
    if (e.status === "void") return;
    if (e.status === "paid" && e.paymentMethod) await assertCashDayOpen(tx, e.paidOn!, e.paymentMethod);
    await tx.update(expenses).set({ status: "void", voidedAt: new Date(), voidReason: reason.trim() }).where(eq(expenses.id, id));
    await audit(tx, { ...staff(ctx), action: "expense.voided", entityType: "expense", entityId: id });
  });
}

export async function listExpenses(ctx: ClinicContext, f: { from: string; to: string }) {
  requirePermission(ctx, "expense.read");
  return tenantTx(ctx, async (tx) => {
    const rows = await tx
      .select({ e: expenses, supplierName: suppliers.name })
      .from(expenses)
      .leftJoin(suppliers, eq(suppliers.id, expenses.supplierId))
      .where(and(gte(expenses.expenseDate, f.from), lte(expenses.expenseDate, f.to)))
      .orderBy(desc(expenses.expenseDate), desc(expenses.createdAt));
    const live = rows.filter((r) => r.e.status !== "void");
    const byCategory = new Map<string, number>();
    for (const r of live) byCategory.set(r.e.category, (byCategory.get(r.e.category) ?? 0) + r.e.amountMinor);
    return {
      rows,
      totalMinor: live.reduce((s, r) => s + r.e.amountMinor, 0),
      unpaidMinor: live.filter((r) => r.e.status === "unpaid").reduce((s, r) => s + r.e.amountMinor, 0),
      byCategory: [...byCategory.entries()].map(([category, totalMinor]) => ({ category, totalMinor })).sort((a, b) => b.totalMinor - a.totalMinor),
    };
  });
}
