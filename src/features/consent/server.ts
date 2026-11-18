import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { audit } from "@/server/audit";
import { requirePermission, tenantTx, type ClinicContext } from "@/server/auth/context";
import {
  consentGrants, consentRequests, networkPatients, patientIdentityLinks, patients,
  portalInvitations, sharedAccessEvents, type ShareCategory,
} from "@/server/db/schema";
import { evaluateSharedAccess } from "@/server/consent/evaluate";
import type { ConsentRequestInput } from "./schemas";

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
export class ConsentFlowError extends Error { constructor(public readonly code: "patientUnavailable" | "identityRequired") { super(code); } }

export class PortalRecoveryError extends Error {
  constructor(public readonly code: "patientUnavailable" | "portalAccountRequired") { super(code); }
}

export async function createPortalInvitation(ctx: ClinicContext, patientId: string, email: string, evidenceRef: string) {
  requirePermission(ctx, "shared_profile.request");
  return tenantTx(ctx, async (tx) => {
    const [patient] = await tx.select().from(patients).where(eq(patients.id, patientId)).for("update").limit(1);
    if (!patient || patient.status === "archived" || patient.status === "deceased") throw new ConsentFlowError("patientUnavailable");
    let networkPatientId = patient.networkPatientId;
    if (!networkPatientId) {
      const [network] = await tx.execute<{ id: string }>(sql`select uuidv7() as id`);
      networkPatientId = network!.id;
      // Do not use INSERT RETURNING here: the global identity is intentionally
      // unreadable until its tenant link exists, so RETURNING would fail RLS.
      await tx.insert(networkPatients).values({ id: networkPatientId });
      await tx.insert(patientIdentityLinks).values({
        organizationId: ctx.organizationId, patientId, networkPatientId, method: "assisted_in_person",
        evidenceRef, verifiedByUserId: ctx.userId,
      });
      await tx.update(patients).set({ networkPatientId, updatedAt: new Date(), version: sql`${patients.version} + 1` }).where(eq(patients.id, patientId));
    }
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + 7 * 86_400_000);
    await tx.insert(portalInvitations).values({
      organizationId: ctx.organizationId, patientId, networkPatientId, email, tokenHash: sha256(token),
      expiresAt, createdByUserId: ctx.userId,
    });
    await audit(tx, {
      organizationId: ctx.organizationId, actorType: "staff", actorUserId: ctx.userId,
      action: "patient_portal.invited", entityType: "patient", entityId: patientId, patientId,
      metadata: { identityMethod: "assisted_in_person" },
    });
    return { token, expiresAt, networkPatientId };
  });
}

export async function createPortalRecovery(ctx: ClinicContext, patientId: string, email: string, evidenceRef: string) {
  requirePermission(ctx, "shared_profile.request");
  return tenantTx(ctx, async (tx) => {
    const [patient] = await tx.select({ networkPatientId: patients.networkPatientId, status: patients.status })
      .from(patients).where(eq(patients.id, patientId)).limit(1);
    if (!patient || patient.status === "archived" || patient.status === "deceased") {
      throw new PortalRecoveryError("patientUnavailable");
    }
    if (!patient.networkPatientId) throw new PortalRecoveryError("portalAccountRequired");
    const [account] = await tx.execute<{ exists: boolean }>(
      sql`select app_private.patient_portal_account_exists(${patient.networkPatientId}) as exists`,
    );
    if (!account?.exists) throw new PortalRecoveryError("portalAccountRequired");
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + 24 * 60 * 60_000);
    await tx.insert(portalInvitations).values({
      organizationId: ctx.organizationId, patientId, networkPatientId: patient.networkPatientId,
      email, kind: "recovery", tokenHash: sha256(token), expiresAt, createdByUserId: ctx.userId,
    });
    await audit(tx, {
      organizationId: ctx.organizationId, actorType: "staff", actorUserId: ctx.userId,
      action: "patient_portal.recovery_created", entityType: "patient", entityId: patientId, patientId,
      metadata: { identityMethod: "assisted_in_person", evidenceProvided: Boolean(evidenceRef) },
    });
    return { token, expiresAt };
  });
}

export async function createConsentRequest(ctx: ClinicContext, patientId: string, input: ConsentRequestInput) {
  requirePermission(ctx, "shared_profile.request");
  return tenantTx(ctx, async (tx) => {
    const [patient] = await tx.select({ networkPatientId: patients.networkPatientId }).from(patients).where(eq(patients.id, patientId)).limit(1);
    if (!patient) throw new ConsentFlowError("patientUnavailable");
    if (!patient.networkPatientId) throw new ConsentFlowError("identityRequired");
    const [request] = await tx.insert(consentRequests).values({
      requestingOrganizationId: ctx.organizationId, networkPatientId: patient.networkPatientId,
      requestedByUserId: ctx.userId, purpose: input.purpose,
      requestedScope: { categories: input.categories, dateFrom: input.dateFrom, dateTo: input.dateTo, includeFutureUpdates: input.includeFutureUpdates },
      status: "awaiting_patient", expiresAt: new Date(Date.now() + input.expiresInDays * 86_400_000),
    }).returning({ id: consentRequests.id });
    await audit(tx, {
      organizationId: ctx.organizationId, actorType: "staff", actorUserId: ctx.userId,
      action: "shared_profile.consent_requested", entityType: "consent_request", entityId: request!.id, patientId,
      metadata: { categories: input.categories },
    });
    return request!.id;
  });
}

export async function getConsentOverview(ctx: ClinicContext, patientId: string) {
  requirePermission(ctx, "shared_profile.request");
  return tenantTx(ctx, async (tx) => {
    const [patient] = await tx.select({ networkPatientId: patients.networkPatientId }).from(patients).where(eq(patients.id, patientId)).limit(1);
    if (!patient) throw new ConsentFlowError("patientUnavailable");
    if (!patient.networkPatientId) return { networkPatientId: null, hasPortalAccount: false, invitations: [], requests: [], grants: [] };
    const [invitations, requests, grants, account] = await Promise.all([
      tx.select({ email: portalInvitations.email, expiresAt: portalInvitations.expiresAt, usedAt: portalInvitations.usedAt, createdAt: portalInvitations.createdAt })
        .from(portalInvitations).where(eq(portalInvitations.patientId, patientId)).orderBy(desc(portalInvitations.createdAt)).limit(5),
      tx.select().from(consentRequests).where(eq(consentRequests.networkPatientId, patient.networkPatientId)).orderBy(desc(consentRequests.createdAt)).limit(20),
      tx.select().from(consentGrants).where(and(eq(consentGrants.networkPatientId, patient.networkPatientId), eq(consentGrants.receivingOrganizationId, ctx.organizationId))).orderBy(desc(consentGrants.grantedAt)).limit(20),
      tx.execute<{ exists: boolean }>(sql`select app_private.patient_portal_account_exists(${patient.networkPatientId}) as exists`),
    ]);
    return { networkPatientId: patient.networkPatientId, hasPortalAccount: Boolean(account[0]?.exists), invitations, requests, grants };
  });
}

/** Single guarded shared-read decision path; every outcome is logged atomically. */
export async function authorizeSharedRecord(ctx: ClinicContext, networkPatientId: string, category: ShareCategory, recordDate: string, recordCreatedAt: Date) {
  requirePermission(ctx, "shared_profile.read");
  return tenantTx(ctx, async (tx) => {
    const grants = await tx.select().from(consentGrants).where(and(
      eq(consentGrants.networkPatientId, networkPatientId), eq(consentGrants.receivingOrganizationId, ctx.organizationId),
    ));
    const decision = evaluateSharedAccess(grants.map((g) => ({
      id: g.id, receivingOrganizationId: g.receivingOrganizationId, networkPatientId: g.networkPatientId,
      status: g.status, categories: g.categories, dateFrom: g.dateFrom, dateTo: g.dateTo,
      includeFutureUpdates: g.includeFutureUpdates, grantedAt: g.grantedAt, expiresAt: g.expiresAt, revokedAt: g.revokedAt,
    })), {
      organizationId: ctx.organizationId, organizationVerified: ctx.organization.verificationStatus === "verified",
      networkPatientId, category, recordDate, recordCreatedAt, actorHasPermission: true, now: new Date(),
    });
    await tx.insert(sharedAccessEvents).values({
      organizationId: ctx.organizationId, networkPatientId, grantId: decision.allowed ? decision.grantId : null,
      actorUserId: ctx.userId, category, outcome: decision.allowed ? "allowed" : "denied",
      denyReason: decision.allowed ? null : decision.reason,
    });
    return decision;
  });
}
