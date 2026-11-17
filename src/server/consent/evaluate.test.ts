import { describe, expect, it } from "vitest";
import { evaluateSharedAccess, type GrantSnapshot, type SharedAccessRequest } from "./evaluate";

const now = new Date("2026-11-17T10:00:00Z");
const grant: GrantSnapshot = {
  id: "g1",
  receivingOrganizationId: "orgB",
  networkPatientId: "np1",
  status: "active",
  categories: ["summary", "treatments"],
  dateFrom: "2020-01-01",
  dateTo: null,
  includeFutureUpdates: false,
  grantedAt: new Date("2026-06-01T00:00:00Z"),
  expiresAt: new Date("2027-06-01T00:00:00Z"),
  revokedAt: null,
};
const req: SharedAccessRequest = {
  organizationId: "orgB",
  organizationVerified: true,
  networkPatientId: "np1",
  category: "summary",
  recordDate: "2024-03-10",
  recordCreatedAt: new Date("2024-03-10T09:00:00Z"),
  actorHasPermission: true,
  now,
};

describe("evaluateSharedAccess", () => {
  it("allows a request inside an active grant", () => {
    expect(evaluateSharedAccess([grant], req)).toEqual({ allowed: true, grantId: "g1" });
  });
  it("denies without a grant (knowing the patient is not enough)", () => {
    expect(evaluateSharedAccess([], req)).toMatchObject({ allowed: false, reason: "no_active_grant" });
  });
  it("denies another organization's grant", () => {
    expect(evaluateSharedAccess([grant], { ...req, organizationId: "orgC" })).toMatchObject({ allowed: false });
  });
  it("denies revoked, expired and superseded grants", () => {
    expect(evaluateSharedAccess([{ ...grant, status: "revoked", revokedAt: now }], req).allowed).toBe(false);
    expect(evaluateSharedAccess([{ ...grant, expiresAt: new Date("2026-01-01") }], req).allowed).toBe(false);
    expect(evaluateSharedAccess([{ ...grant, status: "superseded" }], req).allowed).toBe(false);
  });
  it("denies categories not granted (e.g. images, financial)", () => {
    expect(evaluateSharedAccess([grant], { ...req, category: "images" })).toMatchObject({ reason: "category_not_granted" });
    expect(evaluateSharedAccess([grant], { ...req, category: "financial" })).toMatchObject({ reason: "category_not_granted" });
  });
  it("denies records outside the granted date range", () => {
    expect(evaluateSharedAccess([grant], { ...req, recordDate: "2019-12-31" })).toMatchObject({ reason: "outside_date_range" });
  });
  it("denies records created after the grant unless future updates were granted", () => {
    const later = { ...req, recordCreatedAt: new Date("2026-10-01T00:00:00Z"), recordDate: "2026-10-01" };
    expect(evaluateSharedAccess([grant], later)).toMatchObject({ reason: "future_updates_not_granted" });
    expect(evaluateSharedAccess([{ ...grant, includeFutureUpdates: true }], later).allowed).toBe(true);
  });
  it("denies staff without permission and unverified organizations", () => {
    expect(evaluateSharedAccess([grant], { ...req, actorHasPermission: false })).toMatchObject({ reason: "no_permission" });
    expect(evaluateSharedAccess([grant], { ...req, organizationVerified: false })).toMatchObject({ reason: "organization_unverified" });
  });
});
