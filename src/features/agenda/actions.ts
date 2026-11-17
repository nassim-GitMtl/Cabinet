"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { formValues, type ActionState } from "@/lib/action-state";
import { ForbiddenError, requireClinicContext } from "@/server/auth/context";
import { searchPatients } from "@/features/patients/server";
import {
  AgendaError,
  cancelAppointment,
  createAppointment,
  rescheduleAppointment,
  setConfirmation,
  setVisitStatus,
  type VisitStatus,
} from "./server";

const inputSchema = z.object({
  patientId: z.uuid("required"),
  providerId: z.uuid("required"),
  chairId: z.union([z.uuid(), z.literal("")]),
  appointmentTypeId: z.union([z.uuid(), z.literal("")]),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "invalidDate"),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "required"),
  durationMin: z.coerce.number().int().min(5, "invalidDuration").max(480, "invalidDuration"),
  notes: z.string().max(1000, "tooLong"),
});

function fail(err: unknown, values?: Record<string, string>): ActionState {
  if (err instanceof ForbiddenError) return { error: "forbidden", values };
  if (err instanceof AgendaError) return { error: `agenda.errors.${err.code}`, values };
  throw err;
}

function refreshAgenda(patientId?: string) {
  revalidatePath("/agenda");
  revalidatePath("/reception");
  revalidatePath("/dashboard");
  if (patientId) revalidatePath(`/patients/${patientId}`);
}

export async function createAppointmentAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await requireClinicContext();
  const values = formValues(formData);
  const parsed = inputSchema.safeParse(values);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0])] ??= issue.message;
    return { fieldErrors, values };
  }
  try {
    await createAppointment(ctx, {
      ...parsed.data,
      chairId: parsed.data.chairId || null,
      appointmentTypeId: parsed.data.appointmentTypeId || null,
      notes: parsed.data.notes.trim() || null,
      outsideHoursOverride: formData.get("outsideHoursOverride") === "on",
    });
  } catch (err) {
    return fail(err, values);
  }
  refreshAgenda(parsed.data.patientId);
  return { ok: true };
}

export async function rescheduleAppointmentAction(
  appointmentId: string,
  version: number,
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await requireClinicContext();
  const values = formValues(formData);
  const parsed = inputSchema.safeParse(values);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0])] ??= issue.message;
    return { fieldErrors, values };
  }
  try {
    await rescheduleAppointment(
      ctx,
      appointmentId,
      {
        ...parsed.data,
        chairId: parsed.data.chairId || null,
        appointmentTypeId: parsed.data.appointmentTypeId || null,
        notes: parsed.data.notes.trim() || null,
        outsideHoursOverride: formData.get("outsideHoursOverride") === "on",
      },
      version,
    );
  } catch (err) {
    return fail(err, values);
  }
  refreshAgenda(parsed.data.patientId);
  return { ok: true };
}

export async function searchAgendaPatientsAction(query: string) {
  const ctx = await requireClinicContext();
  const q = query.trim();
  if (q.length < 2) return [];
  const result = await searchPatients(ctx, { q, pageSize: 8 });
  return result.rows.map((patient) => ({
    id: patient.id,
    patientNumber: patient.patientNumber,
    firstName: patient.firstName,
    lastName: patient.lastName,
    phone: patient.phone,
  }));
}

export async function confirmationAction(
  appointmentId: string,
  status: "pending" | "confirmed" | "declined" | "reschedule_requested",
): Promise<ActionState> {
  const ctx = await requireClinicContext();
  try {
    await setConfirmation(ctx, appointmentId, status);
  } catch (err) {
    return fail(err);
  }
  refreshAgenda();
  return { ok: true };
}

export async function visitStatusAction(appointmentId: string, status: VisitStatus): Promise<ActionState> {
  const ctx = await requireClinicContext();
  try {
    await setVisitStatus(ctx, appointmentId, status);
  } catch (err) {
    return fail(err);
  }
  refreshAgenda();
  return { ok: true };
}

export async function cancelAppointmentAction(
  appointmentId: string,
  kind: "cancelled" | "no_show",
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await requireClinicContext();
  const values = formValues(formData);
  try {
    await cancelAppointment(ctx, appointmentId, values.reason ?? "", kind);
  } catch (err) {
    return fail(err, values);
  }
  refreshAgenda();
  return { ok: true };
}
