import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getServicePickerData } from "@/features/catalog/server";
import {
  confirmConsumption,
  getLotTrace,
  getReorderSuggestions,
  listPendingConsumptions,
  setConsumablesMode,
  setRecipe,
  skipConsumption,
} from "@/features/inventory/consumables";
import { createInventoryItem, getInventory, receiveInventory } from "@/features/inventory/server";
import { createPatient } from "@/features/patients/server";
import { changePerformedProcedureStatus, getProcedureEntrySupport, recordPerformedProcedure } from "@/features/procedures/server";
import { addDays, todayInZone } from "@/lib/dates";
import { ForbiddenError } from "@/server/auth/context";
import { inventoryLots, procedureConsumptions } from "@/server/db/schema";
import { withDbContext } from "@/server/db/tenant";
import { contextFor, expectDbError, makeClinic } from "../support/factories";

const blank = {
  firstNameAr: null, lastNameAr: null, sex: undefined, birthDate: null, birthDatePrecision: "exact" as const, phone: null, phoneAlt: null,
  email: null, addressLine: null, city: null, region: null, preferredLocale: "fr" as const, emergencyName: null, emergencyRelationship: null,
  emergencyPhone: null, referralSource: null, referredBy: null, administrativeNotes: null, assignedProviderId: null,
};

async function setup(name: string) {
  let ctx = await makeClinic(name);
  const p = await createPatient(ctx, { ...blank, firstName: "Stock", lastName: "Patient", phone: "0550 00 00 09" }, { confirmNotDuplicate: true });
  if (p.status !== "created") throw new Error("fixture");
  const [picker, support] = await Promise.all([getServicePickerData(ctx), getProcedureEntrySupport(ctx)]);
  const svc = picker.categories.flatMap((c) => c.services).find((s) => s.code === "REST-01")!; // composite 1 face
  const today = todayInZone(ctx.organization.timezone);
  const branchId = support.branches[0]!.id;
  await createInventoryItem(ctx, { sku: "COMP-A2", name: "Composite A2 capsule", category: null, unit: "piece", minimumStock: 5 });
  const item = (await getInventory(ctx, today)).items.find((i) => i.sku === "COMP-A2")!;
  // Two lots: the earlier-expiring one must be used first (FEFO).
  await receiveInventory(ctx, { itemId: item.id, branchId, lotNumber: "LATE", expiresOn: addDays(today, 300), receivedOn: today, quantity: 10, reference: null });
  await receiveInventory(ctx, { itemId: item.id, branchId, lotNumber: "SOON", expiresOn: addDays(today, 30), receivedOn: today, quantity: 3, reference: null });
  await setRecipe(ctx, svc.id, item.id, 2);
  const record = (c = ctx) =>
    recordPerformedProcedure(c, p.id, {
      serviceId: svc.id, branchId, performingProviderId: support.providers[0]!.id, serviceDate: today, quantity: 1,
      unitPriceMinor: svc.priceMinor, priceOverrideReason: null, toothNumber: "36", surfaces: ["occlusal"], arch: null, quadrant: null,
    });
  const lotId = async (n: string) =>
    (await withDbContext({ organizationId: ctx.organizationId, actorType: "staff" }, (tx) => tx.select().from(inventoryLots).where(eq(inventoryLots.lotNumber, n))))[0]!.id;
  const refresh = async () => {
    ctx = { ...ctx, organization: { ...ctx.organization, settings: { ...ctx.organization.settings, consumablesMode: "auto" } } };
    return ctx;
  };
  return { get ctx() { return ctx; }, patientId: p.id, item, today, branchId, record, lotId, refresh };
}

const stock = async (f: Awaited<ReturnType<typeof setup>>) => (await getInventory(f.ctx, f.today)).items.find((i) => i.id === f.item.id)!;

describe("consumables from completed procedures", () => {
  it("suggest mode: pending until confirmed, then FEFO usage linked to the procedure and traceable by lot", async () => {
    const f = await setup("Cabinet Stock A");
    const proc = await f.record();
    let pending = await listPendingConsumptions(f.ctx);
    expect(pending).toHaveLength(1);
    expect(pending[0]!.quantity).toBe(2);
    await confirmConsumption(f.ctx, pending[0]!.id, f.today);
    pending = await listPendingConsumptions(f.ctx);
    expect(pending).toHaveLength(0);
    const trace = (await getLotTrace(f.ctx, await f.lotId("SOON")))!;
    expect(trace.patients).toHaveLength(1);
    expect(trace.patients[0]!.procedureId).toBe(proc.id);
    expect(trace.patients[0]!.toothNumber).toBe("36");
    expect(trace.balance).toBe(1); // 3 received − 2 used from the earliest-expiring lot
    expect((await getLotTrace(f.ctx, await f.lotId("LATE")))!.patients).toHaveLength(0);
  });

  it("auto mode consumes immediately; a shortage leaves it pending without blocking care", async () => {
    const f = await setup("Cabinet Stock B");
    await setConsumablesMode(f.ctx, "auto");
    await f.refresh();
    await f.record();
    expect(await listPendingConsumptions(f.ctx)).toHaveLength(0);
    for (let i = 0; i < 5; i++) await f.record(); // 13 in stock, 2 per procedure: the 7th must fall short
    const before = await stock(f);
    await f.record();
    const pending = await listPendingConsumptions(f.ctx);
    expect(pending).toHaveLength(1);
    expect(pending[0]!.note).toBe("insufficientStock");
    expect(before.stock).toBe(1); // 13 − 6 × 2
    expect((await stock(f)).stock).toBe(1); // the short procedure consumed nothing
  });

  it("skip needs a reason, decisions are frozen, and reversed procedures cannot consume", async () => {
    const f = await setup("Cabinet Stock C");
    const a = await f.record();
    const b = await f.record();
    const pending = await listPendingConsumptions(f.ctx);
    const forA = (await withDbContext({ organizationId: f.ctx.organizationId, actorType: "staff" }, (tx) => tx.select().from(procedureConsumptions).where(eq(procedureConsumptions.performedProcedureId, a.id))))[0]!;
    await expect(skipConsumption(f.ctx, forA.id, " ")).rejects.toMatchObject({ code: "reasonRequired" });
    await skipConsumption(f.ctx, forA.id, "Matériel du patient");
    const db = { organizationId: f.ctx.organizationId, userId: f.ctx.userId, actorType: "staff" as const };
    await expectDbError(withDbContext(db, (tx) => tx.update(procedureConsumptions).set({ status: "consumed" }).where(eq(procedureConsumptions.id, forA.id))), /immutable/);
    await expectDbError(withDbContext(db, (tx) => tx.delete(procedureConsumptions)), /permission denied/);

    await changePerformedProcedureStatus(f.ctx, b.id, { status: "entered_in_error", reason: "Doublon" } as never);
    const forB = pending.find((p) => p.id !== forA.id)!;
    await expect(confirmConsumption(f.ctx, forB.id, f.today)).rejects.toMatchObject({ code: "procedureReversed" });
    expect(await listPendingConsumptions(f.ctx)).toHaveLength(0); // reversed procedures drop out of the list
  });

  it("reorder suggestion follows usage and minimum stock", async () => {
    const f = await setup("Cabinet Stock D");
    await f.record();
    for (const c of await listPendingConsumptions(f.ctx)) await confirmConsumption(f.ctx, c.id, f.today);
    const r = await getReorderSuggestions(f.ctx, f.today);
    // On hand 11, minimum 5, 2 used in 90 days -> projected 30-day need ceil(2/90*30*factor) = 1 -> nothing to order.
    expect(r.suggestions.find((s) => s.itemId === f.item.id)).toBeUndefined();
    for (let i = 0; i < 4; i++) {
      await f.record();
      for (const c of await listPendingConsumptions(f.ctx)) await confirmConsumption(f.ctx, c.id, f.today);
    }
    const s = (await getReorderSuggestions(f.ctx, f.today)).suggestions.find((x) => x.itemId === f.item.id)!;
    expect(s.onHand).toBe(3);
    expect(s.usage90).toBe(10);
    expect(s.suggested).toBe(s.projected30 + 5 - 3);
  });

  it("enforces permissions", async () => {
    const f = await setup("Cabinet Stock E");
    await f.record();
    await expect(listPendingConsumptions(contextFor(f.ctx, "receptionist"))).rejects.toBeInstanceOf(ForbiddenError);
    expect(await listPendingConsumptions(contextFor(f.ctx, "assistant"))).toHaveLength(1); // clinical staff can confirm at chairside
    await expect(getLotTrace(contextFor(f.ctx, "accountant"), await f.lotId("SOON"))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(setRecipe(contextFor(f.ctx, "dentist"), f.item.id, f.item.id, 1)).rejects.toBeInstanceOf(ForbiddenError);
  });
});
