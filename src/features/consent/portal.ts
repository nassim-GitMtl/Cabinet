import "server-only";

import { and, desc, eq, sql } from "drizzle-orm";
import { audit } from "@/server/audit";
import { consentGrants, consentRequests } from "@/server/db/schema";
import { withDbContext } from "@/server/db/tenant";
import type { PatientPortalContext } from "@/server/portal/session";

export class PatientConsentError extends Error {
  constructor(public readonly code: "requestUnavailable" | "grantUnavailable") { super(code); }
}

function patientTx<T>(ctx: PatientPortalContext, fn: Parameters<typeof withDbContext<T>>[1]) {
  return withDbContext({ actorType: "patient", networkPatientId: ctx.networkPatientId }, fn);
}

export async function listPatientConsents(ctx: PatientPortalContext) {
  return patientTx(ctx, async (tx) => {
    const [requests, grants, organizations] = await Promise.all([
      tx.select().from(consentRequests)
        .where(eq(consentRequests.networkPatientId, ctx.networkPatientId))
        .orderBy(desc(consentRequests.createdAt)),
      tx.select().from(consentGrants)
        .where(eq(consentGrants.networkPatientId, ctx.networkPatientId))
        .orderBy(desc(consentGrants.grantedAt)),
      tx.execute<{ organization_id: string; organization_name: string }>(
        sql`select * from app_private.patient_consent_organizations()`,
      ),
    ]);
    return {
      requests,
      grants,
      organizations: Object.fromEntries(organizations.map((o) => [o.organization_id, o.organization_name])),
    };
  });
}

export async function decideConsentRequest(
  ctx: PatientPortalContext,
  requestId: string,
  decision: "approved" | "declined",
) {
  return patientTx(ctx, async (tx) => {
    const [request] = await tx.select().from(consentRequests)
      .where(and(eq(consentRequests.id, requestId), eq(consentRequests.networkPatientId, ctx.networkPatientId)))
      .for("update").limit(1);
    if (!request || request.status !== "awaiting_patient" || request.expiresAt <= new Date()) {
      throw new PatientConsentError("requestUnavailable");
    }

    if (decision === "approved") {
      await tx.insert(consentGrants).values({
        networkPatientId: ctx.networkPatientId,
        receivingOrganizationId: request.requestingOrganizationId,
        requestId: request.id,
        approverType: "patient",
        approverRef: ctx.accountId,
        verificationMethod: "patient_portal_password",
        purpose: request.purpose,
        categories: request.requestedScope.categories,
        dateFrom: request.requestedScope.dateFrom ?? null,
        dateTo: request.requestedScope.dateTo ?? null,
        includeFutureUpdates: request.requestedScope.includeFutureUpdates,
        branchIds: request.requestedScope.branchIds ?? null,
        consentTextVersion: "portal-consent-v1",
        consentLanguage: ctx.locale,
      });
    }
    await tx.update(consentRequests).set({ status: decision, decidedAt: new Date() })
      .where(eq(consentRequests.id, request.id));
    await audit(tx, {
      organizationId: null,
      actorType: "patient",
      action: `shared_profile.consent_${decision}`,
      entityType: "consent_request",
      entityId: request.id,
      metadata: { organizationId: request.requestingOrganizationId },
    });
  });
}

export async function revokeConsentGrant(ctx: PatientPortalContext, grantId: string, reason: string | null) {
  return patientTx(ctx, async (tx) => {
    const [grant] = await tx.select().from(consentGrants)
      .where(and(eq(consentGrants.id, grantId), eq(consentGrants.networkPatientId, ctx.networkPatientId)))
      .for("update").limit(1);
    if (!grant || grant.status !== "active") throw new PatientConsentError("grantUnavailable");
    await tx.update(consentGrants).set({ status: "revoked", revokedAt: new Date(), revokedReason: reason })
      .where(eq(consentGrants.id, grant.id));
    await audit(tx, {
      organizationId: null,
      actorType: "patient",
      action: "shared_profile.consent_revoked",
      entityType: "consent_grant",
      entityId: grant.id,
      metadata: { organizationId: grant.receivingOrganizationId },
    });
  });
}
