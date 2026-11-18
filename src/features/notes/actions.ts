"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { formValues, type ActionState } from "@/lib/action-state";
import { parseDateOnly } from "@/lib/dates";
import type { NoteBody } from "@/server/db/schema";
import { ForbiddenError, requireClinicContext } from "@/server/auth/context";
import { amendNote, createNote, discardDraft, NOTE_KINDS, NoteError, saveDraft, signNote, submitForReview } from "./server";

function fail(err: unknown, values?: Record<string, string>): ActionState {
  if (err instanceof ForbiddenError) return { error: "forbidden", values };
  if (err instanceof NoteError) return { error: `notes.errors.${err.code}`, values };
  throw err;
}

export async function createNoteAction(patientId: string, _p: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireClinicContext();
  const v = formValues(fd);
  const serviceDate = parseDateOnly(v.serviceDate ?? "");
  const kind = NOTE_KINDS.find((k) => k === v.kind) ?? "progress";
  if (!serviceDate) return { fieldErrors: { serviceDate: "invalidDate" }, values: v };
  let id: string;
  try {
    id = await createNote(ctx, patientId, { kind, serviceDate, providerId: v.providerId ?? "", templateId: v.templateId || null });
  } catch (e) {
    return fail(e, v);
  }
  revalidatePath(`/patients/${patientId}`);
  redirect(`/patients/${patientId}/notes/${id}`);
}

/** Autosave: returns the new version (or an error code, e.g. conflict). */
export async function saveDraftAction(noteId: string, body: Partial<NoteBody>, version: number): Promise<ActionState> {
  const ctx = await requireClinicContext();
  try {
    return { ok: true, data: { version: await saveDraft(ctx, noteId, body, version) } };
  } catch (e) {
    return fail(e);
  }
}

export async function submitForReviewAction(noteId: string, patientId: string): Promise<ActionState> {
  const ctx = await requireClinicContext();
  try {
    await submitForReview(ctx, noteId);
  } catch (e) {
    return fail(e);
  }
  revalidatePath(`/patients/${patientId}/notes/${noteId}`);
  return { ok: true };
}

export async function signNoteAction(noteId: string, patientId: string, version: number, attested: boolean): Promise<ActionState> {
  const ctx = await requireClinicContext();
  try {
    await signNote(ctx, noteId, version, attested);
  } catch (e) {
    return fail(e);
  }
  revalidatePath(`/patients/${patientId}`);
  revalidatePath(`/patients/${patientId}/notes/${noteId}`);
  return { ok: true };
}

export async function amendNoteAction(noteId: string, patientId: string, _p: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireClinicContext();
  const v = formValues(fd);
  try {
    await amendNote(
      ctx,
      noteId,
      {
        chiefComplaint: v.chiefComplaint,
        observations: v.observations,
        assessment: v.assessment,
        plan: v.plan,
        performedWork: v.performedWork,
        teeth: (v.teeth ?? "").split(/[\s,;]+/).filter(Boolean),
      },
      v.reason ?? "",
    );
  } catch (e) {
    return fail(e, v);
  }
  revalidatePath(`/patients/${patientId}/notes/${noteId}`);
  return { ok: true };
}

export async function discardDraftAction(noteId: string): Promise<ActionState> {
  const ctx = await requireClinicContext();
  let patientId: string;
  try {
    patientId = await discardDraft(ctx, noteId);
  } catch (e) {
    return fail(e);
  }
  revalidatePath(`/patients/${patientId}`);
  redirect(`/patients/${patientId}?tab=clinical`);
}
