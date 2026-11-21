import { randomUUID } from "node:crypto";
import { eq, sql as dsql } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { createPatient } from "@/features/patients/server";
import { createPairingCode, getClinicNode, revokeClinicNode, SyncSetupError } from "@/features/sync/server";
import { ForbiddenError } from "@/server/auth/context";
import { createDb, db } from "@/server/db/client";
import { auditEvents, organizations, patientAlerts, patientImports, patients } from "@/server/db/schema";
import { withDbContext } from "@/server/db/tenant";
import { applyChanges, exportSnapshotPage, readChanges, snapshotReady, snapshotTables } from "@/server/sync/engine";
import { claimPairing, resolveNodeKey } from "@/server/sync/pairing";
import { START_CURSOR, type SyncChange, type SyncCursor } from "@/server/sync/types";
import { contextFor, expectDbError, makeClinic } from "../support/factories";
import { PEER_DATABASE, SYNC_TEST_PASSWORD, withDatabase, withUser } from "../support/urls";

// Cloud copy = the normal test database. Clinic computer = the peer database (node role "clinic").
const appUrl = process.env.TEST_DATABASE_URL!;
const cloudSync = postgres(withUser(appUrl, "cabinet_sync", SYNC_TEST_PASSWORD), { max: 2, prepare: false, onnotice: () => {} });
const peerSync = postgres(withUser(withDatabase(appUrl, PEER_DATABASE), "cabinet_sync", SYNC_TEST_PASSWORD), { max: 2, prepare: false, onnotice: () => {} });
const peerDb = createDb(withDatabase(appUrl, PEER_DATABASE), 2);
afterAll(async () => { await cloudSync.end(); await peerSync.end(); });

const patientInput = (lastName: string) => ({
  firstName: "Lina", lastName, firstNameAr: null, lastNameAr: null, sex: undefined, birthDate: null, birthDatePrecision: "exact" as const,
  phone: null, phoneAlt: null, email: null, addressLine: null, city: null, region: null, preferredLocale: "fr" as const, emergencyName: null,
  emergencyRelationship: null, emergencyPhone: null, referralSource: null, referredBy: null, administrativeNotes: null, assignedProviderId: null,
});

/** Copies everything of one clinic from the cloud to the clinic computer, like a new clinic computer does. */
async function bootstrap(organizationId: string, pullFrom: string) {
  expect(await snapshotReady(cloudSync, pullFrom)).toBe(true);
  for (const table of await snapshotTables(cloudSync)) {
    let after: string | null = null;
    for (;;) {
      const page = await exportSnapshotPage(cloudSync, organizationId, table, after, 50);
      if (page.changes.length) await applyChanges(peerSync, organizationId, "cloud", page.changes);
      after = page.after;
      if (page.done) break;
    }
  }
}

async function drain(source: postgres.Sql, organizationId: string, origin: "clinic" | "cloud", cursor: SyncCursor) {
  const all: SyncChange[] = [];
  let next = cursor;
  for (;;) {
    const page = await readChanges(source, organizationId, origin, next);
    all.push(...page.changes);
    next = page.cursor;
    if (!page.more) break;
  }
  return { changes: all, cursor: next };
}

async function pairedClinic(name: string) {
  const owner = await makeClinic(name);
  await createPatient(owner, patientInput("CLOUDFIRST"), { confirmNotDuplicate: true });
  const { code } = await createPairingCode(owner, "Accueil");
  const claim = await claimPairing(cloudSync, code);
  if (!claim) throw new Error("pairing failed");
  return { owner, claim };
}

describe("offline clinic computer <-> cloud copy", () => {
  it("pairs once, copies the clinic down, then sends clinic changes up and patient-side changes down", async () => {
    const { owner, claim } = await pairedClinic("Cabinet Sync A");
    const org = owner.organizationId;
    expect(claim.organizationId).toBe(org);
    expect(await resolveNodeKey(cloudSync, claim.nodeKey)).toMatchObject({ organizationId: org });
    expect(await resolveNodeKey(cloudSync, "x".repeat(43))).toBeNull();
    expect((await getClinicNode(owner)).dataHome).toBe("clinic");

    // The cloud copy is now read-only for staff of this clinic...
    await expectDbError(createPatient(owner, patientInput("BLOCKED"), { confirmNotDuplicate: true }), /clinic_read_only/);
    // ...even if the app login tries to switch the checks off itself.
    await expectDbError(withDbContext({ organizationId: org, userId: owner.userId, actorType: "staff" }, async (tx) => {
      await tx.execute(dsql`select set_config('app.sync_apply', 'on', true)`);
      await tx.update(organizations).set({ name: "Renamed" }).where(eq(organizations.id, org));
    }), /clinic_read_only/);
    await expectDbError(db.execute(dsql`select app_private.sync_apply_row('patients', 'delete', '{}'::jsonb, null)`), /not a sync session/);

    // First full copy on the clinic computer.
    await bootstrap(org, claim.pullFrom);
    const peerPatients = await withDbContext({ organizationId: org, actorType: "staff" }, (tx) => tx.select().from(patients), peerDb);
    expect(peerPatients.map((p) => p.lastName)).toEqual(["CLOUDFIRST"]);
    const [peerOrg] = await withDbContext({ organizationId: org, actorType: "staff" }, (tx) => tx.select().from(organizations).where(eq(organizations.id, org)), peerDb);
    expect(peerOrg).toMatchObject({ dataHome: "clinic", name: "Cabinet Sync A" });

    // Work at the clinic (offline is fine): a patient and an import record whose check requires the staff actor.
    const ctx = { organizationId: org, userId: owner.userId, actorType: "staff" as const };
    const importId = randomUUID();
    await withDbContext(ctx, async (tx) => {
      await tx.insert(patientImports).values({ id: importId, organizationId: org, fileName: "liste.csv", fileSha256: "0".repeat(64), totalRows: 1, importedCount: 1, skippedDuplicates: 0, skippedInvalid: 0, createdByUserId: owner.userId });
      await tx.insert(patients).values({ organizationId: org, patientNumber: "P-000777", firstName: "Karim", lastName: "OFFLINE", importId });
    }, peerDb);

    // Up to the cloud: rows arrive even though the cloud's own checks would refuse the sync actor.
    const up = await drain(peerSync, org, "clinic", START_CURSOR);
    expect(up.changes.map((c) => c.table)).toEqual(expect.arrayContaining(["patient_imports", "patients"]));
    expect(await applyChanges(cloudSync, org, "clinic", up.changes)).toMatchObject({ applied: up.changes.length, pending: 0 });
    const cloudPatients = await withDbContext(ctx, (tx) => tx.select({ lastName: patients.lastName }).from(patients));
    expect(cloudPatients.map((p) => p.lastName).sort()).toEqual(["CLOUDFIRST", "OFFLINE"]);
    // Sending the same batch twice changes nothing.
    expect(await applyChanges(cloudSync, org, "clinic", up.changes)).toMatchObject({ applied: 0, skipped: up.changes.length });
    // Nothing applied by the sync is recorded again (no echo), and nothing more is waiting at the clinic.
    expect((await drain(peerSync, org, "clinic", up.cursor)).changes).toHaveLength(0);

    // Patient-side action in the cloud (not staff): recorded and sent down to the clinic computer.
    await withDbContext({ organizationId: org, actorType: "system" }, (tx) =>
      tx.insert(auditEvents).values({ organizationId: org, actorType: "system", action: "booking.requested", entityType: "booking_request" }));
    const down = await drain(cloudSync, org, "cloud", { from: claim.pullFrom, to: null, after: 0 });
    expect(down.changes.map((c) => c.table)).toEqual(["audit_events"]);
    await applyChanges(peerSync, org, "cloud", down.changes);
    const peerAudit = await withDbContext({ organizationId: org, actorType: "staff" }, (tx) => tx.select().from(auditEvents).where(eq(auditEvents.action, "booking.requested")), peerDb);
    expect(peerAudit).toHaveLength(1);
  });

  it("holds a record that arrives before the one it depends on, then applies it", async () => {
    const { owner, claim } = await pairedClinic("Cabinet Sync B");
    const org = owner.organizationId;
    await bootstrap(org, claim.pullFrom);
    const ctx = { organizationId: org, userId: owner.userId, actorType: "staff" as const };
    const start = (await drain(peerSync, org, "clinic", START_CURSOR)).cursor;
    await withDbContext(ctx, async (tx) => {
      const [p] = await tx.insert(patients).values({ organizationId: org, patientNumber: "P-000900", firstName: "Amel", lastName: "ORDER" }).returning({ id: patients.id });
      await tx.insert(patientAlerts).values({ organizationId: org, patientId: p!.id, kind: "allergy", severity: "critical", label: "Pénicilline", createdByUserId: owner.userId });
    }, peerDb);
    const { changes } = await drain(peerSync, org, "clinic", start);
    const alert = changes.filter((c) => c.table === "patient_alerts");
    const patient = changes.filter((c) => c.table === "patients");
    expect(await applyChanges(cloudSync, org, "clinic", alert)).toMatchObject({ applied: 0, pending: 1 });
    expect(await applyChanges(cloudSync, org, "clinic", patient)).toMatchObject({ applied: 2, pending: 0 });
    const alerts = await withDbContext(ctx, (tx) => tx.select().from(patientAlerts));
    expect(alerts.map((a) => a.label)).toEqual(["Pénicilline"]);
  });

  it("keeps clinics apart, needs the owner's permission and can hand control back to the cloud", async () => {
    const { owner, claim } = await pairedClinic("Cabinet Sync C");
    const other = await makeClinic("Cabinet Sync D");
    await expect(createPairingCode(contextFor(owner, "receptionist"), "x")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createPairingCode(owner, "Second")).rejects.toBeInstanceOf(SyncSetupError);
    // A change carrying another clinic's id is refused by row-level security even on the sync login.
    const forged: SyncChange = { id: 1, table: "patients", op: "upsert", pk: JSON.stringify({ id: randomUUID() }),
      row: JSON.stringify({ id: randomUUID(), organization_id: other.organizationId, patient_number: "P-1", first_name: "X", last_name: "Y" }) };
    await expect(applyChanges(cloudSync, owner.organizationId, "clinic", [forged])).rejects.toThrow(/row-level security/);
    // Another clinic cannot read this clinic's copy.
    expect((await exportSnapshotPage(cloudSync, other.organizationId, "patients", null)).changes).toHaveLength(0);

    await revokeClinicNode(owner);
    expect(await resolveNodeKey(cloudSync, claim.nodeKey)).toBeNull();
    expect((await getClinicNode(owner)).dataHome).toBe("cloud");
    await createPatient(owner, patientInput("BACKONLINE"), { confirmNotDuplicate: true });
  });

  it("every business check skips rows applied by the sync (also for triggers added later)", async () => {
    const admin = postgres(process.env.TEST_DATABASE_URL_ADMIN!, { max: 1 });
    try {
      const rows = await admin<{ name: string; def: string }[]>`
        select c.relname || '.' || t.tgname as name, pg_get_triggerdef(t.oid) as def
          from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and not t.tgisinternal`;
      expect(rows.length).toBeGreaterThan(100);
      expect(rows.filter((r) => !r.def.includes("sync_applying()")).map((r) => r.name)).toEqual([]);
      const [{ ok }] = await admin<{ ok: boolean }[]>`select rolbypassrls = false and rolsuper = false as ok from pg_roles where rolname = 'cabinet_sync'`;
      expect(ok).toBe(true);
    } finally {
      await admin.end();
    }
  });
});
