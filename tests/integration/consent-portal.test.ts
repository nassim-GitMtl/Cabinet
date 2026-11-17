import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createConsentRequest, createPortalInvitation, authorizeSharedRecord, getConsentOverview } from "@/features/consent/server";
import { decideConsentRequest, listPatientConsents, revokeConsentGrant } from "@/features/consent/portal";
import { createPatient } from "@/features/patients/server";
import { authenticatePatient, activatePortalAccount, getPortalInvitation } from "@/server/portal/auth";
import { consentGrants, organizations, portalInvitations, sharedAccessEvents } from "@/server/db/schema";
import { withDbContext } from "@/server/db/tenant";
import type { PatientPortalContext } from "@/server/portal/session";
import { expectDbError, makeClinic } from "../support/factories";

const patientInput = {
  firstName: "Leila", lastName: "Consent", firstNameAr: null, lastNameAr: null,
  sex: undefined, birthDate: "1992-08-10", birthDatePrecision: "exact" as const,
  phone: null, phoneAlt: null, email: "leila.portal@example.test", addressLine: null, city: null, region: null,
  preferredLocale: "fr" as const, emergencyName: null, emergencyRelationship: null,
  emergencyPhone: null, referralSource: null, referredBy: null, administrativeNotes: null,
  assignedProviderId: null,
};

async function setup() {
  const ctx = await makeClinic("Cabinet Consent A");
  const email = `leila-${randomUUID()}@example.test`;
  const patient = await createPatient(ctx, { ...patientInput, email }, { confirmNotDuplicate: true });
  if (patient.status !== "created") throw new Error("patient fixture failed");
  const invitation = await createPortalInvitation(ctx, patient.id, email, "IDCHECK-2026-001");
  const resolved = await getPortalInvitation(invitation.token);
  const identity = await activatePortalAccount(invitation.token, "patient-safe-password");
  const portalCtx: PatientPortalContext = { ...identity, sessionId: "test-session" };
  return { ctx, patientId: patient.id, invitation, resolved, identity, portalCtx, email };
}

describe("patient portal consent", () => {
  it("activates a single-use patient account and applies lockout-safe authentication", async () => {
    const f = await setup();
    expect(f.resolved).toMatchObject({ email: f.email, clinicName: "Cabinet Consent A" });
    expect(await getPortalInvitation(f.invitation.token)).toBeNull();
    expect(await authenticatePatient(f.email, "wrong-password")).toMatchObject({ ok: false, reason: "invalid" });
    expect(await authenticatePatient(f.email, "patient-safe-password")).toMatchObject({ ok: true });
  });

  it("requires the patient to approve the exact requested scope and permits later revocation", async () => {
    const f = await setup();
    const requestId = await createConsentRequest(f.ctx, f.patientId, {
      purpose: "Continuity of dental care",
      categories: ["summary", "alerts"],
      dateFrom: "2026-01-01",
      dateTo: "2026-12-31",
      includeFutureUpdates: false,
      expiresInDays: 30,
    });
    const before = await listPatientConsents(f.portalCtx);
    expect(before.requests).toMatchObject([{ id: requestId, status: "awaiting_patient" }]);
    expect(before.organizations[f.ctx.organizationId]).toBe("Cabinet Consent A");

    await decideConsentRequest(f.portalCtx, requestId, "approved");
    const staffView = await getConsentOverview(f.ctx, f.patientId);
    expect(staffView.grants).toMatchObject([{
      status: "active", categories: ["summary", "alerts"], dateFrom: "2026-01-01", dateTo: "2026-12-31",
    }]);
    const grant = staffView.grants[0]!;

    await withDbContext({ organizationId: f.ctx.organizationId, userId: f.ctx.userId, actorType: "staff" }, (tx) =>
      tx.update(organizations).set({ verificationStatus: "verified" }).where(eq(organizations.id, f.ctx.organizationId)));
    const verified = { ...f.ctx, organization: { ...f.ctx.organization, verificationStatus: "verified" as const } };
    expect(await authorizeSharedRecord(verified, f.identity.networkPatientId, "summary", "2026-06-15", new Date("2026-06-15T10:00:00Z")))
      .toMatchObject({ allowed: true, grantId: grant.id });

    await expectDbError(
      withDbContext({ actorType: "patient", networkPatientId: f.identity.networkPatientId }, (tx) =>
        tx.update(consentGrants).set({ categories: ["financial"] }).where(eq(consentGrants.id, grant.id))),
      /immutable except patient revocation/,
    );
    await revokeConsentGrant(f.portalCtx, grant.id, "No longer needed");
    expect(await authorizeSharedRecord(verified, f.identity.networkPatientId, "summary", "2026-06-15", new Date("2026-06-15T10:00:00Z")))
      .toMatchObject({ allowed: false, reason: "no_active_grant" });
    const events = await withDbContext({ organizationId: f.ctx.organizationId, userId: f.ctx.userId, actorType: "staff" }, (tx) =>
      tx.select().from(sharedAccessEvents).where(eq(sharedAccessEvents.networkPatientId, f.identity.networkPatientId)));
    expect(events.map((event) => event.outcome)).toEqual(["allowed", "denied"]);
  });

  it("keeps tenant invitations private and staff physically unable to approve", async () => {
    const f = await setup();
    const other = await makeClinic("Cabinet Consent B");
    const hidden = await withDbContext({ organizationId: other.organizationId, userId: other.userId, actorType: "staff" }, (tx) =>
      tx.select().from(portalInvitations).where(eq(portalInvitations.patientId, f.patientId)));
    expect(hidden).toEqual([]);
    await expectDbError(
      withDbContext({ organizationId: f.ctx.organizationId, userId: f.ctx.userId, actorType: "staff" }, (tx) =>
        tx.insert(consentGrants).values({
          networkPatientId: f.identity.networkPatientId,
          receivingOrganizationId: f.ctx.organizationId,
          approverType: "patient", approverRef: "forged", verificationMethod: "staff",
          purpose: "forged", categories: ["summary"], consentTextVersion: "v1", consentLanguage: "fr",
        })),
      /row-level security/,
    );
  });
});
