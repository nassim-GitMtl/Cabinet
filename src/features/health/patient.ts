import "server-only";

import { createHash } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { audit } from "@/server/audit";
import { db } from "@/server/db/client";
import { questionnaireResponses, questionnaireTabletSessions, questionnaireVersions, type Answers, type Question } from "@/server/db/schema";
import { withDbContext } from "@/server/db/tenant";
import type { PatientPortalContext } from "@/server/portal/session";
import { HealthError, normalizeAnswers } from "./server";

const KEY = "medical_history";
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

type PortalLink = { organization_id: string; patient_id: string; organization_name: string; timezone: string; currency_display: string };

async function portalLinks(ctx: PatientPortalContext) {
  return withDbContext({ actorType: "patient", networkPatientId: ctx.networkPatientId }, (tx) => tx.execute<PortalLink>(sql`select * from app_private.patient_portal_links()`));
}

async function exactPortalLink(ctx: PatientPortalContext, organizationId: string) {
  return (await portalLinks(ctx)).find((link) => link.organization_id === organizationId) ?? null;
}

export async function listPortalHealthQuestionnaires(ctx: PatientPortalContext) {
  const links = await portalLinks(ctx);
  return Promise.all(links.map(async (link) => withDbContext({ organizationId: link.organization_id, actorType: "patient", networkPatientId: ctx.networkPatientId }, async (tx) => {
    const [version] = await tx.select().from(questionnaireVersions).where(and(eq(questionnaireVersions.key, KEY), eq(questionnaireVersions.isCurrent, true))).limit(1);
    if (!version?.approvedAt) return null;
    const [latest] = await tx.select({ recordedAt: questionnaireResponses.recordedAt }).from(questionnaireResponses).where(eq(questionnaireResponses.patientId, link.patient_id)).orderBy(desc(questionnaireResponses.recordedAt)).limit(1);
    return { organizationId: link.organization_id, organizationName: link.organization_name, title: version.title, latestAt: latest?.recordedAt ?? null };
  }))).then((rows) => rows.filter((row): row is NonNullable<typeof row> => !!row));
}

export async function getPortalHealthQuestionnaire(ctx: PatientPortalContext, organizationId: string) {
  const link = await exactPortalLink(ctx, organizationId); if (!link) return null;
  return withDbContext({ organizationId, actorType: "patient", networkPatientId: ctx.networkPatientId }, async (tx) => {
    const [version] = await tx.select().from(questionnaireVersions).where(and(eq(questionnaireVersions.key, KEY), eq(questionnaireVersions.isCurrent, true))).limit(1);
    if (!version?.approvedAt) return null;
    const [latest] = await tx.select({ answers: questionnaireResponses.answers }).from(questionnaireResponses).where(eq(questionnaireResponses.patientId, link.patient_id)).orderBy(desc(questionnaireResponses.recordedAt)).limit(1);
    return { organizationId, organizationName: link.organization_name, patientId: link.patient_id, version, previous: latest?.answers ?? {} };
  });
}

export async function recordPortalHealthResponse(ctx: PatientPortalContext, organizationId: string, raw: Answers) {
  const link = await exactPortalLink(ctx, organizationId); if (!link) throw new HealthError("notFound");
  return withDbContext({ organizationId, actorType: "patient", networkPatientId: ctx.networkPatientId }, async (tx) => {
    const [version] = await tx.select().from(questionnaireVersions).where(and(eq(questionnaireVersions.key, KEY), eq(questionnaireVersions.isCurrent, true))).limit(1);
    if (!version?.approvedAt) throw new HealthError("questionnaireNotApproved");
    const answers = normalizeAnswers(version.questions, raw); if (!Object.keys(answers).length) throw new HealthError("empty");
    const [response] = await tx.insert(questionnaireResponses).values({ organizationId, patientId: link.patient_id, questionnaireVersionId: version.id, answers, source: "patient_portal", recordedByUserId: null, patientAcknowledged: true }).returning({ id: questionnaireResponses.id });
    await audit(tx, { organizationId, actorType: "patient", action: "health_history.portal_recorded", entityType: "questionnaire_response", entityId: response!.id, patientId: link.patient_id, metadata: { answered: Object.keys(answers).length, questionnaireVersionId: version.id } });
    return response!.id;
  });
}

export type TabletQuestionnaire = {
  organizationId: string; patientId: string; questionnaireVersionId: string; patientNumber: string;
  firstName: string; lastName: string; title: Record<string, string>; questions: Question[]; expiresAt: Date;
};

export async function getTabletQuestionnaire(token: string): Promise<TabletQuestionnaire | null> {
  if (!/^[A-Za-z0-9_-]{40,100}$/.test(token)) return null;
  const rows = await db.execute<{
    organization_id: string; patient_id: string; questionnaire_version_id: string; patient_number: string;
    first_name: string; last_name: string; title: Record<string, string>; questions: Question[]; expires_at: Date;
  }>(sql`select * from app_private.questionnaire_tablet_lookup(${hash(token)})`);
  const row = rows[0];
  return row ? { organizationId: row.organization_id, patientId: row.patient_id, questionnaireVersionId: row.questionnaire_version_id, patientNumber: row.patient_number, firstName: row.first_name, lastName: row.last_name, title: row.title, questions: row.questions, expiresAt: row.expires_at } : null;
}

export async function recordTabletHealthResponse(token: string, raw: Answers) {
  const info = await getTabletQuestionnaire(token); if (!info) throw new HealthError("tabletExpired");
  return withDbContext({ organizationId: info.organizationId, actorType: "system" }, async (tx) => {
    const [session] = await tx.select().from(questionnaireTabletSessions).where(and(eq(questionnaireTabletSessions.tokenHash, hash(token)), eq(questionnaireTabletSessions.patientId, info.patientId))).for("update").limit(1);
    if (!session || session.usedAt || session.expiresAt <= new Date()) throw new HealthError("tabletExpired");
    const [version] = await tx.select().from(questionnaireVersions).where(and(eq(questionnaireVersions.id, session.questionnaireVersionId), eq(questionnaireVersions.isCurrent, true))).limit(1);
    if (!version?.approvedAt) throw new HealthError("questionnaireNotApproved");
    const answers = normalizeAnswers(version.questions, raw); if (!Object.keys(answers).length) throw new HealthError("empty");
    const [response] = await tx.insert(questionnaireResponses).values({ organizationId: info.organizationId, patientId: info.patientId, questionnaireVersionId: version.id, answers, source: "patient_tablet", recordedByUserId: null, patientAcknowledged: true }).returning({ id: questionnaireResponses.id });
    await tx.update(questionnaireTabletSessions).set({ usedAt: new Date() }).where(eq(questionnaireTabletSessions.id, session.id));
    await audit(tx, { organizationId: info.organizationId, actorType: "system", action: "health_history.tablet_recorded", entityType: "questionnaire_response", entityId: response!.id, patientId: info.patientId, metadata: { answered: Object.keys(answers).length, questionnaireVersionId: version.id } });
    return response!.id;
  });
}
