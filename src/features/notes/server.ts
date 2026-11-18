import "server-only";
import { createHash } from "node:crypto";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { audit } from "@/server/audit";
import { can, requirePermission, tenantTx, type ClinicContext } from "@/server/auth/context";
import type { Tx } from "@/server/db/client";
import { clinicalNotes, clinicalNoteVersions, memberships, noteTemplates, patients, users, type NoteBody } from "@/server/db/schema";
import { todayInZone } from "@/lib/dates";

export class NoteError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}

export const NOTE_KINDS = ["consultation", "progress", "procedure", "post_op", "referral", "other"] as const;
export type NoteKind = (typeof NOTE_KINDS)[number];
const SECTIONS = ["chiefComplaint", "observations", "assessment", "plan", "performedWork"] as const;
const FDI = /^(1[1-8]|2[1-8]|3[1-8]|4[1-8]|5[1-5]|6[1-5]|7[1-5]|8[1-5])$/;

export function emptyBody(): NoteBody {
  return { chiefComplaint: "", observations: "", assessment: "", plan: "", performedWork: "", teeth: [] };
}

/** Normalizes user input: trims sections (max 8 000 chars) and keeps valid FDI teeth only. */
export function normalizeBody(input: Partial<NoteBody>): NoteBody {
  const body = emptyBody();
  for (const k of SECTIONS) body[k] = String(input[k] ?? "").slice(0, 8000);
  body.teeth = [...new Set((input.teeth ?? []).map((x) => String(x).trim()).filter((x) => FDI.test(x)))].sort();
  return body;
}

const isEmpty = (b: NoteBody) => SECTIONS.every((k) => !b[k].trim());

/**
 * Tamper-evident chain: each signed version hashes its content together with
 * the previous version's hash. Any later edit of stored text breaks the chain.
 */
export function versionHash(v: { noteId: string; versionNo: number; kind: string; body: NoteBody; amendmentReason: string | null; signedByUserId: string; signedAt: string; prevHash: string | null }) {
  const canonical = JSON.stringify([v.noteId, v.versionNo, v.kind, normalizeBody(v.body), v.amendmentReason, v.signedByUserId, v.signedAt, v.prevHash]);
  return createHash("sha256").update(canonical).digest("hex");
}

const staff = (ctx: ClinicContext) => ({ organizationId: ctx.organizationId, actorType: "staff" as const, actorUserId: ctx.userId });

export async function listNoteTemplates(ctx: ClinicContext) {
  requirePermission(ctx, "clinical.read");
  return tenantTx(ctx, (tx) => tx.select().from(noteTemplates).where(eq(noteTemplates.isActive, true)).orderBy(asc(noteTemplates.name)));
}

export async function listNotes(ctx: ClinicContext, patientId: string) {
  requirePermission(ctx, "clinical.read");
  return tenantTx(ctx, (tx) =>
    tx
      .select({
        id: clinicalNotes.id,
        kind: clinicalNotes.kind,
        status: clinicalNotes.status,
        serviceDate: clinicalNotes.serviceDate,
        currentVersion: clinicalNotes.currentVersion,
        templateName: clinicalNotes.templateName,
        providerName: memberships.displayName,
        providerTitle: memberships.title,
        signedAt: clinicalNotes.signedAt,
        updatedAt: clinicalNotes.updatedAt,
      })
      .from(clinicalNotes)
      .innerJoin(memberships, eq(memberships.id, clinicalNotes.providerId))
      .where(and(eq(clinicalNotes.patientId, patientId), sql`${clinicalNotes.status} <> 'discarded'`))
      .orderBy(desc(clinicalNotes.serviceDate), desc(clinicalNotes.createdAt)),
  );
}

export async function getNote(ctx: ClinicContext, id: string) {
  requirePermission(ctx, "clinical.read");
  return tenantTx(ctx, async (tx) => {
    const [row] = await tx
      .select({ note: clinicalNotes, providerName: memberships.displayName, providerTitle: memberships.title, patientFirst: patients.firstName, patientLast: patients.lastName, patientNumber: patients.patientNumber })
      .from(clinicalNotes)
      .innerJoin(memberships, eq(memberships.id, clinicalNotes.providerId))
      .innerJoin(patients, eq(patients.id, clinicalNotes.patientId))
      .where(eq(clinicalNotes.id, id));
    if (!row) return null;
    const versions = await tx
      .select({ v: clinicalNoteVersions, signerName: users.fullName })
      .from(clinicalNoteVersions)
      .innerJoin(users, eq(users.id, clinicalNoteVersions.signedByUserId))
      .where(eq(clinicalNoteVersions.noteId, id))
      .orderBy(asc(clinicalNoteVersions.versionNo));
    const [author] = await tx.select({ name: users.fullName }).from(users).where(eq(users.id, row.note.authorUserId));
    await audit(tx, { ...staff(ctx), action: "clinical_note.viewed", entityType: "clinical_note", entityId: id, patientId: row.note.patientId });
    return { ...row, authorName: author?.name ?? "", versions, chainValid: verifyChain(versions.map((x) => x.v)) };
  });
}

export function verifyChain(versions: { noteId: string; versionNo: number; kind: string; body: NoteBody; amendmentReason: string | null; signedByUserId: string; signedAt: Date; prevHash: string | null; contentHash: string }[]) {
  let prev: string | null = null;
  for (const v of versions) {
    if (v.prevHash !== prev) return false;
    const h = versionHash({ ...v, signedAt: v.signedAt.toISOString() });
    if (h !== v.contentHash) return false;
    prev = v.contentHash;
  }
  return true;
}

export async function createNote(
  ctx: ClinicContext,
  patientId: string,
  input: { kind: NoteKind; serviceDate: string; providerId: string; templateId: string | null; encounterId?: string | null },
) {
  requirePermission(ctx, "clinical.write");
  if (input.serviceDate > todayInZone(ctx.organization.timezone)) throw new NoteError("futureDate");
  return tenantTx(ctx, async (tx) => {
    const [patient] = await tx.select({ id: patients.id }).from(patients).where(eq(patients.id, patientId));
    if (!patient) throw new NoteError("notFound");
    const [provider] = await tx.select({ id: memberships.id }).from(memberships).where(and(eq(memberships.id, input.providerId), eq(memberships.isProvider, true), eq(memberships.status, "active")));
    if (!provider) throw new NoteError("providerUnavailable");
    const [template] = input.templateId ? await tx.select().from(noteTemplates).where(eq(noteTemplates.id, input.templateId)) : [];
    const [note] = await tx
      .insert(clinicalNotes)
      .values({
        organizationId: ctx.organizationId,
        patientId,
        encounterId: input.encounterId ?? null,
        kind: input.kind,
        serviceDate: input.serviceDate,
        providerId: input.providerId,
        draftBody: normalizeBody(template?.body ?? {}),
        templateId: template?.id ?? null,
        templateName: template?.name ?? null,
        authorUserId: ctx.userId,
      })
      .returning({ id: clinicalNotes.id });
    await audit(tx, { ...staff(ctx), action: "clinical_note.created", entityType: "clinical_note", entityId: note!.id, patientId, metadata: { template: template?.name ?? null } });
    return note!.id;
  });
}

async function lockNote(tx: Tx, id: string) {
  const [n] = await tx.select().from(clinicalNotes).where(eq(clinicalNotes.id, id)).for("update");
  if (!n) throw new NoteError("notFound");
  return n;
}

/** Autosave target. Optimistic locking: a stale version means someone else saved first. */
export async function saveDraft(ctx: ClinicContext, id: string, body: Partial<NoteBody>, expectedVersion: number) {
  requirePermission(ctx, "clinical.write");
  return tenantTx(ctx, async (tx) => {
    const n = await lockNote(tx, id);
    if (n.status !== "draft" && n.status !== "in_review") throw new NoteError("notEditable");
    if (n.version !== expectedVersion) throw new NoteError("conflict");
    const [u] = await tx
      .update(clinicalNotes)
      .set({ draftBody: normalizeBody(body), updatedAt: new Date(), version: sql`${clinicalNotes.version} + 1` })
      .where(eq(clinicalNotes.id, id))
      .returning({ version: clinicalNotes.version });
    return u!.version;
  });
}

export async function submitForReview(ctx: ClinicContext, id: string) {
  requirePermission(ctx, "clinical.write");
  return tenantTx(ctx, async (tx) => {
    const n = await lockNote(tx, id);
    if (n.status !== "draft") throw new NoteError("notEditable");
    if (isEmpty(normalizeBody(n.draftBody ?? {}))) throw new NoteError("emptyNote");
    await tx.update(clinicalNotes).set({ status: "in_review", submittedForReviewAt: new Date(), updatedAt: new Date(), version: sql`${clinicalNotes.version} + 1` }).where(eq(clinicalNotes.id, id));
    await audit(tx, { ...staff(ctx), action: "clinical_note.submitted_for_review", entityType: "clinical_note", entityId: id, patientId: n.patientId });
  });
}

async function appendVersion(tx: Tx, ctx: ClinicContext, noteId: string, versionNo: number, kind: "original" | "amendment", body: NoteBody, reason: string | null, templateSnapshot: Partial<NoteBody> | null) {
  const [prev] = versionNo > 1 ? await tx.select({ hash: clinicalNoteVersions.contentHash }).from(clinicalNoteVersions).where(and(eq(clinicalNoteVersions.noteId, noteId), eq(clinicalNoteVersions.versionNo, versionNo - 1))) : [];
  const signedAt = new Date(Math.floor(Date.now() / 1000) * 1000); // second precision survives DB round-trip
  const prevHash = prev?.hash ?? null;
  const contentHash = versionHash({ noteId, versionNo, kind, body, amendmentReason: reason, signedByUserId: ctx.userId, signedAt: signedAt.toISOString(), prevHash });
  await tx.insert(clinicalNoteVersions).values({ organizationId: ctx.organizationId, noteId, versionNo, kind, body, amendmentReason: reason, templateSnapshot, signedByUserId: ctx.userId, signedAt, prevHash, contentHash });
}

/** Signs the draft: writes immutable version 1 and freezes the note. Requires an explicit attestation. */
export async function signNote(ctx: ClinicContext, id: string, expectedVersion: number, attested: boolean) {
  requirePermission(ctx, "clinical.sign");
  if (!attested) throw new NoteError("attestationRequired");
  return tenantTx(ctx, async (tx) => {
    const n = await lockNote(tx, id);
    if (n.status !== "draft" && n.status !== "in_review") throw new NoteError("notEditable");
    if (n.version !== expectedVersion) throw new NoteError("conflict");
    const body = normalizeBody(n.draftBody ?? {});
    if (isEmpty(body)) throw new NoteError("emptyNote");
    const [template] = n.templateId ? await tx.select({ body: noteTemplates.body }).from(noteTemplates).where(eq(noteTemplates.id, n.templateId)) : [];
    await appendVersion(tx, ctx, id, 1, "original", body, null, template?.body ?? null);
    await tx
      .update(clinicalNotes)
      .set({ status: "signed", currentVersion: 1, draftBody: null, signedByUserId: ctx.userId, signedAt: new Date(), updatedAt: new Date(), version: sql`${clinicalNotes.version} + 1` })
      .where(eq(clinicalNotes.id, id));
    await audit(tx, { ...staff(ctx), action: "clinical_note.signed", entityType: "clinical_note", entityId: id, patientId: n.patientId });
  });
}

/** Adds a dated, signed amendment. The original text is never changed. */
export async function amendNote(ctx: ClinicContext, id: string, body: Partial<NoteBody>, reason: string) {
  requirePermission(ctx, "clinical.sign");
  if (!reason.trim()) throw new NoteError("reasonRequired");
  const normalized = normalizeBody(body);
  if (isEmpty(normalized)) throw new NoteError("emptyNote");
  return tenantTx(ctx, async (tx) => {
    const n = await lockNote(tx, id);
    if (n.status !== "signed") throw new NoteError("notSigned");
    const next = n.currentVersion + 1;
    await appendVersion(tx, ctx, id, next, "amendment", normalized, reason.trim(), null);
    await tx.update(clinicalNotes).set({ currentVersion: next, updatedAt: new Date(), version: sql`${clinicalNotes.version} + 1` }).where(eq(clinicalNotes.id, id));
    await audit(tx, { ...staff(ctx), action: "clinical_note.amended", entityType: "clinical_note", entityId: id, patientId: n.patientId, metadata: { versionNo: next } });
  });
}

export async function discardDraft(ctx: ClinicContext, id: string) {
  requirePermission(ctx, "clinical.write");
  return tenantTx(ctx, async (tx) => {
    const n = await lockNote(tx, id);
    if (n.status !== "draft" && n.status !== "in_review") throw new NoteError("notEditable");
    await tx.update(clinicalNotes).set({ status: "discarded", updatedAt: new Date(), version: sql`${clinicalNotes.version} + 1` }).where(eq(clinicalNotes.id, id));
    await audit(tx, { ...staff(ctx), action: "clinical_note.discarded", entityType: "clinical_note", entityId: id, patientId: n.patientId });
    return n.patientId;
  });
}

export const canSign = (ctx: ClinicContext) => can(ctx, "clinical.sign");
