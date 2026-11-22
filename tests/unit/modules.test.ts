import { describe, expect, it } from "vitest";
import { entitledPermissions, normalizeModules } from "@/server/authz/modules";

describe("commercial module entitlements", () => {
  it("always keeps core and removes permissions for modules not purchased", () => {
    expect(normalizeModules(["billing", "unknown", "billing"])).toEqual(["core", "billing"]);
    expect(entitledPermissions(["patient.read", "invoice.read", "inventory.manage", "booking.approve"], ["core", "billing"]))
      .toEqual(["patient.read", "invoice.read"]);
  });

  it("keeps legacy empty entitlements working until migration 0045 is applied", () => {
    expect(entitledPermissions(["invoice.read", "inventory.manage"], [])).toEqual(["invoice.read", "inventory.manage"]);
  });
});
