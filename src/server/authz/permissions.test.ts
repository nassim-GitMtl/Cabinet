import { describe, expect, it } from "vitest";
import { PERMISSIONS, ROLE_TEMPLATES } from "./permissions";

describe("role templates", () => {
  it("only reference known permissions", () => {
    for (const t of Object.values(ROLE_TEMPLATES)) for (const p of t.permissions) expect(PERMISSIONS).toContain(p);
  });
  it("technical admin has no patient or clinical access", () => {
    const perms = ROLE_TEMPLATES.tech_admin.permissions;
    expect(perms.some((p) => p.startsWith("patient.") || p.startsWith("clinical.") || p.startsWith("shared_profile."))).toBe(false);
  });
  it("accountant has no clinical access", () => {
    expect(ROLE_TEMPLATES.accountant.permissions.some((p) => p.startsWith("clinical."))).toBe(false);
  });
  it("receptionist cannot read clinical notes or shared profiles", () => {
    const perms = ROLE_TEMPLATES.receptionist.permissions;
    expect(perms).not.toContain("clinical.read");
    expect(perms).not.toContain("shared_profile.read");
  });
});
