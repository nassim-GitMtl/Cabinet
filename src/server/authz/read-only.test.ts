import { describe, expect, it } from "vitest";
import { ROLE_TEMPLATES, readOnlyCopyPermissions } from "./permissions";

describe("view-only cloud copy permissions", () => {
  it("keeps viewing and reports, drops every change", () => {
    const owner = readOnlyCopyPermissions(ROLE_TEMPLATES.owner.permissions);
    expect(owner).toEqual(expect.arrayContaining(["patient.read", "clinical.read", "invoice.read", "appointment.read", "report.financial", "audit.read", "honorarium.read.all"]));
    for (const write of ["patient.create", "invoice.issue", "payment.receive", "appointment.manage", "org.settings.manage", "clinical.write", "patient.followup", "shared_profile.read", "honorarium.pay", "honorarium.manage", "honorarium.close"]) {
      expect(owner).not.toContain(write);
    }
    expect(owner.every((p) => p.endsWith(".read") || p.startsWith("report.") || p === "audit.read" || p.startsWith("honorarium.read."))).toBe(true);
    expect(readOnlyCopyPermissions(ROLE_TEMPLATES.receptionist.permissions)).not.toContain("patient.create");
  });
});
