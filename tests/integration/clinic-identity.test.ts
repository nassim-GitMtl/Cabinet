import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createInvoiceFromProcedures, getInvoice, getPayment, issueCreditNote, recordPayment } from "@/features/billing/server";
import { getServicePickerData } from "@/features/catalog/server";
import {
  ClinicIdentityError, getClinicIdentity, getPrintBranding, getSetupChecklist, loadClinicLogo, saveClinicIdentity, saveClinicLogo,
} from "@/features/clinic-identity/server";
import { createPatient } from "@/features/patients/server";
import { getProcedureEntrySupport, recordPerformedProcedure } from "@/features/procedures/server";
import { todayInZone } from "@/lib/dates";
import { ForbiddenError } from "@/server/auth/context";
import { payments } from "@/server/db/schema";
import { withDbContext } from "@/server/db/tenant";
import { contextFor, expectDbError, makeClinic } from "../support/factories";

const identity = (nif: string) => ({
  clinicName: "Cabinet Identité", legalName: "Dr Amine Identité", address: "12 rue des Oliviers, Blida",
  identifiers: { NIF: nif, NIS: "0987", RC: "", AI: "" }, phone: "0661 22 33 44", email: "contact@cabinet.example",
});
const png = (marker: number) => Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, marker]);

async function setup(name: string) {
  const ctx = await makeClinic(name);
  const p = await createPatient(ctx, {
    firstName: "Rania", lastName: "Facture", firstNameAr: null, lastNameAr: null, sex: undefined, birthDate: null, birthDatePrecision: "exact",
    phone: null, phoneAlt: null, email: null, addressLine: null, city: null, region: null, preferredLocale: "fr", emergencyName: null,
    emergencyRelationship: null, emergencyPhone: null, referralSource: null, referredBy: null, administrativeNotes: null, assignedProviderId: null,
  }, { confirmNotDuplicate: true });
  if (p.status !== "created") throw new Error("fixture");
  const [picker, support] = await Promise.all([getServicePickerData(ctx), getProcedureEntrySupport(ctx)]);
  const svc = picker.categories.flatMap((c) => c.services).find((s) => s.code === "CONS-01")!;
  const today = todayInZone(ctx.organization.timezone);
  const invoice = async () => {
    const proc = await recordPerformedProcedure(ctx, p.id, {
      serviceId: svc.id, branchId: support.branches[0]!.id, performingProviderId: support.providers[0]!.id, serviceDate: today,
      quantity: 1, unitPriceMinor: svc.priceMinor, priceOverrideReason: null, toothNumber: null, surfaces: [], arch: null, quadrant: null,
    });
    return createInvoiceFromProcedures(ctx, p.id, { procedureIds: [proc.id], issueNow: true });
  };
  return { ctx, patientId: p.id, invoice, today, price: svc.priceMinor };
}

describe("clinic identity and issued documents", () => {
  it("prints each issued document with the issuer details of its issue date", async () => {
    const f = await setup("Cabinet Identité A");
    await saveClinicIdentity(f.ctx, identity("NIF-OLD"));
    const first = await f.invoice();
    const firstPaymentId = (await recordPayment(f.ctx, { patientId: f.patientId, amountMinor: f.price, method: "cash", receivedOn: f.today, idempotencyKey: randomUUID(), allocateTo: first })).id;

    // The clinic changes its legal details afterwards.
    await saveClinicIdentity(f.ctx, { ...identity("NIF-NEW"), address: "3 boulevard Neuf, Alger" });
    const second = await f.invoice();

    expect((await getInvoice(f.ctx, first))!.invoice.issuerSnapshot).toMatchObject({ legalName: "Dr Amine Identité", identifiers: { NIF: "NIF-OLD", NIS: "0987" }, address: "12 rue des Oliviers, Blida", phone: "+213661223344" });
    expect((await getPayment(f.ctx, firstPaymentId))!.payment.issuerSnapshot).toMatchObject({ identifiers: { NIF: "NIF-OLD" } });
    expect((await getInvoice(f.ctx, second))!.invoice.issuerSnapshot).toMatchObject({ identifiers: { NIF: "NIF-NEW" }, address: "3 boulevard Neuf, Alger" });
    await issueCreditNote(f.ctx, first, 100, "Geste commercial");
    expect((await getInvoice(f.ctx, first))!.credits[0]!.issuerSnapshot).toMatchObject({ identifiers: { NIF: "NIF-NEW" } });
    // Drafts and estimates print the live details.
    expect((await getPrintBranding(f.ctx)).issuer).toMatchObject({ clinicName: "Cabinet Identité", identifiers: { NIF: "NIF-NEW" } });

    // The database refuses an issued document without its issuer copy, even if the service is bypassed.
    await expectDbError(withDbContext({ organizationId: f.ctx.organizationId, userId: f.ctx.userId, actorType: "staff" }, async (tx) => {
      const [p] = await tx.select().from(payments).limit(1);
      await tx.insert(payments).values({ ...p!, id: randomUUID(), issuerSnapshot: null, receiptNumber: "X-1", idempotencyKey: randomUUID() });
    }), /must carry the issuer details/);
  });

  it("validates details, stores a checked logo and drives the setup checklist", async () => {
    const f = await setup("Cabinet Identité B");
    let checklist = await getSetupChecklist(f.ctx);
    expect(checklist.find((i) => i.key === "identity")!.done).toBe(false);

    await expect(saveClinicIdentity(contextFor(f.ctx, "receptionist"), identity("1"))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(saveClinicIdentity(f.ctx, { ...identity("1"), phone: "12" })).rejects.toMatchObject({ code: "invalidPhone", field: "phone" });
    await expect(saveClinicIdentity(f.ctx, { ...identity("1"), email: "pas-un-email" })).rejects.toMatchObject({ code: "invalidEmail" });
    await saveClinicIdentity(f.ctx, identity("NIF-B"));
    expect((await getClinicIdentity(f.ctx)).entity).toMatchObject({ legalName: "Dr Amine Identité", identifiers: { NIF: "NIF-B", NIS: "0987" } });

    await expect(saveClinicLogo(f.ctx, new TextEncoder().encode("<svg onload=alert(1)></svg>"))).rejects.toMatchObject({ code: "logoType" });
    await expect(saveClinicLogo(f.ctx, new Uint8Array(301 * 1024))).rejects.toBeInstanceOf(ClinicIdentityError);
    await saveClinicLogo(f.ctx, png(1));
    await saveClinicLogo(f.ctx, png(2)); // replacing keeps one logo per clinic
    expect([...(await loadClinicLogo(f.ctx.organizationId))!.bytes]).toEqual([...png(2)]);
    const other = await makeClinic("Cabinet Identité C");
    expect(await loadClinicLogo(other.organizationId)).toBeNull();

    checklist = await getSetupChecklist(f.ctx);
    expect(Object.fromEntries(checklist.map((i) => [i.key, i.done]))).toMatchObject({ identity: true, phone: true, logo: true, team: false, booking: false, publicPage: false });
  });
});
