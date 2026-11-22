import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { getAgendaSetup } from "@/features/agenda/server";
import { createInventoryItem, getInventory, receiveInventory } from "@/features/inventory/server";
import { getOperationalNotifications } from "@/features/notifications/server";
import { createInstrumentSet, createSterilizer, getSterilizationDashboard, recordSterilizationCycle } from "@/features/sterilization/server";
import { addDays, todayInZone } from "@/lib/dates";
import { bookingRequests } from "@/server/db/schema";
import { withDbContext } from "@/server/db/tenant";
import { contextFor, makeClinic } from "../support/factories";

describe("global operational notifications", () => {
  it("shows real tenant-scoped counts and filters every source by permission", async () => {
    const ctx = await makeClinic("Cabinet Notifications A");
    const today = todayInZone(ctx.organization.timezone);

    const agenda = await getAgendaSetup(ctx);
    await withDbContext({ organizationId: ctx.organizationId, userId: ctx.userId, actorType: "staff" }, async (tx) => {
      await tx.insert(bookingRequests).values({
        organizationId: ctx.organizationId,
        status: "submitted",
        refHash: randomUUID(),
        contactName: "Patient notification",
        contactPhone: "0550000000",
        preferredLocale: "fr",
        appointmentTypeId: agenda.types[0]!.id,
        providerId: agenda.providers[0]!.id,
        requestedStartsAt: new Date("2026-12-01T09:00:00Z"),
        requestedEndsAt: new Date("2026-12-01T09:30:00Z"),
        expiresAt: new Date("2026-12-02T09:00:00Z"),
      });
    });

    const inventory = await getInventory(ctx, today);
    const branchId = inventory.branches.find((branch) => branch.active)!.id;
    const itemId = await createInventoryItem(ctx, {
      sku: "ALERT-001",
      name: "Article surveillé",
      category: null,
      unit: "box",
      minimumStock: 5,
    });
    await receiveInventory(ctx, {
      itemId,
      branchId,
      lotNumber: "EXP-001",
      receivedOn: today,
      expiresOn: addDays(today, 30),
      quantity: 2,
      reference: null,
    });

    const sterilization = await getSterilizationDashboard(ctx);
    const sterilizationBranchId = sterilization.branches.find((branch) => branch.active)!.id;
    const sterilizerId = await createSterilizer(ctx, { branchId: sterilizationBranchId, name: "Autoclave notifications", serialNumber: null });
    const setId = await createInstrumentSet(ctx, { code: "NOTIF-01", name: "Set notifications", contents: null });
    await recordSterilizationCycle(ctx, {
      branchId: sterilizationBranchId,
      sterilizerId,
      reference: "NOTIF-CYCLE-1",
      program: "134 °C",
      startedDate: today,
      startedTime: "09:00",
      startedAt: new Date(),
      temperatureC: "134",
      pressureBar: "2.1",
      holdMinutes: "18",
      chemicalIndicator: "pass",
      airRemovalTest: "pass",
      biologicalIndicator: "not_used",
      notes: null,
      packs: [{ instrumentSetId: setId, label: null, expiresOn: addDays(today, 180), quantity: 1 }],
    });

    expect(await getOperationalNotifications(ctx)).toEqual([
      { kind: "bookingRequests", count: 1, href: "/agenda/requests", priority: "attention" },
      { kind: "sterilizationPending", count: 1, href: "/sterilization", priority: "attention" },
      { kind: "inventoryLow", count: 1, href: "/inventory", priority: "attention" },
      { kind: "inventoryExpiring", count: 1, href: "/inventory", priority: "attention" },
    ]);

    expect(await getOperationalNotifications(contextFor(ctx, "accountant"))).toEqual([
      { kind: "bookingRequests", count: 1, href: "/agenda/requests", priority: "attention" },
    ]);
    expect(await getOperationalNotifications(contextFor(ctx, "tech_admin"))).toEqual([]);

    const other = await makeClinic("Cabinet Notifications B");
    expect(await getOperationalNotifications(other)).toEqual([]);
  });
});
