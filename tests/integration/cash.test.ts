import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createInvoiceFromProcedures, recordPayment, refundPayment } from "@/features/billing/server";
import {
  addCashMovement,
  approveCashSession,
  CashError,
  closeCashSession,
  createExpense,
  getCashDay,
  listExpenses,
  openCashSession,
  voidExpense,
} from "@/features/cash/server";
import { getServicePickerData } from "@/features/catalog/server";
import { createPatient } from "@/features/patients/server";
import { getProcedureEntrySupport, recordPerformedProcedure } from "@/features/procedures/server";
import { todayInZone } from "@/lib/dates";
import { ForbiddenError } from "@/server/auth/context";
import { cashSessions } from "@/server/db/schema";
import { withDbContext } from "@/server/db/tenant";
import { contextFor, expectDbError, makeClinic } from "../support/factories";

const blank = {
  firstNameAr: null, lastNameAr: null, sex: undefined, birthDate: null, birthDatePrecision: "exact" as const, phone: null, phoneAlt: null,
  email: null, addressLine: null, city: null, region: null, preferredLocale: "fr" as const, emergencyName: null, emergencyRelationship: null,
  emergencyPhone: null, referralSource: null, referredBy: null, administrativeNotes: null, assignedProviderId: null,
};

async function setup(name: string) {
  const ctx = await makeClinic(name);
  const p = await createPatient(ctx, { ...blank, firstName: "Cash", lastName: "Test" }, { confirmNotDuplicate: true });
  if (p.status !== "created") throw new Error("fixture");
  const [picker, support] = await Promise.all([getServicePickerData(ctx), getProcedureEntrySupport(ctx)]);
  const svc = picker.categories.flatMap((c) => c.services).find((s) => s.code === "PREV-01")!; // 4 000 DA
  const today = todayInZone(ctx.organization.timezone);
  const proc = await recordPerformedProcedure(ctx, p.id, {
    serviceId: svc.id, branchId: support.branches[0]!.id, performingProviderId: support.providers[0]!.id, serviceDate: today,
    quantity: 1, unitPriceMinor: svc.priceMinor, priceOverrideReason: null, toothNumber: null, surfaces: [], arch: null, quadrant: null,
  });
  const invoiceId = await createInvoiceFromProcedures(ctx, p.id, { procedureIds: [proc.id], issueNow: true });
  return { ctx, patientId: p.id, invoiceId, today };
}

describe("cash control", () => {
  it("expected cash counts only physical cash (card excluded) and reconciles", async () => {
    const f = await setup("Cabinet Caisse A");
    const sessionId = await openCashSession(f.ctx, f.today, 500000); // 5 000 float
    const cash = await recordPayment(f.ctx, { patientId: f.patientId, amountMinor: 300000, method: "cash", receivedOn: f.today, idempotencyKey: randomUUID(), allocateTo: f.invoiceId });
    await recordPayment(f.ctx, { patientId: f.patientId, amountMinor: 100000, method: "card", receivedOn: f.today, idempotencyKey: randomUUID(), allocateTo: f.invoiceId });
    await recordPayment(f.ctx, { patientId: f.patientId, amountMinor: 50000, method: "cash", receivedOn: f.today, idempotencyKey: randomUUID(), allocateTo: null }); // deposit
    await refundPayment(f.ctx, (await recordPayment(f.ctx, { patientId: f.patientId, amountMinor: 20000, method: "cash", receivedOn: f.today, idempotencyKey: randomUUID(), allocateTo: null })).id, { amountMinor: 20000, method: "cash", reason: "Erreur", refundedOn: f.today });
    await createExpense(f.ctx, { category: "supplies", supplierName: "Dentaire Plus", reference: null, description: "Gants", expenseDate: f.today, amountMinor: 80000, paid: true, paidOn: f.today, paymentMethod: "cash" });
    await createExpense(f.ctx, { category: "rent", supplierName: null, reference: null, description: "Loyer", expenseDate: f.today, amountMinor: 3000000, paid: true, paidOn: f.today, paymentMethod: "bank_transfer" });
    await addCashMovement(f.ctx, sessionId, "out", 200000, "Dépôt banque");

    const day = await getCashDay(f.ctx, f.today);
    // 5 000 + (3 000 + 500 + 200) − 200 refund − 800 expense − 2 000 deposit = 5 700
    expect(day.liveExpectedMinor).toBe(570000);
    expect(day.breakdown.nonCash).toEqual([{ method: "card", totalMinor: 100000 }]);

    await expect(closeCashSession(f.ctx, sessionId, 560000, null, null)).rejects.toMatchObject({ code: "discrepancyReasonRequired" });
    const closed = await closeCashSession(f.ctx, sessionId, 560000, "Pièce manquante", null);
    expect(closed.discrepancyMinor).toBe(-10000);

    // The closed day can no longer receive cash entries.
    await expect(recordPayment(f.ctx, { patientId: f.patientId, amountMinor: 100, method: "cash", receivedOn: f.today, idempotencyKey: randomUUID(), allocateTo: null })).rejects.toBeInstanceOf(CashError);
    await expect(addCashMovement(f.ctx, sessionId, "in", 100, "x")).rejects.toMatchObject({ code: "cashSessionClosed" });
    // Card payments on that day are still fine.
    await recordPayment(f.ctx, { patientId: f.patientId, amountMinor: 100, method: "card", receivedOn: f.today, idempotencyKey: randomUUID(), allocateTo: null });

    await approveCashSession(f.ctx, sessionId);
    const db = { organizationId: f.ctx.organizationId, userId: f.ctx.userId, actorType: "staff" as const };
    await expectDbError(withDbContext(db, (tx) => tx.update(cashSessions).set({ countedMinor: 1 }).where(eq(cashSessions.id, sessionId))), /immutable/);
    expect(cash.duplicate).toBe(false);
  });

  it("expenses list totals by category and excludes voided", async () => {
    const f = await setup("Cabinet Caisse B");
    const a = await createExpense(f.ctx, { category: "lab", supplierName: "Labo Atlas", reference: "F-12", description: "Couronne", expenseDate: f.today, amountMinor: 1500000, paid: false, paidOn: null, paymentMethod: null });
    await createExpense(f.ctx, { category: "lab", supplierName: "labo atlas", reference: null, description: "Bridge", expenseDate: f.today, amountMinor: 500000, paid: true, paidOn: f.today, paymentMethod: "cheque" });
    await voidExpense(f.ctx, a, "Doublon");
    const list = await listExpenses(f.ctx, { from: f.today, to: f.today });
    expect(list.totalMinor).toBe(500000);
    expect(list.unpaidMinor).toBe(0);
    expect(list.byCategory).toEqual([{ category: "lab", totalMinor: 500000 }]);
  });

  it("enforces cash permissions", async () => {
    const f = await setup("Cabinet Caisse C");
    await expect(openCashSession(contextFor(f.ctx, "dentist"), f.today, 0)).rejects.toBeInstanceOf(ForbiddenError);
    const id = await openCashSession(contextFor(f.ctx, "receptionist"), f.today, 0);
    await closeCashSession(contextFor(f.ctx, "receptionist"), id, 0, null, null);
    await expect(approveCashSession(contextFor(f.ctx, "receptionist"), id)).rejects.toBeInstanceOf(ForbiddenError);
    await approveCashSession(contextFor(f.ctx, "accountant"), id);
  });
});
