import "server-only";

import { and, asc, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { todayInZone } from "@/lib/dates";
import { audit } from "@/server/audit";
import { requirePermission, tenantTx, type ClinicContext } from "@/server/auth/context";
import {
  memberships, odontogramFindings, patients, performedProcedures, treatmentPlanItems,
  treatmentPlans, treatmentPlanVersions,
} from "@/server/db/schema";
import type { OdontogramFindingInput, OdontogramStatusInput } from "./schemas";

export class OdontogramReferenceError extends Error {
  constructor(public readonly code: "patientUnavailable" | "providerUnavailable" | "treatmentUnavailable" | "findingUnavailable") { super(code); }
}
export class OdontogramValidationError extends Error {
  constructor(public readonly fieldErrors: Record<string, string>) { super("Invalid odontogram finding"); }
}

export async function getOdontogram(ctx: ClinicContext, patientId: string) {
  requirePermission(ctx, "clinical.read");
  return tenantTx(ctx, async (tx) => {
    const [rows, providers, planItems, procedures] = await Promise.all([
      tx.select({
        id: odontogramFindings.id, toothNumber: odontogramFindings.toothNumber,
        surfaces: odontogramFindings.surfaces, kind: odontogramFindings.kind,
        status: odontogramFindings.status, note: odontogramFindings.note,
        observedOn: odontogramFindings.observedOn, providerId: odontogramFindings.providerId,
        providerName: memberships.displayName, providerTitle: memberships.title,
        treatmentPlanItemId: odontogramFindings.treatmentPlanItemId,
        performedProcedureId: odontogramFindings.performedProcedureId,
        supersedesId: odontogramFindings.supersedesId, createdAt: odontogramFindings.createdAt,
      }).from(odontogramFindings).innerJoin(memberships, eq(memberships.id, odontogramFindings.providerId))
        .where(eq(odontogramFindings.patientId, patientId)).orderBy(desc(odontogramFindings.createdAt)),
      tx.select({ id: memberships.id, displayName: memberships.displayName, title: memberships.title })
        .from(memberships).where(and(eq(memberships.isProvider, true), eq(memberships.status, "active")))
        .orderBy(asc(memberships.displayName)),
      tx.select({
        id: treatmentPlanItems.id, toothNumber: treatmentPlanItems.toothNumber,
        serviceSnapshot: treatmentPlanItems.serviceSnapshot, planTitle: treatmentPlanVersions.title,
        planStatus: treatmentPlans.status,
      }).from(treatmentPlanItems)
        .innerJoin(treatmentPlanVersions, eq(treatmentPlanVersions.id, treatmentPlanItems.versionId))
        .innerJoin(treatmentPlans, and(
          eq(treatmentPlans.id, treatmentPlanVersions.planId),
          eq(treatmentPlans.currentVersion, treatmentPlanVersions.versionNumber),
        )).where(and(
          eq(treatmentPlanItems.patientId, patientId), isNotNull(treatmentPlanItems.toothNumber),
          inArray(treatmentPlans.status, ["draft", "proposed", "accepted", "completed"]),
        )).orderBy(desc(treatmentPlans.updatedAt)),
      tx.select({
        id: performedProcedures.id, toothNumber: performedProcedures.toothNumber,
        serviceSnapshot: performedProcedures.serviceSnapshot, serviceDate: performedProcedures.serviceDate,
      }).from(performedProcedures).where(and(
        eq(performedProcedures.patientId, patientId), eq(performedProcedures.status, "completed"),
        isNotNull(performedProcedures.toothNumber),
      )).orderBy(desc(performedProcedures.serviceDate)),
    ]);
    const superseded = new Set(rows.flatMap((row) => row.supersedesId ? [row.supersedesId] : []));
    return { findings: rows.filter((row) => !superseded.has(row.id)), history: rows, providers, planItems, procedures };
  });
}

export async function createOdontogramFinding(ctx: ClinicContext, patientId: string, input: OdontogramFindingInput) {
  requirePermission(ctx, "clinical.write");
  if (input.observedOn > todayInZone(ctx.organization.timezone)) throw new OdontogramValidationError({ observedOn: "futureDate" });
  return tenantTx(ctx, async (tx) => {
    const [[patient], [provider]] = await Promise.all([
      tx.select({ id: patients.id, status: patients.status }).from(patients).where(eq(patients.id, patientId)).limit(1),
      tx.select({ id: memberships.id }).from(memberships).where(and(
        eq(memberships.id, input.providerId), eq(memberships.isProvider, true), eq(memberships.status, "active"),
      )).limit(1),
    ]);
    if (!patient || patient.status === "archived" || patient.status === "deceased") throw new OdontogramReferenceError("patientUnavailable");
    if (!provider) throw new OdontogramReferenceError("providerUnavailable");
    if (input.treatmentPlanItemId) {
      const [item] = await tx.select({ id: treatmentPlanItems.id }).from(treatmentPlanItems).where(and(
        eq(treatmentPlanItems.id, input.treatmentPlanItemId), eq(treatmentPlanItems.patientId, patientId),
        eq(treatmentPlanItems.toothNumber, input.toothNumber),
      )).limit(1);
      if (!item) throw new OdontogramReferenceError("treatmentUnavailable");
    }
    if (input.performedProcedureId) {
      const [procedure] = await tx.select({ id: performedProcedures.id }).from(performedProcedures).where(and(
        eq(performedProcedures.id, input.performedProcedureId), eq(performedProcedures.patientId, patientId),
        eq(performedProcedures.toothNumber, input.toothNumber),
      )).limit(1);
      if (!procedure) throw new OdontogramReferenceError("treatmentUnavailable");
    }
    const [finding] = await tx.insert(odontogramFindings).values({
      organizationId: ctx.organizationId, patientId, toothNumber: input.toothNumber,
      surfaces: input.surfaces, kind: input.kind, note: input.note, observedOn: input.observedOn,
      providerId: input.providerId, treatmentPlanItemId: input.treatmentPlanItemId,
      performedProcedureId: input.performedProcedureId, createdByUserId: ctx.userId,
    }).returning({ id: odontogramFindings.id });
    await audit(tx, {
      organizationId: ctx.organizationId, actorType: "staff", actorUserId: ctx.userId,
      action: "odontogram.finding_created", entityType: "odontogram_finding", entityId: finding!.id, patientId,
    });
    return finding!.id;
  });
}

export async function changeOdontogramFindingStatus(ctx: ClinicContext, findingId: string, input: OdontogramStatusInput) {
  requirePermission(ctx, "clinical.write");
  return tenantTx(ctx, async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${findingId}, 0))`);
    const [finding] = await tx.select().from(odontogramFindings).where(eq(odontogramFindings.id, findingId)).limit(1);
    if (!finding || finding.status !== "active") throw new OdontogramReferenceError("findingUnavailable");
    const [successor] = await tx.select({ id: odontogramFindings.id }).from(odontogramFindings)
      .where(eq(odontogramFindings.supersedesId, findingId)).limit(1);
    if (successor) throw new OdontogramReferenceError("findingUnavailable");
    const [event] = await tx.insert(odontogramFindings).values({
      organizationId: finding.organizationId, patientId: finding.patientId, toothNumber: finding.toothNumber,
      surfaces: finding.surfaces, kind: finding.kind, status: input.status, note: input.reason,
      observedOn: todayInZone(ctx.organization.timezone), providerId: finding.providerId,
      treatmentPlanItemId: finding.treatmentPlanItemId, performedProcedureId: finding.performedProcedureId,
      supersedesId: finding.id, createdByUserId: ctx.userId,
    }).returning({ id: odontogramFindings.id });
    await audit(tx, {
      organizationId: ctx.organizationId, actorType: "staff", actorUserId: ctx.userId,
      action: input.status === "resolved" ? "odontogram.finding_resolved" : "odontogram.finding_entered_in_error",
      entityType: "odontogram_finding", entityId: event!.id, patientId: finding.patientId,
    });
    return finding.patientId;
  });
}
