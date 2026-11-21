import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPatient } from "@/features/patients/server";
import { createPairingCode } from "@/features/sync/server";
import { createDb } from "@/server/db/client";
import { auditEvents, patients } from "@/server/db/schema";
import { withDbContext } from "@/server/db/tenant";
import type { FetchLike } from "@/server/sync/client";
import { normalizeCloudUrl } from "@/server/sync/client";
import { pairWithCloud, runSyncOnce } from "@/server/sync/worker";
import { makeClinic } from "../support/factories";
import { NODE_DATABASE, SYNC_TEST_PASSWORD, withDatabase, withUser } from "../support/urls";

// The cloud endpoints run in-process against the normal test database; the clinic computer is NODE_DATABASE.
const appUrl = process.env.TEST_DATABASE_URL!;
const nodeUrl = withDatabase(appUrl, NODE_DATABASE);
const nodeSync = postgres(withUser(nodeUrl, "cabinet_sync", SYNC_TEST_PASSWORD), { max: 3, prepare: false, onnotice: () => {} });
const nodeApp = postgres(nodeUrl, { max: 1, prepare: false, onnotice: () => {} });
const nodeDb = createDb(nodeUrl, 2);
let online = true;
let cloudFetch: FetchLike;

beforeAll(async () => {
  process.env.SYNC_DATABASE_URL = withUser(appUrl, "cabinet_sync", SYNC_TEST_PASSWORD);
  const routes = {
    "/api/sync/pair": (await import("@/app/api/sync/pair/route")).POST,
    "/api/sync/snapshot": (await import("@/app/api/sync/snapshot/route")).POST,
    "/api/sync/push": (await import("@/app/api/sync/push/route")).POST,
    "/api/sync/pull": (await import("@/app/api/sync/pull/route")).POST,
  } as Record<string, (request: Request) => Promise<Response>>;
  cloudFetch = async (input, init) => {
    if (!online) throw new TypeError("fetch failed");
    const handler = routes[new URL(input).pathname];
    if (!handler) return new Response("{}", { status: 404 });
    return handler(new Request(input, init));
  };
});
afterAll(async () => { await nodeSync.end(); await nodeApp.end(); });

const patientInput = (lastName: string) => ({
  firstName: "Nour", lastName, firstNameAr: null, lastNameAr: null, sex: undefined, birthDate: null, birthDatePrecision: "exact" as const,
  phone: null, phoneAlt: null, email: null, addressLine: null, city: null, region: null, preferredLocale: "fr" as const, emergencyName: null,
  emergencyRelationship: null, emergencyPhone: null, referralSource: null, referredBy: null, administrativeNotes: null, assignedProviderId: null,
});

async function runUntilActive() {
  for (let i = 0; i < 20; i++) {
    const run = await runSyncOnce(nodeSync, cloudFetch);
    if (run.state === "active") return run;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("bootstrap did not finish");
}

describe("clinic computer worker against the cloud endpoints", () => {
  it("pairs, downloads the clinic, keeps working offline and catches up when the internet is back", async () => {
    expect(normalizeCloudUrl("http://cabinet.example.dz")).toBeNull();
    expect(normalizeCloudUrl("https://cabinet.example.dz/settings?x=1")).toBe("https://cabinet.example.dz");

    const owner = await makeClinic("Cabinet Worker A");
    const org = owner.organizationId;
    await createPatient(owner, patientInput("BEFOREPAIRING"), { confirmNotDuplicate: true });
    const { code } = await createPairingCode(owner, "Accueil");

    await expect(pairWithCloud(nodeApp, "https://cloud.test", "AAAA-BBBB-CCCC-DDDD", cloudFetch)).rejects.toMatchObject({ code: "pairingUnavailable" });
    await pairWithCloud(nodeApp, "https://cloud.test", code.toLowerCase(), cloudFetch);
    // A paired clinic computer cannot be paired again (checked before anything is sent to the cloud).
    await expect(pairWithCloud(nodeApp, "https://cloud.test", code, cloudFetch)).rejects.toMatchObject({ code: "notPairable" });

    await runUntilActive();
    const staff = { organizationId: org, userId: owner.userId, actorType: "staff" as const };
    const local = await withDbContext(staff, (tx) => tx.select({ lastName: patients.lastName }).from(patients), nodeDb);
    expect(local.map((p) => p.lastName)).toEqual(["BEFOREPAIRING"]);

    // Internet down: the clinic keeps working; the worker records why it could not sync.
    online = false;
    await withDbContext(staff, (tx) => tx.insert(patients).values({ organizationId: org, patientNumber: "P-000500", firstName: "Sami", lastName: "OFFLINE" }), nodeDb);
    expect(await runSyncOnce(nodeSync, cloudFetch)).toMatchObject({ error: "offline" });
    const [status] = await nodeApp<{ last_error: string }[]>`select last_error from app_private.node_status()`;
    expect(status!.last_error).toBe("offline");

    // A patient books online meanwhile (recorded in the cloud).
    await withDbContext({ organizationId: org, actorType: "system" }, (tx) =>
      tx.insert(auditEvents).values({ organizationId: org, actorType: "system", action: "booking.requested", entityType: "booking_request" }));

    // Internet back: both directions catch up.
    online = true;
    expect(await runSyncOnce(nodeSync, cloudFetch)).toMatchObject({ state: "active", error: null, pushed: 1, pulled: 1 });
    const cloud = await withDbContext(staff, (tx) => tx.select({ lastName: patients.lastName }).from(patients));
    expect(cloud.map((p) => p.lastName).sort()).toEqual(["BEFOREPAIRING", "OFFLINE"]);
    const pulled = await nodeApp.begin(async (tx) => {
      await tx`select set_config('app.org_id', ${org}, true)`;
      return tx`select count(*)::int as n from audit_events where action = 'booking.requested'`;
    });
    expect(pulled[0]!.n).toBe(1);
    const [after] = await nodeApp<{ last_error: string | null; state: string }[]>`select last_error, state from app_private.node_status()`;
    expect(after).toEqual({ last_error: null, state: "active" });

    // Nothing left to send or fetch.
    expect(await runSyncOnce(nodeSync, cloudFetch)).toMatchObject({ pushed: 0, pulled: 0, error: null });
  });

  it("refuses a request without the clinic computer's key or with another database version", async () => {
    const push = (await import("@/app/api/sync/push/route")).POST;
    const noKey = await push(new Request("https://cloud.test/api/sync/push", { method: "POST", body: "{}", headers: { "x-cabinet-schema": (await import("@/server/sync/types")).SCHEMA_VERSION } }));
    expect(noKey.status).toBe(401);
    const oldVersion = await push(new Request("https://cloud.test/api/sync/push", { method: "POST", body: "{}", headers: { "x-cabinet-schema": "0001_old", authorization: "Bearer x" } }));
    expect(oldVersion.status).toBe(409);
    expect(await oldVersion.json()).toMatchObject({ error: "schemaMismatch" });
  });
});
