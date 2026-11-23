import "server-only";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { audit } from "@/server/audit";
import { can, requirePermission, tenantTx, type ClinicContext } from "@/server/auth/context";
import type { Tx } from "@/server/db/client";
import {
  clinicalFileComparisons,
  clinicalFiles,
  patientJourneyAccess,
  patientJourneyItems,
  patients,
  treatmentPlanConversions,
  treatmentPlanItems,
  treatmentPlans,
  treatmentPlanVersions,
  users,
} from "@/server/db/schema";
import { addDays, parseDateOnly, todayInZone } from "@/lib/dates";

/**
 * Visual treatment journey (clinic side). A clinician chooses what the patient sees in the portal: photos,
 * before/after pairs and treatment steps, each with a plain-language explanation. Nothing reaches the portal until
 * the patient switches the journey on there (patient_journey_access, append-only, latest decision applies).
 */

export type JourneyErrorCode = "patientUnavailable" | "fileUnavailable" | "comparisonUnavailable" | "planUnavailable" | "itemUnavailable" | "invalidText" | "invalidDate" | "reasonRequired";
export class JourneyError extends Error {
  constructor(public readonly code: JourneyErrorCode) {
    super(code);
  }
}

const staff = (ctx: ClinicContext) => ({ organizationId: ctx.organizationId, actorType: "staff" as const, actorUserId: ctx.userId });

function cleanText(title: string, body: string | null | undefined) {
  const t = title.trim();
  const b = body?.trim() || null;
  if (t.length < 1 || t.length > 160 || (b && b.length > 2000)) throw new JourneyError("invalidText");
  return { title: t, body: b };
}

async function requirePatient(tx: Tx, patientId: string) {
  const [p] = await tx.select({ id: patients.id, status: patients.status }).from(patients).where(eq(patients.id, patientId)).limit(1);
  if (!p) throw new JourneyError("patientUnavailable");
  return p;
}

/** Latest portal decision of each patient (granted / revoked / never decided). */
export async function journeyAccessOf(tx: Tx, patientIds: string[]) {
  if (!patientIds.length) return new Map<string, { decision: "granted" | "revoked"; decidedAt: Date }>();
  const rows = await tx
    .select({ patientId: patientJourneyAccess.patientId, decision: patientJourneyAccess.decision, decidedAt: patientJourneyAccess.decidedAt })
    .from(patientJourneyAccess)
    .where(inArray(patientJourneyAccess.patientId, patientIds))
    .orderBy(asc(patientJourneyAccess.decidedAt), asc(patientJourneyAccess.id));
  const latest = new Map<string, { decision: "granted" | "revoked"; decidedAt: Date }>();
  for (const r of rows) latest.set(r.patientId, { decision: r.decision, decidedAt: r.decidedAt });
  return latest;
}

/** Progress of the patient's accepted plans, from the plan items and the acts recorded from them (facts only). */
export async function planProgress(tx: Tx, patientId: string) {
  const plans = await tx
    .select({ id: treatmentPlans.id, status: treatmentPlans.status, versionId: treatmentPlanVersions.id, title: treatmentPlanVersions.title })
    .from(treatmentPlans)
    .innerJoin(treatmentPlanVersions, and(eq(treatmentPlanVersions.planId, treatmentPlans.id), eq(treatmentPlanVersions.versionNumber, treatmentPlans.currentVersion)))
    .where(and(eq(treatmentPlans.patientId, patientId), inArray(treatmentPlans.status, ["accepted", "completed"])))
    .orderBy(desc(treatmentPlans.updatedAt));
  if (!plans.length) return [];
  const versionIds = plans.map((p) => p.versionId);
  const [items, done] = await Promise.all([
    tx
      .select({ id: treatmentPlanItems.id, versionId: treatmentPlanItems.versionId, serviceSnapshot: treatmentPlanItems.serviceSnapshot, toothNumber: treatmentPlanItems.toothNumber, sortOrder: treatmentPlanItems.sortOrder })
      .from(treatmentPlanItems)
      .where(inArray(treatmentPlanItems.versionId, versionIds))
      .orderBy(asc(treatmentPlanItems.sortOrder)),
    tx
      .select({ itemId: treatmentPlanConversions.itemId, createdAt: treatmentPlanConversions.createdAt })
      .from(treatmentPlanConversions)
      .where(inArray(treatmentPlanConversions.versionId, versionIds)),
  ]);
  return plans.map((p) => ({
    id: p.id,
    title: p.title,
    status: p.status,
    steps: items
      .filter((i) => i.versionId === p.versionId)
      .map((i) => {
        const conversion = done.find((d) => d.itemId === i.id);
        return { id: i.id, name: i.serviceSnapshot.name, code: i.serviceSnapshot.code, toothNumber: i.toothNumber, doneAt: conversion?.createdAt ?? null };
      }),
  }));
}

export async function getPatientJourney(ctx: ClinicContext, patientId: string) {
  requirePermission(ctx, "patient.journey.manage");
  return tenantTx(ctx, async (tx) => {
    await requirePatient(tx, patientId);
    const [items, access, progress, images, comparisons, plans] = await Promise.all([
      tx
        .select({ item: patientJourneyItems, sharedBy: users.fullName })
        .from(patientJourneyItems)
        .innerJoin(users, eq(users.id, patientJourneyItems.sharedByUserId))
        .where(eq(patientJourneyItems.patientId, patientId))
        .orderBy(desc(patientJourneyItems.eventDate), desc(patientJourneyItems.createdAt)),
      journeyAccessOf(tx, [patientId]),
      planProgress(tx, patientId),
      can(ctx, "clinical.images.read")
        ? tx
            .select({ id: clinicalFiles.id, title: clinicalFiles.title, clinicalDate: clinicalFiles.clinicalDate, category: clinicalFiles.category, toothNumbers: clinicalFiles.toothNumbers })
            .from(clinicalFiles)
            .where(and(eq(clinicalFiles.patientId, patientId), eq(clinicalFiles.kind, "image")))
            .orderBy(desc(clinicalFiles.clinicalDate))
        : Promise.resolve([]),
      can(ctx, "clinical.images.read")
        ? tx.select().from(clinicalFileComparisons).where(eq(clinicalFileComparisons.patientId, patientId)).orderBy(desc(clinicalFileComparisons.createdAt))
        : Promise.resolve([]),
      tx
        .select({ id: treatmentPlans.id, status: treatmentPlans.status, title: treatmentPlanVersions.title })
        .from(treatmentPlans)
        .innerJoin(treatmentPlanVersions, and(eq(treatmentPlanVersions.planId, treatmentPlans.id), eq(treatmentPlanVersions.versionNumber, treatmentPlans.currentVersion)))
        .where(eq(treatmentPlans.patientId, patientId))
        .orderBy(desc(treatmentPlans.updatedAt)),
    ]);
    return {
      access: access.get(patientId) ?? null,
      items: items.map((r) => ({ ...r.item, sharedBy: r.sharedBy })),
      progress,
      images,
      comparisons,
      plans,
    };
  });
}

async function share(
  ctx: ClinicContext,
  patientId: string,
  values: { kind: "milestone" | "image" | "comparison"; clinicalFileId?: string | null; comparisonId?: string | null; treatmentPlanId?: string | null; title: string; body?: string | null; eventDate: string },
) {
  requirePermission(ctx, "patient.journey.manage");
  if (values.kind !== "milestone") requirePermission(ctx, "clinical.images.read");
  const text = cleanText(values.title, values.body);
  const eventDate = parseDateOnly(values.eventDate);
  const today = todayInZone(ctx.organization.timezone);
  // Steps may announce what is planned (up to a year ahead); photos are of the past.
  if (!eventDate || eventDate > addDays(today, values.kind === "milestone" ? 366 : 0) || eventDate < "1990-01-01") throw new JourneyError("invalidDate");
  return tenantTx(ctx, async (tx) => {
    await requirePatient(tx, patientId);
    if (values.clinicalFileId) {
      const [f] = await tx.select({ id: clinicalFiles.id }).from(clinicalFiles)
        .where(and(eq(clinicalFiles.id, values.clinicalFileId), eq(clinicalFiles.patientId, patientId), eq(clinicalFiles.kind, "image"))).limit(1);
      if (!f) throw new JourneyError("fileUnavailable");
    }
    if (values.comparisonId) {
      const [c] = await tx.select({ id: clinicalFileComparisons.id }).from(clinicalFileComparisons)
        .where(and(eq(clinicalFileComparisons.id, values.comparisonId), eq(clinicalFileComparisons.patientId, patientId))).limit(1);
      if (!c) throw new JourneyError("comparisonUnavailable");
    }
    if (values.treatmentPlanId) {
      const [p] = await tx.select({ id: treatmentPlans.id }).from(treatmentPlans)
        .where(and(eq(treatmentPlans.id, values.treatmentPlanId), eq(treatmentPlans.patientId, patientId))).limit(1);
      if (!p) throw new JourneyError("planUnavailable");
    }
    const [row] = await tx
      .insert(patientJourneyItems)
      .values({
        organizationId: ctx.organizationId,
        patientId,
        kind: values.kind,
        clinicalFileId: values.clinicalFileId ?? null,
        comparisonId: values.comparisonId ?? null,
        treatmentPlanId: values.treatmentPlanId ?? null,
        ...text,
        eventDate,
        sharedByUserId: ctx.userId,
      })
      .returning({ id: patientJourneyItems.id });
    await audit(tx, { ...staff(ctx), action: "patient_journey.item_shared", entityType: "patient_journey_item", entityId: row!.id, patientId, metadata: { kind: values.kind } });
    return row!.id;
  });
}

export const shareJourneyImage = (ctx: ClinicContext, patientId: string, input: { clinicalFileId: string; title: string; body?: string | null; eventDate: string }) =>
  share(ctx, patientId, { kind: "image", ...input });
export const shareJourneyComparison = (ctx: ClinicContext, patientId: string, input: { comparisonId: string; title: string; body?: string | null; eventDate: string }) =>
  share(ctx, patientId, { kind: "comparison", ...input });
export const addJourneyMilestone = (ctx: ClinicContext, patientId: string, input: { title: string; body?: string | null; eventDate: string; treatmentPlanId?: string | null }) =>
  share(ctx, patientId, { kind: "milestone", ...input });

/** Takes an item off the patient's journey (kept in the record with who and why). */
export async function withdrawJourneyItem(ctx: ClinicContext, itemId: string, reason: string) {
  requirePermission(ctx, "patient.journey.manage");
  if (!reason.trim()) throw new JourneyError("reasonRequired");
  return tenantTx(ctx, async (tx) => {
    const [row] = await tx
      .update(patientJourneyItems)
      .set({ withdrawnAt: new Date(), withdrawnByUserId: ctx.userId, withdrawReason: reason.trim().slice(0, 300) })
      .where(and(eq(patientJourneyItems.id, itemId), isNull(patientJourneyItems.withdrawnAt)))
      .returning({ id: patientJourneyItems.id, patientId: patientJourneyItems.patientId });
    if (!row) throw new JourneyError("itemUnavailable");
    await audit(tx, { ...staff(ctx), action: "patient_journey.item_withdrawn", entityType: "patient_journey_item", entityId: row.id, patientId: row.patientId });
  });
}
