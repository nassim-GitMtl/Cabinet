import { describe, expect, it } from "vitest";
import { sessionPermissions } from "./modules";
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

  it("leaves a clinic whose trial is over able to view and take its data out, nothing else", () => {
    const base = { roleKey: "owner", rolePermissions: ROLE_TEMPLATES.owner.permissions, enabledModules: ["core", "billing", "reports"], readOnlyCopy: false };
    const running = sessionPermissions({ ...base, trialExpired: false });
    const over = sessionPermissions({ ...base, trialExpired: true });
    expect(running).toEqual(expect.arrayContaining(["patient.create", "invoice.issue", "appointment.manage"]));
    expect(over).toEqual(expect.arrayContaining(["patient.read", "invoice.read", "report.financial", "report.export", "patient.export"]));
    for (const write of ["patient.create", "invoice.issue", "payment.receive", "appointment.manage", "org.settings.manage", "org.staff.manage", "honorarium.pay"]) {
      expect(over).not.toContain(write);
    }
    // The clinic computer's cloud copy stays strictly view-only (no export either), trial or not.
    expect(sessionPermissions({ ...base, readOnlyCopy: true, trialExpired: true })).not.toContain("patient.export");
    // Modules still apply.
    expect(over).not.toContain("treatment_plan.read");
  });
});
