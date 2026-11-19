import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createConsentRequest, createPortalInvitation, createPortalRecovery, authorizeSharedRecord, getConsentOverview } from "@/features/consent/server";
import { decideConsentRequest, listPatientConsents, revokeConsentGrant } from "@/features/consent/portal";
import { listPatientPortalData } from "@/features/consent/portal-data";
import { createPatient } from "@/features/patients/server";
import { authenticatePatient, activatePortalAccount, getPortalInvitation, getPortalRecovery, resetPortalPassword } from "@/server/portal/auth";
import {
  appointmentTypes, appointments, branches, consentGrants, invoices, legalEntities, memberships,
  organizations, patientSessions, payments, portalInvitations, sharedAccessEvents,
  treatmentPlanDecisions, treatmentPlans, treatmentPlanVersions,
} from "@/server/db/schema";
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

  it("resets a password through a staff-assisted single-use link and revokes existing sessions", async () => {
    const f = await setup();
    const recovery = await createPortalRecovery(f.ctx, f.patientId, f.email, "IDCHECK-RECOVERY-001");
    expect(await getPortalRecovery(recovery.token)).toMatchObject({ email: f.email, clinicName: "Cabinet Consent A" });
    await withDbContext({ actorType: "patient", networkPatientId: f.identity.networkPatientId }, (tx) =>
      tx.insert(patientSessions).values({
        id: randomUUID(), accountId: f.identity.accountId, networkPatientId: f.identity.networkPatientId,
        expiresAt: new Date(Date.now() + 60_000),
      }));

    await resetPortalPassword(recovery.token, "a-new-patient-password");
    expect(await getPortalRecovery(recovery.token)).toBeNull();
    expect(await authenticatePatient(f.email, "patient-safe-password")).toMatchObject({ ok: false, reason: "invalid" });
    expect(await authenticatePatient(f.email, "a-new-patient-password")).toMatchObject({ ok: true });
    const sessions = await withDbContext({ actorType: "patient", networkPatientId: f.identity.networkPatientId }, (tx) =>
      tx.select().from(patientSessions));
    expect(sessions.every((session) => session.revokedAt !== null)).toBe(true);
  });

  it("shows only the linked local patient's appointments, accepted estimates, invoices and payments", async () => {
    const f = await setup();
    const otherPatient = await createPatient(f.ctx, { ...patientInput, firstName: "Other", email: null }, { confirmNotDuplicate: true });
    if (otherPatient.status !== "created") throw new Error("patient fixture failed");
    await withDbContext({ organizationId: f.ctx.organizationId, userId: f.ctx.userId, actorType: "staff" }, async (tx) => {
      const [branch] = await tx.select().from(branches).limit(1);
      const [provider] = await tx.select().from(memberships).where(eq(memberships.isProvider, true)).limit(1);
      const [type] = await tx.select().from(appointmentTypes).limit(1);
      const [entity] = await tx.select().from(legalEntities).limit(1);
      if (!branch || !provider || !type || !entity) throw new Error("clinic defaults missing");
      await tx.insert(appointments).values([
        { organizationId: f.ctx.organizationId, branchId: branch.id, patientId: f.patientId, providerId: provider.id, appointmentTypeId: type.id, startsAt: new Date("2026-12-01T09:00:00Z"), endsAt: new Date("2026-12-01T09:30:00Z"), createdByUserId: f.ctx.userId },
        { organizationId: f.ctx.organizationId, branchId: branch.id, patientId: otherPatient.id, providerId: provider.id, appointmentTypeId: type.id, startsAt: new Date("2026-12-02T09:00:00Z"), endsAt: new Date("2026-12-02T09:30:00Z"), createdByUserId: f.ctx.userId },
      ]);
      const [plan] = await tx.insert(treatmentPlans).values({ organizationId: f.ctx.organizationId, patientId: f.patientId, status: "accepted", createdByUserId: f.ctx.userId, updatedByUserId: f.ctx.userId }).returning();
      const [version] = await tx.insert(treatmentPlanVersions).values({ organizationId: f.ctx.organizationId, planId: plan!.id, patientId: f.patientId, versionNumber: 1, title: "Plan portal", currency: "DZD", totalMinor: 250000, createdByUserId: f.ctx.userId }).returning();
      await tx.insert(treatmentPlanDecisions).values({ organizationId: f.ctx.organizationId, planId: plan!.id, versionId: version!.id, patientId: f.patientId, decision: "accepted", method: "signed_in_clinic", decidedAt: new Date("2026-11-01T10:00:00Z"), recordedByUserId: f.ctx.userId });
      await tx.insert(invoices).values({ organizationId: f.ctx.organizationId, legalEntityId: entity.id, patientId: f.patientId, issuerSnapshot: { clinicName: "Cabinet Consent A", legalName: "Cabinet Consent A", address: null, identifiers: {}, phone: null, email: null }, number: "PORTAL-001", status: "issued", documentDate: "2026-11-01", currency: "DZD", totalMinor: 250000, subtotalMinor: 250000, issuedAt: new Date(), issuedByUserId: f.ctx.userId, createdByUserId: f.ctx.userId });
      await tx.insert(payments).values({ organizationId: f.ctx.organizationId, legalEntityId: entity.id, patientId: f.patientId, method: "cash", amountMinor: 100000, currency: "DZD", issuerSnapshot: { clinicName: "Cabinet Consent A", legalName: "Cabinet Consent A", address: null, identifiers: {}, phone: null, email: null }, receivedOn: "2026-11-02", receiptNumber: "RP-PORTAL-001", idempotencyKey: randomUUID(), createdByUserId: f.ctx.userId });
    });

    const clinics = await listPatientPortalData(f.portalCtx);
    expect(clinics).toHaveLength(1);
    expect(clinics[0]).toMatchObject({
      organizationName: "Cabinet Consent A",
      estimates: [{ title: "Plan portal", totalMinor: 250000 }],
      invoices: [{ number: "PORTAL-001", totalMinor: 250000, balanceMinor: 250000 }],
      payments: [{ receiptNumber: "RP-PORTAL-001", amountMinor: 100000 }],
    });
    expect(clinics[0]!.appointments).toHaveLength(1);
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
