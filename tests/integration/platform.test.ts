import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getStaffPasswordReset } from "@/server/auth/password-reset";
import { db } from "@/server/db/client";
import { organizations, users } from "@/server/db/schema";
import { withDbContext } from "@/server/db/tenant";
import { listPlatformClinics, provisionPlatformClinic, setPlatformClinicModules } from "@/features/platform/server";
import { makeClinic } from "../support/factories";

describe("platform operator clinic provisioning", () => {
  it("lists only platform metadata, provisions an owner activation link, and enforces modules", async () => {
    const operator = await makeClinic("Platform Operator Home");
    await db.update(users).set({ platformRole: "operator" }).where(eq(users.id, operator.userId));
    const ctx = { userId: operator.userId, fullName: "Operator", email: operator.user.email };

    const provisioned = await provisionPlatformClinic(ctx, {
      clinicName: "Clinic Commercial Modules",
      kind: "solo",
      ownerFullName: "New Owner",
      email: `commercial-${crypto.randomUUID()}@example.test`,
      ownerIsDentist: true,
      locale: "fr",
      modules: ["billing", "online_booking"],
    });
    const reset = await getStaffPasswordReset(provisioned.token);
    expect(reset?.fullName).toBe("New Owner");

    const listed = await listPlatformClinics(ctx);
    const clinic = listed.find((row) => row.id === provisioned.organizationId)!;
    expect(clinic.ownerEmail).toContain("commercial-");
    expect(clinic.enabledModules).toEqual(["core", "online_booking", "billing"]);

    await setPlatformClinicModules(ctx, clinic.id, ["inventory"]);
    const [stored] = await withDbContext({ organizationId: clinic.id, actorType: "system" }, (tx) =>
      tx.select({ enabledModules: organizations.enabledModules }).from(organizations).where(eq(organizations.id, clinic.id)),
    );
    expect(stored!.enabledModules).toEqual(["core", "inventory"]);

    // A clinic run from its clinic computer: the online copy refuses staff writes, but not the operator's modules.
    await withDbContext({ organizationId: clinic.id, actorType: "system" }, (tx) =>
      tx.update(organizations).set({ dataHome: "clinic" }).where(eq(organizations.id, clinic.id)));
    await setPlatformClinicModules(ctx, clinic.id, ["billing", "reports"]);
    const [afterSync] = await withDbContext({ organizationId: clinic.id, actorType: "system" }, (tx) =>
      tx.select({ enabledModules: organizations.enabledModules }).from(organizations).where(eq(organizations.id, clinic.id)),
    );
    expect(afterSync!.enabledModules).toEqual(["core", "billing", "reports"]);
  });

  it("rejects a non-operator at the database boundary", async () => {
    const ordinary = await makeClinic("Ordinary Owner");
    const ctx = { userId: ordinary.userId, fullName: "Owner", email: ordinary.user.email };
    await expect(listPlatformClinics(ctx)).rejects.toThrow();
    await expect(provisionPlatformClinic(ctx, {
      clinicName: "Forbidden Clinic", kind: "solo", ownerFullName: "Owner", email: `forbidden-${crypto.randomUUID()}@example.test`,
      ownerIsDentist: true, locale: "fr", modules: ["billing"],
    })).rejects.toMatchObject({ code: "clinicUnavailable" });
  });
});
