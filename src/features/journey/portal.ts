import "server-only";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { audit } from "@/server/audit";
import { clinicalFileComparisons, clinicalFiles, patientJourneyAccess, patientJourneyItems } from "@/server/db/schema";
import { withDbContext } from "@/server/db/tenant";
import type { PatientPortalContext } from "@/server/portal/session";
import { journeyAccessOf, planProgress } from "./server";

/**
 * Visual treatment journey (patient portal side). Every read first proves the account's active identity link to the
 * exact clinic and local patient (app_private.patient_portal_links), then queries that clinic only, filtered on that
 * patient. Content (titles, explanations, photos, plan steps) is returned only after the patient switched it on.
 */

type PortalLink = { organization_id: string; patient_id: string; organization_name: string; timezone: string };

async function portalLinks(ctx: PatientPortalContext) {
  return withDbContext({ actorType: "patient", networkPatientId: ctx.networkPatientId }, (tx) =>
    tx.execute<PortalLink>(sql`select organization_id, patient_id, organization_name, timezone from app_private.patient_portal_links()`));
}

const inClinic = <T,>(ctx: PatientPortalContext, organizationId: string, fn: Parameters<typeof withDbContext<T>>[1]) =>
  withDbContext({ organizationId, actorType: "patient", networkPatientId: ctx.networkPatientId }, fn);

async function journeyOf(ctx: PatientPortalContext, link: PortalLink) {
  return inClinic(ctx, link.organization_id, async (tx) => {
    const [items, access, progress] = await Promise.all([
      tx
        .select({
          id: patientJourneyItems.id,
          kind: patientJourneyItems.kind,
          title: patientJourneyItems.title,
          body: patientJourneyItems.body,
          eventDate: patientJourneyItems.eventDate,
        })
        .from(patientJourneyItems)
        .where(and(eq(patientJourneyItems.patientId, link.patient_id), isNull(patientJourneyItems.withdrawnAt)))
        .orderBy(desc(patientJourneyItems.eventDate), desc(patientJourneyItems.createdAt)),
      journeyAccessOf(tx, [link.patient_id]),
      planProgress(tx, link.patient_id),
    ]);
    const decision = access.get(link.patient_id)?.decision ?? null;
    const granted = decision === "granted";
    return {
      organizationId: link.organization_id,
      organizationName: link.organization_name,
      timezone: link.timezone,
      access: decision,
      /** What the clinic shared, counted without content, so the patient knows there is something to switch on. */
      sharedCount: items.length,
      plansCount: progress.length,
      items: granted ? items : [],
      progress: granted ? progress : [],
    };
  });
}

/** One entry per linked clinic that has something to show (shared items or an accepted plan). */
export async function listPortalJourneys(ctx: PatientPortalContext) {
  const links = await portalLinks(ctx);
  const all = await Promise.all(links.map((link) => journeyOf(ctx, link)));
  return all.filter((j) => j.sharedCount > 0 || j.plansCount > 0);
}

export async function getPortalJourney(ctx: PatientPortalContext, organizationId: string) {
  const link = (await portalLinks(ctx)).find((l) => l.organization_id === organizationId);
  return link ? journeyOf(ctx, link) : null;
}

/** The patient switches his journey on or off for one clinic (append-only; the latest decision applies). */
export async function setPortalJourneyAccess(ctx: PatientPortalContext, organizationId: string, decision: "granted" | "revoked") {
  const link = (await portalLinks(ctx)).find((l) => l.organization_id === organizationId);
  if (!link) return false;
  await inClinic(ctx, organizationId, async (tx) => {
    const current = (await journeyAccessOf(tx, [link.patient_id])).get(link.patient_id)?.decision ?? null;
    if (current === decision || (current === null && decision === "revoked")) return;
    await tx.insert(patientJourneyAccess).values({ organizationId, patientId: link.patient_id, decision, accountId: ctx.accountId });
    await audit(tx, {
      organizationId,
      actorType: "patient",
      action: decision === "granted" ? "patient_journey.access_granted" : "patient_journey.access_revoked",
      entityType: "patient_journey",
      entityId: link.patient_id,
      patientId: link.patient_id,
    });
  });
  return true;
}

/**
 * A photo of the patient's journey, for the portal route: only for a shared, not withdrawn item of this exact
 * patient, after the patient switched the journey on. Returns the storage key to stream (never sent to the client).
 */
export async function authorizePortalJourneyImage(ctx: PatientPortalContext, organizationId: string, itemId: string, side: "photo" | "before" | "after") {
  const link = (await portalLinks(ctx)).find((l) => l.organization_id === organizationId);
  if (!link) return null;
  return inClinic(ctx, organizationId, async (tx) => {
    if ((await journeyAccessOf(tx, [link.patient_id])).get(link.patient_id)?.decision !== "granted") return null;
    const [item] = await tx
      .select({ id: patientJourneyItems.id, kind: patientJourneyItems.kind, fileId: patientJourneyItems.clinicalFileId, comparisonId: patientJourneyItems.comparisonId })
      .from(patientJourneyItems)
      .where(and(eq(patientJourneyItems.id, itemId), eq(patientJourneyItems.patientId, link.patient_id), isNull(patientJourneyItems.withdrawnAt)))
      .limit(1);
    if (!item) return null;
    let fileId: string | null = null;
    if (item.kind === "image" && side === "photo") fileId = item.fileId;
    if (item.kind === "comparison" && side !== "photo" && item.comparisonId) {
      const [pair] = await tx.select().from(clinicalFileComparisons).where(eq(clinicalFileComparisons.id, item.comparisonId)).limit(1);
      fileId = pair ? (side === "before" ? pair.beforeFileId : pair.afterFileId) : null;
    }
    if (!fileId) return null;
    const [file] = await tx
      .select({ id: clinicalFiles.id, storageKey: clinicalFiles.storageKey, mimeType: clinicalFiles.mimeType, kind: clinicalFiles.kind })
      .from(clinicalFiles)
      .where(and(eq(clinicalFiles.id, fileId), eq(clinicalFiles.patientId, link.patient_id)))
      .limit(1);
    if (!file || file.kind !== "image") return null;
    await audit(tx, { organizationId, actorType: "patient", action: "patient_journey.file_viewed", entityType: "clinical_file", entityId: file.id, patientId: link.patient_id, metadata: { side } });
    return { storageKey: file.storageKey, mimeType: file.mimeType };
  });
}
