"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import { formValues, type ActionState } from "@/lib/action-state";
import { requestMeta } from "@/server/auth/session";
import { ForbiddenError, requireClinicContext } from "@/server/auth/context";
import {
  approveBookingRequest,
  BookingError,
  createBookingLink,
  createPatientFromRequest,
  declineBookingRequest,
  setBookingLinkActive,
  submitBookingRequest,
} from "./server";

function fail(err: unknown, values?: Record<string, string>): ActionState {
  if (err instanceof ForbiddenError) return { error: "forbidden", values };
  if (err instanceof BookingError) return { error: `booking.errors.${err.code}`, values };
  throw err;
}

const refresh = () => {
  revalidatePath("/agenda/requests");
  revalidatePath("/agenda");
  revalidatePath("/dashboard");
};

/** Public: submit a booking request. Never creates an appointment. */
export async function submitBookingAction(
  token: string,
  slot: { typeId: string; providerId: string; date: string; time: string },
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = formValues(formData);
  // Honeypot: real users never fill the hidden "website" field.
  if (values.website) return { error: "booking.errors.slotUnavailable", values };
  const fieldErrors: Record<string, string> = {};
  if ((values.contactName ?? "").trim().length < 3) fieldErrors.contactName = "required";
  if (!values.contactPhone?.trim()) fieldErrors.contactPhone = "required";
  if (values.consent !== "on") fieldErrors.consent = "required";
  if (Object.keys(fieldErrors).length) return { fieldErrors, values };
  let ref: string;
  try {
    const { ipAddress } = await requestMeta();
    ref = await submitBookingRequest(
      token,
      {
        ...slot,
        contactName: values.contactName!,
        contactPhone: values.contactPhone!,
        contactEmail: values.contactEmail || null,
        declaresExistingPatient: values.existing === "yes",
        message: values.message || null,
        locale: await getLocale(),
      },
      ipAddress,
    );
  } catch (err) {
    if (err instanceof BookingError && err.code === "invalidPhone") return { fieldErrors: { contactPhone: "invalidPhone" }, values };
    return fail(err, values);
  }
  redirect(`/book/status/${ref}`);
}

export async function approveRequestAction(requestId: string, patientId: string): Promise<ActionState> {
  const ctx = await requireClinicContext();
  try {
    await approveBookingRequest(ctx, requestId, patientId);
  } catch (err) {
    return fail(err);
  }
  refresh();
  return { ok: true };
}

export async function createPatientFromRequestAction(requestId: string, confirmNotDuplicate: boolean): Promise<ActionState> {
  const ctx = await requireClinicContext();
  try {
    const r = await createPatientFromRequest(ctx, requestId, { confirmNotDuplicate });
    return r.status === "created" ? { ok: true, data: { patientId: r.id } } : { data: { duplicates: r.candidates } };
  } catch (err) {
    return fail(err);
  }
}

export async function declineRequestAction(requestId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await requireClinicContext();
  const values = formValues(formData);
  if (!values.reason?.trim()) return { fieldErrors: { reason: "required" }, values };
  try {
    await declineBookingRequest(ctx, requestId, values.reason);
  } catch (err) {
    return fail(err, values);
  }
  refresh();
  return { ok: true };
}

export async function createLinkAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await requireClinicContext();
  try {
    await createBookingLink(ctx, String(formData.get("label") ?? ""));
  } catch (err) {
    return fail(err);
  }
  refresh();
  return { ok: true };
}

export async function toggleLinkAction(linkId: string, active: boolean): Promise<ActionState> {
  const ctx = await requireClinicContext();
  try {
    await setBookingLinkActive(ctx, linkId, active);
  } catch (err) {
    return fail(err);
  }
  refresh();
  return { ok: true };
}
