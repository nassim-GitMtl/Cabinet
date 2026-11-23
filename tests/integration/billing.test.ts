import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  applyPaymentToInvoice,
  BillingError,
  createInvoiceFromProcedures,
  getInvoice,
  getPatientAccount,
  issueCreditNote,
  listInvoices,
  listPatientsReadyToInvoice,
  listUnbilledProcedures,
  recordPayment,
  refundPayment,
  reversePayment,
  voidInvoice,
} from "@/features/billing/server";
import { getServicePickerData, updateService } from "@/features/catalog/server";
import { createPatient } from "@/features/patients/server";
import { changePerformedProcedureStatus, getProcedureEntrySupport, recordPerformedProcedure } from "@/features/procedures/server";
import { todayInZone } from "@/lib/dates";
import { ForbiddenError } from "@/server/auth/context";
import { invoiceLines, invoices, paymentAllocations, payments } from "@/server/db/schema";
import { withDbContext } from "@/server/db/tenant";
import { contextFor, expectDbError, makeClinic } from "../support/factories";

const patientInput = {
  firstName: "Karima",
  lastName: "Facture",
  firstNameAr: null,
  lastNameAr: null,
  sex: undefined,
  birthDate: null,
  birthDatePrecision: "exact" as const,
  phone: null,
  phoneAlt: null,
  email: null,
  addressLine: null,
  city: null,
  region: null,
  preferredLocale: "fr" as const,
  emergencyName: null,
  emergencyRelationship: null,
  emergencyPhone: null,
  referralSource: null,
  referredBy: null,
  administrativeNotes: null,
  assignedProviderId: null,
};

async function setup(name: string) {
  const ctx = await makeClinic(name);
  const p = await createPatient(ctx, patientInput, { confirmNotDuplicate: true });
  if (p.status !== "created") throw new Error("fixture");
  const [picker, support] = await Promise.all([getServicePickerData(ctx), getProcedureEntrySupport(ctx)]);
  const services = picker.categories.flatMap((c) => c.services);
  const today = todayInZone(ctx.organization.timezone);
  const perform = async (code: string, unitPriceMinor?: number) => {
    const svc = services.find((s) => s.code === code)!;
    const r = await recordPerformedProcedure(ctx, p.id, {
      serviceId: svc.id,
      branchId: support.branches[0]!.id,
      performingProviderId: support.providers[0]!.id,
      serviceDate: today,
      quantity: 1,
      unitPriceMinor: unitPriceMinor ?? svc.priceMinor,
      priceOverrideReason: unitPriceMinor !== undefined ? "Tarif négocié" : null,
      toothNumber: null,
      surfaces: [],
      arch: null,
      quadrant: null,
    });
    return r.id;
  };
  return { ctx, patientId: p.id, perform, services, today };
}

const pay = (ctx: Awaited<ReturnType<typeof setup>>, amountMinor: number, allocateTo: string | "auto" | null, key = randomUUID()) =>
  recordPayment(ctx.ctx, { patientId: ctx.patientId, amountMinor, method: "cash", receivedOn: ctx.today, idempotencyKey: key, allocateTo });

describe("invoicing from completed work", () => {
  it("bills procedures once, numbers sequentially and snapshots prices", async () => {
    const f = await setup("Cabinet Fact A");
    const a = await f.perform("CONS-01"); // 1 500 DA
    const b = await f.perform("PREV-01"); // 4 000 DA
    expect((await listUnbilledProcedures(f.ctx, f.patientId)).map((x) => x.id).sort()).toEqual([a, b].sort());
    expect(await listPatientsReadyToInvoice(f.ctx)).toEqual([
      expect.objectContaining({ patientId: f.patientId, procedureCount: 2, amountMinor: 550000 }),
    ]);

    const id = await createInvoiceFromProcedures(f.ctx, f.patientId, { procedureIds: [a, b], issueNow: true });
    const inv = (await getInvoice(f.ctx, id))!;
    expect(inv.invoice.status).toBe("issued");
    expect(inv.invoice.number).toMatch(/^F-\d{4}-00001$/);
    expect(inv.invoice.totalMinor).toBe(550000);
    expect(inv.state).toBe("unpaid");
    expect(await listUnbilledProcedures(f.ctx, f.patientId)).toHaveLength(0);
    expect(await listPatientsReadyToInvoice(f.ctx)).toHaveLength(0);

    // The same work cannot be billed twice.
    await expect(createInvoiceFromProcedures(f.ctx, f.patientId, { procedureIds: [a], issueNow: true })).rejects.toMatchObject({ code: "alreadyBilled" });

    // A later catalog price change leaves the issued invoice intact.
    const svc = f.services.find((s) => s.code === "CONS-01")!;
    await updateService(f.ctx, svc.id, { categoryId: svc.categoryId, code: svc.code, nameFr: svc.name.fr, pricingUnit: "procedure", anatomy: "none", defaultDurationMin: 20, priceMinor: 999900 }, svc.version);
    expect((await getInvoice(f.ctx, id))!.invoice.totalMinor).toBe(550000);

    const second = await createInvoiceFromProcedures(f.ctx, f.patientId, { procedureIds: [await f.perform("CONS-03")], issueNow: true });
    expect((await getInvoice(f.ctx, second))!.invoice.number).toMatch(/-00002$/);
  });

  it("issued invoices and their lines cannot be edited or deleted", async () => {
    const f = await setup("Cabinet Fact B");
    const id = await createInvoiceFromProcedures(f.ctx, f.patientId, { procedureIds: [await f.perform("CONS-01")], issueNow: true });
    const db = { organizationId: f.ctx.organizationId, userId: f.ctx.userId, actorType: "staff" as const };
    await expectDbError(withDbContext(db, (tx) => tx.update(invoices).set({ totalMinor: 1 }).where(eq(invoices.id, id))), /immutable/);
    await expectDbError(withDbContext(db, (tx) => tx.update(invoiceLines).set({ unitPriceMinor: 1 }).where(eq(invoiceLines.invoiceId, id))), /immutable/);
    await expectDbError(withDbContext(db, (tx) => tx.delete(invoices).where(eq(invoices.id, id))), /only draft/);
  });

  it("voiding releases the work for a new invoice; reversed work cannot be issued", async () => {
    const f = await setup("Cabinet Fact C");
    const proc = await f.perform("CONS-01");
    const id = await createInvoiceFromProcedures(f.ctx, f.patientId, { procedureIds: [proc], issueNow: true });
    await voidInvoice(f.ctx, id, "Erreur de patient");
    expect(await listUnbilledProcedures(f.ctx, f.patientId)).toHaveLength(1);

    const draft = await createInvoiceFromProcedures(f.ctx, f.patientId, { procedureIds: [proc], issueNow: false });
    await changePerformedProcedureStatus(f.ctx, proc, { status: "entered_in_error", reason: "Saisie en double" } as never);
    await expect(createInvoiceFromProcedures(f.ctx, f.patientId, { procedureIds: [proc], issueNow: true })).rejects.toBeInstanceOf(BillingError);
    const { issueInvoice } = await import("@/features/billing/server");
    await expect(issueInvoice(f.ctx, draft)).rejects.toMatchObject({ code: "procedureUnavailable" });
  });
});

describe("payments, deposits, credits and refunds", () => {
  it("partial payment, then deposit applied later, without counting the deposit twice", async () => {
    const f = await setup("Cabinet Pay A");
    const inv = await createInvoiceFromProcedures(f.ctx, f.patientId, { procedureIds: [await f.perform("PREV-01")], issueNow: true }); // 4 000
    await pay(f, 150000, inv);
    let state = (await getInvoice(f.ctx, inv))!;
    expect(state.state).toBe("partial");
    expect(state.balanceMinor).toBe(250000);

    const deposit = await pay(f, 300000, null); // advance deposit, unapplied
    let account = await getPatientAccount(f.ctx, f.patientId);
    expect(account.unappliedMinor).toBe(300000);
    await applyPaymentToInvoice(f.ctx, deposit.id, inv);
    state = (await getInvoice(f.ctx, inv))!;
    expect(state.state).toBe("paid");
    account = await getPatientAccount(f.ctx, f.patientId);
    expect(account.unappliedMinor).toBe(50000);
    expect(account.outstandingMinor).toBe(0);
    // Only two receipts exist: applying the deposit was not a new receipt.
    expect(account.payments).toHaveLength(2);
  });

  it("is idempotent on retried submissions", async () => {
    const f = await setup("Cabinet Pay B");
    const inv = await createInvoiceFromProcedures(f.ctx, f.patientId, { procedureIds: [await f.perform("CONS-01")], issueNow: true });
    const key = randomUUID();
    const [r1, r2] = await Promise.all([pay(f, 100000, inv, key), pay(f, 100000, inv, key)].map((p) => p.catch((e) => e)));
    const ok = [r1, r2].filter((r) => r && typeof r === "object" && "id" in r);
    expect(ok.length).toBeGreaterThanOrEqual(1);
    const again = await pay(f, 100000, inv, key);
    expect(again.duplicate).toBe(true);
    expect((await getPatientAccount(f.ctx, f.patientId)).payments).toHaveLength(1);
    expect((await getInvoice(f.ctx, inv))!.paidMinor).toBe(100000);
  });

  it("overpayment stays as visible credit; auto-allocation pays oldest first", async () => {
    const f = await setup("Cabinet Pay C");
    const i1 = await createInvoiceFromProcedures(f.ctx, f.patientId, { procedureIds: [await f.perform("CONS-01")], issueNow: true }); // 1 500
    const i2 = await createInvoiceFromProcedures(f.ctx, f.patientId, { procedureIds: [await f.perform("CONS-03")], issueNow: true }); // 1 000
    await pay(f, 300000, "auto");
    expect((await getInvoice(f.ctx, i1))!.state).toBe("paid");
    expect((await getInvoice(f.ctx, i2))!.state).toBe("paid");
    expect((await getPatientAccount(f.ctx, f.patientId)).unappliedMinor).toBe(50000);
  });

  it("credit note on a paid invoice releases funds that can then be refunded", async () => {
    const f = await setup("Cabinet Pay D");
    const inv = await createInvoiceFromProcedures(f.ctx, f.patientId, { procedureIds: [await f.perform("PREV-01")], issueNow: true }); // 4 000
    const p = await pay(f, 400000, inv);
    await issueCreditNote(f.ctx, inv, 100000, "Geste commercial");
    const state = (await getInvoice(f.ctx, inv))!;
    expect(state.creditedMinor).toBe(100000);
    expect(state.paidMinor).toBe(300000);
    expect(state.balanceMinor).toBe(0);
    expect((await getPatientAccount(f.ctx, f.patientId)).unappliedMinor).toBe(100000);

    await expect(refundPayment(f.ctx, p.id, { amountMinor: 100001, method: "cash", reason: "Remb.", refundedOn: f.today })).rejects.toMatchObject({ code: "refundTooLarge" });
    await refundPayment(f.ctx, p.id, { amountMinor: 100000, method: "cash", reason: "Remboursement", refundedOn: f.today });
    expect((await getPatientAccount(f.ctx, f.patientId)).unappliedMinor).toBe(0);
    await expect(refundPayment(f.ctx, p.id, { amountMinor: 1, method: "cash", reason: "Encore", refundedOn: f.today })).rejects.toMatchObject({ code: "refundTooLarge" });
    // A paid invoice cannot be voided.
    await expect(voidInvoice(f.ctx, inv, "Annulation")).rejects.toMatchObject({ code: "hasPayments" });
  });

  it("reversing a payment reopens the invoice balance", async () => {
    const f = await setup("Cabinet Pay E");
    const inv = await createInvoiceFromProcedures(f.ctx, f.patientId, { procedureIds: [await f.perform("CONS-01")], issueNow: true });
    const p = await pay(f, 150000, inv);
    await reversePayment(f.ctx, p.id, "Chèque rejeté");
    const state = (await getInvoice(f.ctx, inv))!;
    expect(state.state).toBe("unpaid");
    expect(state.balanceMinor).toBe(150000);
    const listed = await listInvoices(f.ctx, { state: "open" });
    expect(listed.totals.balanceMinor).toBe(150000);
  });

  it("the database rejects over-allocation even if application checks are bypassed", async () => {
    const f = await setup("Cabinet Pay F");
    const inv = await createInvoiceFromProcedures(f.ctx, f.patientId, { procedureIds: [await f.perform("CONS-01")], issueNow: true }); // 1 500
    const p = await pay(f, 100000, null);
    const db = { organizationId: f.ctx.organizationId, userId: f.ctx.userId, actorType: "staff" as const };
    await expectDbError(
      withDbContext(db, (tx) => tx.insert(paymentAllocations).values({ organizationId: f.ctx.organizationId, paymentId: p.id, invoiceId: inv, amountMinor: 100001, createdByUserId: f.ctx.userId })),
      /over-allocated/,
    );
    await expectDbError(withDbContext(db, (tx) => tx.delete(paymentAllocations)), /permission denied/);
    await expectDbError(withDbContext(db, (tx) => tx.update(payments).set({ amountMinor: 1 }).where(eq(payments.id, p.id))), /immutable/);
  });

  it("enforces finance permissions and tenant isolation", async () => {
    const f = await setup("Cabinet Pay G");
    const inv = await createInvoiceFromProcedures(f.ctx, f.patientId, { procedureIds: [await f.perform("CONS-01")], issueNow: true });
    const receptionist = contextFor(f.ctx, "receptionist");
    await expect(refundPayment(receptionist, randomUUID(), { amountMinor: 1, method: "cash", reason: "x", refundedOn: f.today })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(issueCreditNote(receptionist, inv, 1, "x")).rejects.toBeInstanceOf(ForbiddenError);
    const hygienist = contextFor(f.ctx, "hygienist");
    await expect(listInvoices(hygienist, {})).rejects.toBeInstanceOf(ForbiddenError);
    const other = await makeClinic("Cabinet Pay H");
    expect(await getInvoice(other, inv)).toBeNull();
    expect((await listInvoices(other, {})).count).toBe(0);
  });
});
