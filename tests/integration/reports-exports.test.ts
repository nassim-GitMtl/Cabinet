import { randomUUID } from "node:crypto";
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { createInvoiceFromProcedures, getPatientAccount, issueCreditNote, recordPayment, refundPayment } from "@/features/billing/server";
import { getPatientStatement } from "@/features/billing/statement";
import { getServicePickerData } from "@/features/catalog/server";
import { createPatient } from "@/features/patients/server";
import { getProcedureEntrySupport, recordPerformedProcedure } from "@/features/procedures/server";
import { bucketFor, getReceivablesAging } from "@/features/reports/aging";
import { reportSheets } from "@/features/reports/exports";
import { getReport } from "@/features/reports/server";
import { toXlsx } from "@/lib/export/xlsx";
import { addDays, todayInZone } from "@/lib/dates";
import { ForbiddenError } from "@/server/auth/context";
import { contextFor, makeClinic } from "../support/factories";

const blank = {
  firstNameAr: null, lastNameAr: null, sex: undefined, birthDate: null, birthDatePrecision: "exact" as const, phone: null, phoneAlt: null,
  email: null, addressLine: null, city: null, region: null, preferredLocale: "fr" as const, emergencyName: null, emergencyRelationship: null,
  emergencyPhone: null, referralSource: null, referredBy: null, administrativeNotes: null, assignedProviderId: null,
};

async function setup(name: string) {
  const ctx = await makeClinic(name);
  const p = await createPatient(ctx, { ...blank, firstName: "Relevé", lastName: "=Test" }, { confirmNotDuplicate: true });
  if (p.status !== "created") throw new Error("fixture");
  const [picker, support] = await Promise.all([getServicePickerData(ctx), getProcedureEntrySupport(ctx)]);
  const svc = picker.categories.flatMap((c) => c.services).find((s) => s.code === "PREV-01")!; // 4 000 DA
  const today = todayInZone(ctx.organization.timezone);
  const proc = await recordPerformedProcedure(ctx, p.id, {
    serviceId: svc.id, branchId: support.branches[0]!.id, performingProviderId: support.providers[0]!.id, serviceDate: today,
    quantity: 1, unitPriceMinor: svc.priceMinor, priceOverrideReason: null, toothNumber: null, surfaces: [], arch: null, quadrant: null,
  });
  return { ctx, patientId: p.id, procId: proc.id, today };
}

describe("receivables aging", () => {
  it("buckets by age from the due date and nets payments and credits", async () => {
    expect([bucketFor(0), bucketFor(30), bucketFor(31), bucketFor(61), bucketFor(91)]).toEqual(["current", "current", "d31_60", "d61_90", "over90"]);
    const f = await setup("Cabinet Créances A");
    const inv = await createInvoiceFromProcedures(f.ctx, f.patientId, { procedureIds: [f.procId], issueNow: true, dueDate: addDays(f.today, -45) });
    await recordPayment(f.ctx, { patientId: f.patientId, amountMinor: 100000, method: "cash", receivedOn: f.today, idempotencyKey: randomUUID(), allocateTo: inv });
    await issueCreditNote(f.ctx, inv, 50000, "Geste");
    const aging = await getReceivablesAging(f.ctx, f.today);
    expect(aging.grandTotal).toBe(250000);
    expect(aging.totals.d31_60).toBe(250000);
    expect(aging.patients[0]!.invoices[0]!.ageDays).toBe(45);
    // Before the invoice existed nothing was owed.
    expect((await getReceivablesAging(f.ctx, addDays(f.today, -1))).grandTotal).toBe(0);
    await expect(getReceivablesAging(contextFor(f.ctx, "receptionist"), f.today)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("patient statement", () => {
  it("reconciles with the patient account (amount due − unapplied credit)", async () => {
    const f = await setup("Cabinet Relevé A");
    const inv = await createInvoiceFromProcedures(f.ctx, f.patientId, { procedureIds: [f.procId], issueNow: true });
    await recordPayment(f.ctx, { patientId: f.patientId, amountMinor: 150000, method: "cash", receivedOn: f.today, idempotencyKey: randomUUID(), allocateTo: inv });
    const deposit = await recordPayment(f.ctx, { patientId: f.patientId, amountMinor: 100000, method: "card", receivedOn: f.today, idempotencyKey: randomUUID(), allocateTo: null });
    await refundPayment(f.ctx, deposit.id, { amountMinor: 40000, method: "card", reason: "Partiel", refundedOn: f.today });
    await issueCreditNote(f.ctx, inv, 50000, "Geste");

    const st = await getPatientStatement(f.ctx, f.patientId, `${f.today.slice(0, 4)}-01-01`, f.today);
    // 4 000 − 1 500 − 1 000 + 400 − 500 = 1 400 DA
    expect(st.openingMinor).toBe(0);
    expect(st.closingMinor).toBe(140000);
    expect(st.lines).toHaveLength(5);
    const account = await getPatientAccount(f.ctx, f.patientId);
    expect(st.closingMinor).toBe(account.outstandingMinor - account.unappliedMinor);
    // A period starting after all entries carries everything in the opening balance.
    const later = await getPatientStatement(f.ctx, f.patientId, addDays(f.today, 1), addDays(f.today, 1));
    expect(later.openingMinor).toBe(140000);
    expect(later.lines).toHaveLength(0);
  });
});

describe("report export", () => {
  it("exports the same rows as the screen, with formula-like names neutralized", async () => {
    const f = await setup("Cabinet Export A");
    await createInvoiceFromProcedures(f.ctx, f.patientId, { procedureIds: [f.procId], issueNow: true });
    const report = await getReport(f.ctx, { from: f.today, to: f.today });
    const sheets = reportSheets(report, (k) => k, (n) => n.fr);
    const procedures = sheets.find((s) => s.name === "reports.export.procedures")!;
    expect(procedures.rows).toHaveLength(report.procedures.length);
    expect(sheets.map((s) => s.name)).toContain("reports.export.invoices");
    const ws = strFromU8(unzipSync(toXlsx(sheets))["xl/worksheets/sheet2.xml"]!);
    // Patient last name "=Test" is stored as an inline string, never a formula.
    expect(ws).toContain("=TEST");
    expect(ws).not.toContain("<f>");
  });
});
