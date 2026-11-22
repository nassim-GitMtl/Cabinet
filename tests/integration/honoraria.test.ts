import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { acceptStaffInvitation } from "@/features/access/invitation";
import { createStaffInvitation } from "@/features/access/server";
import { createInvoiceFromProcedures, issueCreditNote, issueInvoice, recordPayment, type CheckoutLineOption } from "@/features/billing/server";
import { closeCashSession, getCashDay, openCashSession } from "@/features/cash/server";
import { getServicePickerData, updateService } from "@/features/catalog/server";
import {
  adjustHonorarium,
  assignLineHonorarium,
  closeHonorariumMonth,
  getCheckoutFeeSupport,
  getHonorariumReport,
  listFeeProviders,
  listUnassignedLines,
  recordHonorariumPayment,
  reverseHonorariumPayment,
  saveProviderFeeProfile,
  saveProviderServiceTerm,
} from "@/features/honoraria/server";
import { createPatient } from "@/features/patients/server";
import { getProcedureEntrySupport, recordPerformedProcedure } from "@/features/procedures/server";
import { addDays, todayInZone } from "@/lib/dates";
import { ForbiddenError, type ClinicContext } from "@/server/auth/context";
import { honorariumEntries, honorariumPayments, invoiceLines, memberships, roles } from "@/server/db/schema";
import { withDbContext } from "@/server/db/tenant";
import { contextFor, expectDbError, makeClinic } from "../support/factories";

const patientInput = {
  firstName: "Samir",
  lastName: "Honoraires",
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

/** A clinic with two practitioners (the owner and an associate dentist) and one patient. */
async function setup(name: string) {
  const ctx = await makeClinic(name);
  const asStaff = <T,>(fn: Parameters<typeof withDbContext<T>>[1]) =>
    withDbContext({ organizationId: ctx.organizationId, userId: ctx.userId, actorType: "staff" }, fn);
  const p = await createPatient(ctx, patientInput, { confirmNotDuplicate: true });
  if (p.status !== "created") throw new Error("fixture");
  const [picker, support] = await Promise.all([getServicePickerData(ctx), getProcedureEntrySupport(ctx)]);
  const services = picker.categories.flatMap((c) => c.services);
  const owner = support.providers[0]!.id;

  const [dentistRole] = await asStaff((tx) => tx.select({ id: roles.id }).from(roles).where(eq(roles.key, "dentist")));
  const invite = await createStaffInvitation(ctx, { email: `assoc-${randomUUID()}@example.test`, fullName: "Nadia Associée", roleId: dentistRole!.id, title: "Dr", isProvider: true });
  const accepted = await acceptStaffInvitation(invite.token, "associate-password-123");
  const [assocRow] = await asStaff((tx) => tx.select({ id: memberships.id }).from(memberships).where(eq(memberships.userId, accepted.userId)));
  const associate = assocRow!.id;
  const associateCtx: ClinicContext = { ...contextFor({ userId: accepted.userId, organizationId: ctx.organizationId }, "dentist"), membershipId: associate };

  const today = todayInZone(ctx.organization.timezone);
  const service = (code: string) => services.find((s) => s.code === code)!;
  const perform = async (code: string, providerId: string, unitPriceMinor: number, serviceDate = today) => {
    const r = await recordPerformedProcedure(ctx, p.id, {
      serviceId: service(code).id,
      branchId: support.branches[0]!.id,
      performingProviderId: providerId,
      serviceDate,
      quantity: 1,
      unitPriceMinor,
      priceOverrideReason: "Tarif du test",
      toothNumber: null,
      surfaces: [],
      arch: null,
      quadrant: null,
    });
    return r.id;
  };
  const bill = (procedureIds: string[], lineOptions?: CheckoutLineOption[]) =>
    createInvoiceFromProcedures(ctx, p.id, { procedureIds, issueNow: true, lineOptions });
  const entriesOf = (invoiceId: string) => asStaff((tx) => tx.select().from(honorariumEntries).where(eq(honorariumEntries.invoiceId, invoiceId)));
  const pay = (amountMinor: number, invoiceId: string) =>
    recordPayment(ctx, { patientId: p.id, amountMinor, method: "card", receivedOn: today, idempotencyKey: randomUUID(), allocateTo: invoiceId });
  return { ctx, asStaff, patientId: p.id, service, owner, associate, associateCtx, today, perform, bill, entriesOf, pay };
}

describe("practitioner fees (honoraires)", () => {
  it("freezes each line's share at issue with the most specific rule", async () => {
    const f = await setup("Honoraires Règles");
    await saveProviderFeeProfile(f.ctx, { providerId: f.owner, specialty: "Omnipratique", defaultFeeRateBp: 3000 });
    await saveProviderFeeProfile(f.ctx, { providerId: f.associate, specialty: "Prothèse", defaultFeeRateBp: 4000 });
    await saveProviderServiceTerm(f.ctx, { providerId: f.associate, serviceId: f.service("PREV-01").id, priceMinor: null, rule: { type: "fixed", value: 150_000 }, reason: "Accord détartrage" });
    const prosthesis = f.service("CONS-03");
    await updateService(f.ctx, prosthesis.id, {
      categoryId: prosthesis.categoryId, code: prosthesis.code, nameFr: prosthesis.name.fr, pricingUnit: "procedure", anatomy: "none",
      defaultDurationMin: 30, priceMinor: prosthesis.priceMinor, deductLabBeforeShare: true,
    }, prosthesis.version);

    const a = await f.perform("CONS-01", f.owner, 1_000_000); // owner default 30%
    const b = await f.perform("PREV-01", f.associate, 800_000); // associate fixed 1 500 DA
    const c = await f.perform("CONS-03", f.associate, 2_000_000); // lab 600 000 deducted, 40%
    const d = await f.perform("CONS-01", f.owner, 500_000); // one-off 50% with reason, credited to the associate
    const support = await getCheckoutFeeSupport(f.ctx);
    expect(support.enabled).toBe(true);
    expect(support.deductLabServiceIds).toContain(prosthesis.id);

    const invoiceId = await f.bill([a, b, c, d], [
      { procedureId: c, labFeeMinor: 600_000 },
      { procedureId: d, providerId: f.associate, rule: { type: "percent", value: 5000 }, ruleReason: "Cas complexe" },
    ]);
    const entries = await f.entriesOf(invoiceId);
    const byAmount = (amount: number) => entries.find((e) => e.lineAmountMinor === amount)!;
    expect(entries).toHaveLength(4);
    expect(byAmount(1_000_000)).toMatchObject({ providerId: f.owner, kind: "earned", ruleType: "percent", ruleValue: 3000, physicianShareMinor: 300_000, clinicShareMinor: 700_000 });
    expect(byAmount(800_000)).toMatchObject({ providerId: f.associate, ruleType: "fixed", ruleValue: 150_000, physicianShareMinor: 150_000 });
    expect(byAmount(2_000_000)).toMatchObject({ labFeeMinor: 600_000, deductLabBeforeShare: true, baseMinor: 1_400_000, physicianShareMinor: 560_000, clinicShareMinor: 1_440_000 });
    expect(byAmount(500_000)).toMatchObject({ providerId: f.associate, ruleValue: 5000, physicianShareMinor: 250_000, reason: "Cas complexe" });
    expect(byAmount(500_000).providerSnapshot.displayName).toBe("Nadia Associée");
    const [line] = await f.asStaff((tx) => tx.select().from(invoiceLines).where(eq(invoiceLines.performedProcedureId, d)));
    expect(line).toMatchObject({ providerId: f.associate, honorariumRuleType: "percent", honorariumRuleValue: 5000 });

    // A later rule change never rewrites frozen entries.
    await saveProviderFeeProfile(f.ctx, { providerId: f.owner, specialty: null, defaultFeeRateBp: 9000 });
    expect((await f.entriesOf(invoiceId)).find((e) => e.lineAmountMinor === 1_000_000)!.physicianShareMinor).toBe(300_000);

    // A practitioner's own price for a service is their normal price: no override reason needed.
    await saveProviderServiceTerm(f.ctx, { providerId: f.associate, serviceId: f.service("CONS-01").id, priceMinor: 350_000, rule: { type: "percent", value: 4000 }, reason: "Tarif associée" });
    const entry = await getProcedureEntrySupport(f.ctx);
    expect(entry.providerPrices).toContainEqual({ providerId: f.associate, serviceId: f.service("CONS-01").id, priceMinor: 350_000 });
    await expect(recordPerformedProcedure(f.ctx, f.patientId, {
      serviceId: f.service("CONS-01").id, branchId: entry.branches[0]!.id, performingProviderId: f.associate, serviceDate: f.today,
      quantity: 1, unitPriceMinor: 350_000, priceOverrideReason: null, toothNumber: null, surfaces: [], arch: null, quadrant: null,
    })).resolves.toBeDefined();

    // Checkout refuses a one-off rule without a reason, an oversized lab fee and an unknown practitioner.
    const e = await f.perform("CONS-01", f.owner, 100_000);
    await expect(f.bill([e], [{ procedureId: e, rule: { type: "percent", value: 1000 } }])).rejects.toMatchObject({ code: "feeRuleReasonRequired" });
    await expect(f.bill([e], [{ procedureId: e, labFeeMinor: 100_001 }])).rejects.toMatchObject({ code: "invalidLabFee" });
    await expect(f.bill([e], [{ procedureId: e, providerId: randomUUID() }])).rejects.toMatchObject({ code: "providerUnavailable" });
  });

  it("makes fees payable as patients pay, net of credit notes, and tracks payouts", async () => {
    const f = await setup("Honoraires Encaissement");
    await saveProviderFeeProfile(f.ctx, { providerId: f.associate, specialty: null, defaultFeeRateBp: 4000 });
    const proc = await f.perform("CONS-01", f.associate, 1_000_000);
    const invoiceId = await f.bill([proc]);
    const range = { from: f.today, to: f.today, providerId: f.associate };

    let report = await getHonorariumReport(f.ctx, range);
    expect(report.totals).toMatchObject({ producedMinor: 1_000_000, earnedMinor: 400_000, payableMinor: 0, balanceMinor: 0, awaitingPatientMinor: 400_000 });

    await f.pay(250_000, invoiceId);
    report = await getHonorariumReport(f.ctx, range);
    expect(report.totals).toMatchObject({ payableMinor: 100_000, balanceMinor: 100_000 });

    // A 200 000 credit note: the share becomes 40% of 800 000; payable is capped by what is still owed.
    await issueCreditNote(f.ctx, invoiceId, 200_000, "Geste commercial");
    await f.pay(550_000, invoiceId);
    report = await getHonorariumReport(f.ctx, range);
    expect(report.rows[0]).toMatchObject({ physicianShareMinor: 400_000, earnedMinor: 320_000, payableMinor: 320_000 });

    const paymentId = await recordHonorariumPayment(f.ctx, { providerId: f.associate, paidOn: f.today, amountMinor: 300_000, method: "bank_transfer", reference: "VIR-1" });
    report = await getHonorariumReport(f.ctx, range);
    expect(report.totals).toMatchObject({ paidMinor: 300_000, balanceMinor: 20_000 });

    await reverseHonorariumPayment(f.ctx, paymentId, "Mauvais montant");
    await expect(reverseHonorariumPayment(f.ctx, paymentId, "Encore")).rejects.toMatchObject({ code: "alreadyReversed" });
    report = await getHonorariumReport(f.ctx, range);
    expect(report.totals.balanceMinor).toBe(320_000);
    expect(report.payments.find((p) => p.id === paymentId)?.reversed).toBe(true);

    await expect(recordHonorariumPayment(f.ctx, { providerId: f.associate, paidOn: addDays(f.today, 1), amountMinor: 1, method: "cash" })).rejects.toMatchObject({ code: "invalidDate" });
    await expect(recordHonorariumPayment(f.ctx, { providerId: f.associate, paidOn: f.today, amountMinor: 0, method: "cash" })).rejects.toMatchObject({ code: "invalidAmount" });
  });

  it("takes cash payouts out of the cash drawer and refuses them on a closed day", async () => {
    const f = await setup("Honoraires Caisse");
    const sessionId = await openCashSession(f.ctx, f.today, 1_000_000);
    await recordHonorariumPayment(f.ctx, { providerId: f.owner, paidOn: f.today, amountMinor: 200_000, method: "cash" });
    const day = await getCashDay(f.ctx, f.today);
    expect(day.breakdown.cashHonorariaMinor).toBe(200_000);
    expect(day.liveExpectedMinor).toBe(800_000);
    await closeCashSession(f.ctx, sessionId, 800_000, null, null);
    await expect(recordHonorariumPayment(f.ctx, { providerId: f.owner, paidOn: f.today, amountMinor: 1_000, method: "cash" })).rejects.toMatchObject({ code: "cashSessionClosed" });
    // Other methods do not touch the drawer.
    await recordHonorariumPayment(f.ctx, { providerId: f.owner, paidOn: f.today, amountMinor: 1_000, method: "cheque" });
  });

  it("keeps closed months final: late fees, corrections and payouts land in an open month", async () => {
    const f = await setup("Honoraires Clôture");
    await saveProviderFeeProfile(f.ctx, { providerId: f.owner, specialty: null, defaultFeeRateBp: 5000 });
    const lastMonthDay = addDays(`${f.today.slice(0, 7)}-01`, -1);
    const lastMonth = lastMonthDay.slice(0, 7);

    await expect(closeHonorariumMonth(f.ctx, { providerId: f.owner, month: f.today.slice(0, 7) })).rejects.toMatchObject({ code: "periodNotEnded" });
    await closeHonorariumMonth(f.ctx, { providerId: f.owner, month: lastMonth, note: "Paie" });
    await expect(closeHonorariumMonth(f.ctx, { providerId: f.owner, month: lastMonth })).rejects.toMatchObject({ code: "periodClosed" });

    // An act of last month billed today counts today for the owner (closed), on its own date for the associate.
    const late = await f.perform("CONS-01", f.owner, 400_000, lastMonthDay);
    const other = await f.perform("CONS-01", f.associate, 400_000, lastMonthDay);
    const invoiceId = await f.bill([late, other]);
    const entries = await f.entriesOf(invoiceId);
    expect(entries.find((e) => e.providerId === f.owner)!.effectiveDate).toBe(f.today);
    expect(entries.find((e) => e.providerId === f.associate)!.effectiveDate).toBe(lastMonthDay);

    await expect(recordHonorariumPayment(f.ctx, { providerId: f.owner, paidOn: lastMonthDay, amountMinor: 1_000, method: "bank_transfer" })).rejects.toMatchObject({ code: "periodClosed" });

    // Corrections are signed rows; the corrected share stays within [0, line amount].
    const base = entries.find((e) => e.providerId === f.owner)!;
    await adjustHonorarium(f.ctx, { entryId: base.id, deltaMinor: -50_000, reason: "Reprise partielle" });
    await expect(adjustHonorarium(f.ctx, { entryId: base.id, deltaMinor: -200_000, reason: "Trop" })).rejects.toMatchObject({ code: "invalidAdjustment" });
    await expect(adjustHonorarium(f.ctx, { entryId: base.id, deltaMinor: 10_000, reason: " " })).rejects.toMatchObject({ code: "reasonRequired" });
    const report = await getHonorariumReport(f.ctx, { from: f.today, to: f.today, providerId: f.owner });
    expect(report.totals.earnedMinor).toBe(150_000);
    expect(report.rows.find((r) => r.kind === "adjustment")).toMatchObject({ adjustsEntryId: base.id, physicianShareMinor: -50_000, clinicShareMinor: 50_000 });
  });

  it("assigns lines billed before fees were tracked, once, after review", async () => {
    const f = await setup("Honoraires Reprise");
    const proc = await f.perform("CONS-01", f.owner, 600_000);
    const draftId = await createInvoiceFromProcedures(f.ctx, f.patientId, { procedureIds: [proc], issueNow: false });
    await issueInvoice(f.ctx, draftId);
    // Issuing a draft freezes its lines too; such a line cannot be assigned a second time.
    const [line] = await f.asStaff((tx) => tx.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, draftId)));
    expect(await f.entriesOf(draftId)).toHaveLength(1);
    await expect(assignLineHonorarium(f.ctx, { invoiceLineId: line!.id, providerId: f.owner, labFeeMinor: 0 })).rejects.toMatchObject({ code: "alreadyRecorded" });

    // A line issued without a practitioner gets no entry, like the lines billed before the ledger existed.
    const legacy = await f.perform("CONS-01", f.associate, 300_000);
    const legacyInvoice = await createInvoiceFromProcedures(f.ctx, f.patientId, { procedureIds: [legacy], issueNow: false });
    await f.asStaff((tx) => tx.update(invoiceLines).set({ providerId: null }).where(eq(invoiceLines.invoiceId, legacyInvoice)));
    await issueInvoice(f.ctx, legacyInvoice);
    expect(await f.entriesOf(legacyInvoice)).toEqual([]);
    const pending = await listUnassignedLines(f.ctx, { from: f.today, to: f.today });
    const target = pending.find((l) => l.invoiceNumber && l.unitPriceMinor === 300_000)!;
    expect(target).toBeDefined();

    await expect(assignLineHonorarium(f.ctx, { invoiceLineId: target.id, providerId: f.associate, labFeeMinor: 300_001 })).rejects.toMatchObject({ code: "invalidAmount" });
    const result = await assignLineHonorarium(f.ctx, { invoiceLineId: target.id, providerId: f.associate, labFeeMinor: 0, rule: { type: "percent", value: 2000 }, reason: "Accord 2025" });
    expect(result.physicianShareMinor).toBe(60_000);
    await expect(assignLineHonorarium(f.ctx, { invoiceLineId: target.id, providerId: f.associate, labFeeMinor: 0 })).rejects.toMatchObject({ code: "alreadyRecorded" });
    expect((await listUnassignedLines(f.ctx, { from: f.today, to: f.today })).find((l) => l.id === target.id)).toBeUndefined();
    expect((await f.entriesOf(legacyInvoice))[0]).toMatchObject({ kind: "backfill", providerId: f.associate, reason: "Accord 2025" });
  });

  it("limits who sees and does what", async () => {
    const f = await setup("Honoraires Droits");
    await saveProviderFeeProfile(f.ctx, { providerId: f.owner, specialty: null, defaultFeeRateBp: 3000 });
    await saveProviderFeeProfile(f.ctx, { providerId: f.associate, specialty: null, defaultFeeRateBp: 3000 });
    const invoiceId = await f.bill([await f.perform("CONS-01", f.owner, 100_000), await f.perform("CONS-01", f.associate, 200_000)]);
    expect(await f.entriesOf(invoiceId)).toHaveLength(2);

    // A dentist sees only their own fees, whatever practitioner the request names.
    const own = await getHonorariumReport(f.associateCtx, { from: f.today, to: f.today, providerId: f.owner });
    expect(own.rows.map((r) => r.providerId)).toEqual([f.associate]);
    expect((await listFeeProviders(f.associateCtx)).map((p) => p.id)).toEqual([f.associate]);
    await expect(recordHonorariumPayment(f.associateCtx, { providerId: f.associate, paidOn: f.today, amountMinor: 1, method: "cash" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(saveProviderFeeProfile(f.associateCtx, { providerId: f.associate, specialty: null, defaultFeeRateBp: 10_000 })).rejects.toBeInstanceOf(ForbiddenError);

    // The accountant sees everyone and pays, but cannot change rules.
    const accountant = contextFor({ userId: f.ctx.userId, organizationId: f.ctx.organizationId }, "accountant");
    expect((await getHonorariumReport(accountant, { from: f.today, to: f.today })).rows).toHaveLength(2);
    await recordHonorariumPayment(accountant, { providerId: f.associate, paidOn: f.today, amountMinor: 1_000, method: "bank_transfer" });
    await expect(saveProviderServiceTerm(accountant, { providerId: f.associate, serviceId: f.service("CONS-01").id, priceMinor: null, rule: { type: "percent", value: 1 }, reason: "x" })).rejects.toBeInstanceOf(ForbiddenError);

    // Reception has no access at all.
    const reception = contextFor({ userId: f.ctx.userId, organizationId: f.ctx.organizationId }, "receptionist");
    await expect(getHonorariumReport(reception, { from: f.today, to: f.today })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("keeps the ledger append-only and tenants apart", async () => {
    const f = await setup("Honoraires Isolation A");
    await saveProviderFeeProfile(f.ctx, { providerId: f.owner, specialty: null, defaultFeeRateBp: 3000 });
    const invoiceId = await f.bill([await f.perform("CONS-01", f.owner, 100_000)]);
    const [entry] = await f.entriesOf(invoiceId);
    await recordHonorariumPayment(f.ctx, { providerId: f.owner, paidOn: f.today, amountMinor: 1_000, method: "bank_transfer" });
    await expectDbError(f.asStaff((tx) => tx.update(honorariumEntries).set({ physicianShareMinor: 1 }).where(eq(honorariumEntries.id, entry!.id))), /append-only|permission denied/i);
    await expectDbError(f.asStaff((tx) => tx.delete(honorariumEntries).where(eq(honorariumEntries.id, entry!.id))), /append-only|permission denied/i);
    await expectDbError(f.asStaff((tx) => tx.delete(honorariumPayments)), /append-only|permission denied/i);

    const other = await setup("Honoraires Isolation B");
    const seen = await getHonorariumReport(other.ctx, { from: f.today, to: f.today });
    expect(seen.rows).toEqual([]);
    expect(seen.summary.find((s) => s.providerId === f.owner)).toBeUndefined();
    // Another clinic's practitioner or service cannot be used, even with a known id.
    await expect(saveProviderFeeProfile(other.ctx, { providerId: f.owner, specialty: null, defaultFeeRateBp: 1 })).rejects.toMatchObject({ code: "providerUnavailable" });
    await expect(recordHonorariumPayment(other.ctx, { providerId: f.owner, paidOn: f.today, amountMinor: 1, method: "cash" })).rejects.toMatchObject({ code: "providerUnavailable" });
    await expect(saveProviderServiceTerm(other.ctx, { providerId: other.owner, serviceId: f.service("CONS-01").id, priceMinor: null, rule: { type: "percent", value: 1 }, reason: "x" })).rejects.toMatchObject({ code: "serviceUnavailable" });
    await expect(adjustHonorarium(other.ctx, { entryId: entry!.id, deltaMinor: 1, reason: "x" })).rejects.toMatchObject({ code: "lineUnavailable" });
  });
});
