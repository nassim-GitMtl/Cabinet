import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/server/db/client";
import { auditEvents, consentGrants, patients, services, servicePrices } from "@/server/db/schema";
import { withDbContext } from "@/server/db/tenant";
import { ForbiddenError } from "@/server/auth/context";
import { createPatient, getPatient, searchPatients, updatePatient } from "@/features/patients/server";
import { listCatalog, updateService } from "@/features/catalog/server";
import { ConflictError } from "@/server/errors";
import { contextFor, expectDbError, makeClinic, makeNetworkPatient } from "../support/factories";

const basePatient = {
  firstName: "Amina",
  lastName: "Benali",
  firstNameAr: null,
  lastNameAr: null,
  sex: undefined,
  birthDate: "1990-04-12",
  birthDatePrecision: "exact" as const,
  phone: "0555 12 34 56",
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

describe("tenant isolation (RLS)", () => {
  it("a clinic never sees another clinic's patients, even by id", async () => {
    const a = await makeClinic("Cabinet A");
    const b = await makeClinic("Cabinet B");
    const created = await createPatient(a, basePatient);
    expect(created.status).toBe("created");
    const id = created.status === "created" ? created.id : "";

    expect((await searchPatients(a, {})).total).toBe(1);
    expect((await searchPatients(b, {})).total).toBe(0);
    expect(await getPatient(b, id)).toBeNull();
    // Knowing the phone number grants nothing either.
    expect((await searchPatients(b, { q: "0555123456" })).total).toBe(0);
  });

  it("queries without a tenant context see zero tenant rows", async () => {
    await makeClinic("Cabinet C");
    const rows = await withDbContext({ actorType: "staff" }, (tx) => tx.select().from(patients));
    expect(rows).toHaveLength(0);
    const svc = await db.select().from(services);
    expect(svc).toHaveLength(0);
  });

  it("rejects writes that target another organization", async () => {
    const a = await makeClinic("Cabinet D");
    const b = await makeClinic("Cabinet E");
    await expectDbError(
      withDbContext({ organizationId: a.organizationId, userId: a.userId, actorType: "staff" }, (tx) =>
        tx.insert(patients).values({
          organizationId: b.organizationId,
          patientNumber: "X-1",
          firstName: "Intrus",
          lastName: "Test",
        }),
      ),
      /row-level security/,
    );
  });

  it("price history and audit trail are append-only for the app role", async () => {
    const a = await makeClinic("Cabinet F");
    const ctx = { organizationId: a.organizationId, userId: a.userId, actorType: "staff" as const };
    await expectDbError(
      withDbContext(ctx, (tx) => tx.update(servicePrices).set({ priceMinor: 1 })),
      /permission denied/,
    );
    await expectDbError(withDbContext(ctx, (tx) => tx.delete(auditEvents)), /permission denied/);
  });
});

describe("consent grants", () => {
  it("staff context cannot create a sharing grant on the patient's behalf", async () => {
    const a = await makeClinic("Cabinet G");
    const np = { id: await makeNetworkPatient() };
    await expectDbError(
      withDbContext({ organizationId: a.organizationId, userId: a.userId, actorType: "staff" }, (tx) =>
        tx.insert(consentGrants).values({
          networkPatientId: np!.id,
          receivingOrganizationId: a.organizationId,
          approverType: "patient",
          approverRef: "forged",
          verificationMethod: "none",
          purpose: "care",
          categories: ["summary"],
          consentTextVersion: "v1",
          consentLanguage: "fr",
        }),
      ),
      /row-level security/,
    );
  });

  it("a patient context can grant, and only the receiving clinic sees it", async () => {
    const a = await makeClinic("Cabinet H");
    const b = await makeClinic("Cabinet I");
    const np = { id: await makeNetworkPatient() };
    await withDbContext({ actorType: "patient", networkPatientId: np!.id }, (tx) =>
      tx.insert(consentGrants).values({
        networkPatientId: np!.id,
        receivingOrganizationId: a.organizationId,
        approverType: "patient",
        approverRef: "patient-account",
        verificationMethod: "account_login",
        purpose: "care",
        categories: ["summary", "treatments"],
        consentTextVersion: "v1",
        consentLanguage: "fr",
      }),
    );
    const seenByA = await withDbContext({ organizationId: a.organizationId, actorType: "staff" }, (tx) =>
      tx.select().from(consentGrants).where(eq(consentGrants.networkPatientId, np!.id)),
    );
    const seenByB = await withDbContext({ organizationId: b.organizationId, actorType: "staff" }, (tx) =>
      tx.select().from(consentGrants).where(eq(consentGrants.networkPatientId, np!.id)),
    );
    expect(seenByA).toHaveLength(1);
    expect(seenByB).toHaveLength(0);
  });
});

describe("patients service", () => {
  it("detects clinic-local duplicates and allocates sequential numbers", async () => {
    const a = await makeClinic("Cabinet J");
    const first = await createPatient(a, basePatient);
    const dup = await createPatient(a, { ...basePatient, phone: "+213 555 12 34 56" });
    expect(dup.status).toBe("duplicates");
    const forced = await createPatient(a, { ...basePatient, phone: null }, { confirmNotDuplicate: true });
    expect(first.status === "created" && first.patientNumber).toBe("P-000001");
    expect(forced.status === "created" && forced.patientNumber).toBe("P-000002");
  });

  it("finds patients regardless of accents and phone format", async () => {
    const a = await makeClinic("Cabinet K");
    await createPatient(a, { ...basePatient, firstName: "Hélène", lastName: "Öztürk", phone: "0661 22 33 44" });
    expect((await searchPatients(a, { q: "helene ozturk" })).total).toBe(1);
    expect((await searchPatients(a, { q: "0661223344" })).total).toBe(1);
    expect((await searchPatients(a, { q: "inconnu" })).total).toBe(0);
  });

  it("rejects stale updates (optimistic locking)", async () => {
    const a = await makeClinic("Cabinet L");
    const created = await createPatient(a, basePatient);
    const id = created.status === "created" ? created.id : "";
    await updatePatient(a, id, { ...basePatient, city: "Oran" }, 1);
    await expect(updatePatient(a, id, { ...basePatient, city: "Alger" }, 1)).rejects.toBeInstanceOf(ConflictError);
  });

  it("enforces permissions server-side", async () => {
    const owner = await makeClinic("Cabinet M");
    const techAdmin = contextFor(owner, "tech_admin");
    await expect(searchPatients(techAdmin, {})).rejects.toBeInstanceOf(ForbiddenError);
    const accountant = contextFor(owner, "accountant");
    await expect(createPatient(accountant, basePatient)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("catalog", () => {
  it("seeds a demo catalog and records price changes in history", async () => {
    const a = await makeClinic("Cabinet N");
    const cats = await listCatalog(a);
    const all = cats.flatMap((c) => c.services);
    expect(all.length).toBeGreaterThan(30);
    expect(all.every((s) => s.isDemoPrice)).toBe(true);

    const svc = all.find((s) => s.code === "CONS-01")!;
    await updateService(
      a,
      svc.id,
      {
        categoryId: svc.categoryId,
        code: svc.code,
        nameFr: svc.name.fr,
        pricingUnit: "procedure",
        anatomy: "none",
        defaultDurationMin: 20,
        priceMinor: 200000,
        priceChangeReason: "Nouveau tarif",
      },
      svc.version,
    );
    const history = await withDbContext({ organizationId: a.organizationId, actorType: "staff" }, (tx) =>
      tx.select().from(servicePrices).where(eq(servicePrices.serviceId, svc.id)),
    );
    expect(history.map((h) => h.priceMinor).sort()).toEqual([150000, 200000]);
    const after = (await listCatalog(a)).flatMap((c) => c.services).find((s) => s.id === svc.id)!;
    expect(after.isDemoPrice).toBe(false);
  });
});

describe("counters", () => {
  it("allocate unique values under concurrency", async () => {
    const a = await makeClinic("Cabinet O");
    const results = await Promise.all(
      Array.from({ length: 15 }, () =>
        createPatient(a, { ...basePatient, firstName: randomUUID().slice(0, 8), phone: null }, { confirmNotDuplicate: true }),
      ),
    );
    const numbers = results.map((r) => (r.status === "created" ? r.patientNumber : ""));
    expect(new Set(numbers).size).toBe(15);
    const [{ n }] = (await withDbContext({ organizationId: a.organizationId, actorType: "staff" }, (tx) =>
      tx.execute<{ n: string }>(sql`select count(*)::text as n from patients`),
    )) as unknown as [{ n: string }];
    expect(Number(n)).toBe(15);
  });
});
