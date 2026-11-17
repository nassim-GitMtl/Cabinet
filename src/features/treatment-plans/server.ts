import "server-only";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { todayInZone } from "@/lib/dates";
import { audit } from "@/server/audit";
import { requirePermission, tenantTx, type ClinicContext } from "@/server/auth/context";
import {
  branches,
  encounters,
  memberships,
  patients,
  performedProcedures,
  services,
  treatmentPlanConversions,
  treatmentPlanDecisions,
  treatmentPlanItems,
  treatmentPlans,
  treatmentPlanVersions,
  type ServiceSnapshot,
} from "@/server/db/schema";
import { ConflictError } from "@/server/errors";
import type { Tx } from "@/server/db/client";
import type { TreatmentConversionInput, TreatmentDecisionInput, TreatmentPlanInput } from "./schemas";

export class TreatmentPlanReferenceError extends Error {
  constructor(public readonly code: "patientUnavailable" | "serviceUnavailable" | "planUnavailable" | "providerUnavailable" | "branchUnavailable") {
    super(code);
  }
}

export class TreatmentPlanValidationError extends Error {
  constructor(public readonly fieldErrors: Record<string, string>) {
    super("Invalid treatment plan");
  }
}

function anatomyValues(anatomy: ServiceSnapshot["anatomy"], item: TreatmentPlanInput["items"][number]) {
  const errors: Record<string, string> = {};
  if ((anatomy === "tooth" || anatomy === "surface") && !item.toothNumber) errors.items = "treatmentAnatomyRequired";
  if (anatomy === "surface" && item.surfaces.length === 0) errors.items = "treatmentAnatomyRequired";
  if (anatomy === "arch" && !item.arch) errors.items = "treatmentAnatomyRequired";
  if (anatomy === "quadrant" && !item.quadrant) errors.items = "treatmentAnatomyRequired";
  if (Object.keys(errors).length) throw new TreatmentPlanValidationError(errors);
  return {
    toothNumber: anatomy === "tooth" || anatomy === "surface" ? item.toothNumber : null,
    surfaces: anatomy === "surface" ? item.surfaces : [],
    arch: anatomy === "arch" ? item.arch : null,
    quadrant: anatomy === "quadrant" ? item.quadrant : null,
  };
}

async function snapshotInput(tx: Tx, ctx: ClinicContext, input: TreatmentPlanInput) {
  const ids = [...new Set(input.items.map((item) => item.serviceId))];
  const rows = await tx.select().from(services).where(and(inArray(services.id, ids), eq(services.isActive, true)));
  const byId = new Map(rows.map((row) => [row.id, row]));
  if (rows.length !== ids.length) throw new TreatmentPlanReferenceError("serviceUnavailable");
  let totalMinor = 0;
  const items = input.items.map((item, sortOrder) => {
    const service = byId.get(item.serviceId)!;
    if (service.currency !== ctx.organization.defaultCurrency) throw new TreatmentPlanValidationError({ items: "mixedCurrency" });
    const lineTotal = service.priceMinor * item.quantity;
    if (!Number.isSafeInteger(lineTotal) || !Number.isSafeInteger(totalMinor + lineTotal)) {
      throw new TreatmentPlanValidationError({ items: "invalidAmount" });
    }
    totalMinor += lineTotal;
    const serviceSnapshot: ServiceSnapshot = {
      code: service.code,
      name: service.name,
      pricingUnit: service.pricingUnit,
      anatomy: service.anatomy,
      taxRateBp: service.taxRateBp,
    };
    return {
      organizationId: ctx.organizationId,
      serviceId: service.id,
      serviceSnapshot,
      sortOrder,
      ...anatomyValues(service.anatomy, item),
      quantity: item.quantity,
      unitPriceMinor: service.priceMinor,
      currency: service.currency,
    };
  });
  return { items, totalMinor };
}

export async function createTreatmentPlan(ctx: ClinicContext, patientId: string, input: TreatmentPlanInput) {
  requirePermission(ctx, "treatment_plan.manage");
  requirePermission(ctx, "catalog.read");
  return tenantTx(ctx, async (tx) => {
    const [patient] = await tx.select({ id: patients.id, status: patients.status }).from(patients).where(eq(patients.id, patientId)).limit(1);
    if (!patient || patient.status === "archived" || patient.status === "deceased") throw new TreatmentPlanReferenceError("patientUnavailable");
    const snapshot = await snapshotInput(tx, ctx, input);
    const [plan] = await tx.insert(treatmentPlans).values({
      organizationId: ctx.organizationId,
      patientId,
      createdByUserId: ctx.userId,
      updatedByUserId: ctx.userId,
    }).returning({ id: treatmentPlans.id });
    const [versionRow] = await tx.insert(treatmentPlanVersions).values({
      organizationId: ctx.organizationId,
      planId: plan!.id,
      patientId,
      versionNumber: 1,
      title: input.title,
      notes: input.notes,
      currency: ctx.organization.defaultCurrency,
      totalMinor: snapshot.totalMinor,
      createdByUserId: ctx.userId,
    }).returning({ id: treatmentPlanVersions.id });
    await tx.insert(treatmentPlanItems).values(snapshot.items.map((item) => ({ ...item, versionId: versionRow!.id, patientId })));
    await audit(tx, {
      organizationId: ctx.organizationId, actorType: "staff", actorUserId: ctx.userId,
      action: "treatment_plan.created", entityType: "treatment_plan", entityId: plan!.id, patientId,
      metadata: { version: 1, itemCount: snapshot.items.length },
    });
    return plan!.id;
  });
}

export async function reviseTreatmentPlan(ctx: ClinicContext, planId: string, expectedVersion: number, input: TreatmentPlanInput) {
  requirePermission(ctx, "treatment_plan.manage");
  requirePermission(ctx, "catalog.read");
  return tenantTx(ctx, async (tx) => {
    const [plan] = await tx.select().from(treatmentPlans).where(eq(treatmentPlans.id, planId)).for("update").limit(1);
    if (!plan || plan.status === "completed" || plan.status === "cancelled") throw new TreatmentPlanReferenceError("planUnavailable");
    if (plan.version !== expectedVersion) throw new ConflictError();
    const snapshot = await snapshotInput(tx, ctx, input);
    const nextVersion = plan.currentVersion + 1;
    const [versionRow] = await tx.insert(treatmentPlanVersions).values({
      organizationId: ctx.organizationId, planId, patientId: plan.patientId, versionNumber: nextVersion,
      title: input.title, notes: input.notes, currency: ctx.organization.defaultCurrency,
      totalMinor: snapshot.totalMinor, createdByUserId: ctx.userId,
    }).returning({ id: treatmentPlanVersions.id });
    await tx.insert(treatmentPlanItems).values(snapshot.items.map((item) => ({ ...item, versionId: versionRow!.id, patientId: plan.patientId })));
    const [updated] = await tx.update(treatmentPlans).set({
      status: "draft", currentVersion: nextVersion, updatedByUserId: ctx.userId, updatedAt: new Date(), version: sql`${treatmentPlans.version} + 1`,
    }).where(and(eq(treatmentPlans.id, planId), eq(treatmentPlans.version, expectedVersion))).returning({ version: treatmentPlans.version });
    if (!updated) throw new ConflictError();
    await audit(tx, {
      organizationId: ctx.organizationId, actorType: "staff", actorUserId: ctx.userId,
      action: "treatment_plan.revised", entityType: "treatment_plan", entityId: planId, patientId: plan.patientId,
      metadata: { version: nextVersion, itemCount: snapshot.items.length },
    });
    return plan.patientId;
  });
}

export async function proposeTreatmentPlan(ctx: ClinicContext, planId: string, expectedVersion: number) {
  requirePermission(ctx, "treatment_plan.manage");
  return tenantTx(ctx, async (tx) => {
    const [updated] = await tx.update(treatmentPlans).set({
      status: "proposed", updatedByUserId: ctx.userId, updatedAt: new Date(), version: sql`${treatmentPlans.version} + 1`,
    }).where(and(eq(treatmentPlans.id, planId), eq(treatmentPlans.status, "draft"), eq(treatmentPlans.version, expectedVersion))).returning({ patientId: treatmentPlans.patientId, currentVersion: treatmentPlans.currentVersion });
    if (!updated) throw new ConflictError();
    await audit(tx, {
      organizationId: ctx.organizationId, actorType: "staff", actorUserId: ctx.userId,
      action: "treatment_plan.proposed", entityType: "treatment_plan", entityId: planId, patientId: updated.patientId,
      metadata: { version: updated.currentVersion },
    });
    return updated.patientId;
  });
}

export async function decideTreatmentPlan(ctx: ClinicContext, planId: string, input: TreatmentDecisionInput) {
  requirePermission(ctx, "treatment_plan.accept");
  return tenantTx(ctx, async (tx) => {
    const [plan] = await tx.select().from(treatmentPlans).where(eq(treatmentPlans.id, planId)).for("update").limit(1);
    if (!plan) throw new TreatmentPlanReferenceError("planUnavailable");
    if (plan.status !== "proposed" || plan.version !== input.expectedVersion) throw new ConflictError();
    const [versionRow] = await tx.select({ id: treatmentPlanVersions.id }).from(treatmentPlanVersions)
      .where(and(eq(treatmentPlanVersions.planId, planId), eq(treatmentPlanVersions.versionNumber, plan.currentVersion))).limit(1);
    if (!versionRow) throw new TreatmentPlanReferenceError("planUnavailable");
    await tx.insert(treatmentPlanDecisions).values({
      organizationId: ctx.organizationId, planId, versionId: versionRow.id, patientId: plan.patientId,
      decision: input.decision, method: input.method, note: input.note, decidedAt: new Date(), recordedByUserId: ctx.userId,
    });
    await tx.update(treatmentPlans).set({
      status: input.decision, updatedByUserId: ctx.userId, updatedAt: new Date(), version: sql`${treatmentPlans.version} + 1`,
    }).where(eq(treatmentPlans.id, planId));
    await audit(tx, {
      organizationId: ctx.organizationId, actorType: "staff", actorUserId: ctx.userId,
      action: `treatment_plan.${input.decision}`, entityType: "treatment_plan", entityId: planId, patientId: plan.patientId,
      metadata: { version: plan.currentVersion, method: input.method },
    });
    return plan.patientId;
  });
}

export async function listTreatmentPlans(ctx: ClinicContext, patientId: string) {
  requirePermission(ctx, "treatment_plan.read");
  return tenantTx(ctx, (tx) => tx.select({
    id: treatmentPlans.id, status: treatmentPlans.status, currentVersion: treatmentPlans.currentVersion,
    version: treatmentPlans.version, updatedAt: treatmentPlans.updatedAt,
    title: treatmentPlanVersions.title, totalMinor: treatmentPlanVersions.totalMinor, currency: treatmentPlanVersions.currency,
  }).from(treatmentPlans).innerJoin(treatmentPlanVersions, and(
    eq(treatmentPlanVersions.planId, treatmentPlans.id),
    eq(treatmentPlanVersions.versionNumber, treatmentPlans.currentVersion),
  )).where(eq(treatmentPlans.patientId, patientId)).orderBy(desc(treatmentPlans.updatedAt)));
}

export async function getTreatmentPlan(ctx: ClinicContext, planId: string) {
  requirePermission(ctx, "treatment_plan.read");
  return tenantTx(ctx, async (tx) => {
    const [header] = await tx.select({
      id: treatmentPlans.id, patientId: treatmentPlans.patientId, status: treatmentPlans.status,
      currentVersion: treatmentPlans.currentVersion, version: treatmentPlans.version,
      updatedAt: treatmentPlans.updatedAt, versionId: treatmentPlanVersions.id, title: treatmentPlanVersions.title,
      notes: treatmentPlanVersions.notes, currency: treatmentPlanVersions.currency, totalMinor: treatmentPlanVersions.totalMinor,
      createdAt: treatmentPlanVersions.createdAt,
    }).from(treatmentPlans).innerJoin(treatmentPlanVersions, and(
      eq(treatmentPlanVersions.planId, treatmentPlans.id), eq(treatmentPlanVersions.versionNumber, treatmentPlans.currentVersion),
    )).where(eq(treatmentPlans.id, planId)).limit(1);
    if (!header) return null;
    const [items, decision, history] = await Promise.all([
      tx.select({
        id: treatmentPlanItems.id, serviceId: treatmentPlanItems.serviceId, serviceSnapshot: treatmentPlanItems.serviceSnapshot,
        sortOrder: treatmentPlanItems.sortOrder, toothNumber: treatmentPlanItems.toothNumber, surfaces: treatmentPlanItems.surfaces,
        arch: treatmentPlanItems.arch, quadrant: treatmentPlanItems.quadrant, quantity: treatmentPlanItems.quantity,
        unitPriceMinor: treatmentPlanItems.unitPriceMinor, currency: treatmentPlanItems.currency,
        performedProcedureId: treatmentPlanConversions.performedProcedureId,
      }).from(treatmentPlanItems).leftJoin(treatmentPlanConversions, eq(treatmentPlanConversions.itemId, treatmentPlanItems.id))
        .where(eq(treatmentPlanItems.versionId, header.versionId)).orderBy(asc(treatmentPlanItems.sortOrder)),
      tx.select().from(treatmentPlanDecisions).where(eq(treatmentPlanDecisions.versionId, header.versionId)).limit(1),
      tx.select({ versionNumber: treatmentPlanVersions.versionNumber, title: treatmentPlanVersions.title, totalMinor: treatmentPlanVersions.totalMinor,
        currency: treatmentPlanVersions.currency, createdAt: treatmentPlanVersions.createdAt, decision: treatmentPlanDecisions.decision,
      }).from(treatmentPlanVersions).leftJoin(treatmentPlanDecisions, eq(treatmentPlanDecisions.versionId, treatmentPlanVersions.id))
        .where(eq(treatmentPlanVersions.planId, planId)).orderBy(desc(treatmentPlanVersions.versionNumber)),
    ]);
    return { ...header, items, decision: decision[0] ?? null, history };
  });
}

export async function convertTreatmentPlanItem(ctx: ClinicContext, planId: string, itemId: string, input: TreatmentConversionInput) {
  requirePermission(ctx, "treatment_plan.convert");
  requirePermission(ctx, "clinical.write");
  if (input.serviceDate > todayInZone(ctx.organization.timezone)) throw new TreatmentPlanValidationError({ serviceDate: "futureDate" });
  return tenantTx(ctx, async (tx) => {
    const [plan] = await tx.select().from(treatmentPlans).where(eq(treatmentPlans.id, planId)).for("update").limit(1);
    if (!plan || plan.status !== "accepted" || plan.version !== input.expectedVersion) throw new ConflictError();
    const [[item], [provider], [branch]] = await Promise.all([
      tx.select({ item: treatmentPlanItems, versionNumber: treatmentPlanVersions.versionNumber }).from(treatmentPlanItems)
        .innerJoin(treatmentPlanVersions, eq(treatmentPlanVersions.id, treatmentPlanItems.versionId))
        .where(and(eq(treatmentPlanItems.id, itemId), eq(treatmentPlanVersions.planId, planId), eq(treatmentPlanVersions.versionNumber, plan.currentVersion))).limit(1),
      tx.select({ id: memberships.id }).from(memberships).where(and(eq(memberships.id, input.performingProviderId), eq(memberships.status, "active"), eq(memberships.isProvider, true))).limit(1),
      tx.select({ id: branches.id }).from(branches).where(and(eq(branches.id, input.branchId), eq(branches.isActive, true))).limit(1),
    ]);
    if (!item) throw new TreatmentPlanReferenceError("planUnavailable");
    if (!provider) throw new TreatmentPlanReferenceError("providerUnavailable");
    if (!branch) throw new TreatmentPlanReferenceError("branchUnavailable");
    const existing = await tx.select({ id: treatmentPlanConversions.id }).from(treatmentPlanConversions).where(eq(treatmentPlanConversions.itemId, itemId)).limit(1);
    if (existing.length) throw new ConflictError();
    const now = new Date();
    const [encounter] = await tx.insert(encounters).values({
      organizationId: ctx.organizationId, patientId: plan.patientId, branchId: input.branchId,
      primaryProviderId: input.performingProviderId, serviceDate: input.serviceDate, status: "completed", completedAt: now, createdByUserId: ctx.userId,
    }).returning({ id: encounters.id });
    const [procedure] = await tx.insert(performedProcedures).values({
      organizationId: ctx.organizationId, encounterId: encounter!.id, patientId: plan.patientId,
      serviceId: item.item.serviceId, serviceSnapshot: item.item.serviceSnapshot, toothNumber: item.item.toothNumber,
      surfaces: item.item.surfaces, arch: item.item.arch, quadrant: item.item.quadrant, quantity: item.item.quantity,
      unitPriceMinor: item.item.unitPriceMinor, currency: item.item.currency, performingProviderId: input.performingProviderId,
      serviceDate: input.serviceDate, status: "completed", createdByUserId: ctx.userId,
    }).returning({ id: performedProcedures.id });
    await tx.insert(treatmentPlanConversions).values({
      organizationId: ctx.organizationId, planId, versionId: item.item.versionId, itemId, patientId: plan.patientId,
      performedProcedureId: procedure!.id, convertedByUserId: ctx.userId,
    });
    const [{ remaining }] = await tx.select({ remaining: sql<number>`count(*) filter (where ${treatmentPlanConversions.id} is null)::int` })
      .from(treatmentPlanItems).leftJoin(treatmentPlanConversions, eq(treatmentPlanConversions.itemId, treatmentPlanItems.id))
      .innerJoin(treatmentPlanVersions, eq(treatmentPlanVersions.id, treatmentPlanItems.versionId))
      .where(and(eq(treatmentPlanVersions.planId, planId), eq(treatmentPlanVersions.versionNumber, plan.currentVersion)));
    if (remaining === 0) await tx.update(treatmentPlans).set({ status: "completed", updatedAt: now, updatedByUserId: ctx.userId, version: sql`${treatmentPlans.version} + 1` }).where(eq(treatmentPlans.id, planId));
    await audit(tx, {
      organizationId: ctx.organizationId, actorType: "staff", actorUserId: ctx.userId,
      action: "treatment_plan.item_converted", entityType: "treatment_plan", entityId: planId, patientId: plan.patientId,
      metadata: { version: plan.currentVersion, itemId, performedProcedureId: procedure!.id },
    });
    return { patientId: plan.patientId, procedureId: procedure!.id };
  });
}
