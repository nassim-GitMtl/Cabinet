"use server";

import { revalidatePath } from "next/cache";
import { formValues, type ActionState } from "@/lib/action-state";
import { parseDateOnly } from "@/lib/dates";
import { ForbiddenError, requireClinicContext } from "@/server/auth/context";
import { AgendaError } from "./server";
import {
  addTimeOff,
  createAppointmentType,
  createChair,
  deleteTimeOff,
  setChairActive,
  setWorkingHours,
  updateAppointmentType,
  type HoursInterval,
  type TypeInput,
} from "./settings";

function fail(err: unknown, values?: Record<string, string>): ActionState {
  if (err instanceof ForbiddenError) return { error: "forbidden", values };
  if (err instanceof AgendaError) return { error: `agenda.errors.${err.code}`, values };
  throw err;
}

const done = (data?: unknown): ActionState => {
  revalidatePath("/settings/agenda");
  revalidatePath("/agenda");
  return { ok: true, data };
};

export async function createChairAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireClinicContext();
  try {
    await createChair(ctx, String(fd.get("name") ?? ""));
  } catch (e) {
    return fail(e, formValues(fd));
  }
  return done();
}

export async function toggleChairAction(id: string, active: boolean): Promise<ActionState> {
  const ctx = await requireClinicContext();
  try {
    await setChairActive(ctx, id, active);
  } catch (e) {
    return fail(e);
  }
  return done();
}

function typeInput(fd: FormData): TypeInput {
  return {
    nameFr: String(fd.get("nameFr") ?? ""),
    nameEn: (fd.get("nameEn") as string) || null,
    nameAr: (fd.get("nameAr") as string) || null,
    durationMin: Number(fd.get("durationMin")),
    bookableOnline: fd.get("bookableOnline") === "on",
    active: fd.get("activeMarker") ? fd.get("active") === "on" : true,
  };
}

export async function saveTypeAction(id: string | null, _p: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireClinicContext();
  try {
    if (id) await updateAppointmentType(ctx, id, typeInput(fd));
    else await createAppointmentType(ctx, typeInput(fd));
  } catch (e) {
    return fail(e, formValues(fd));
  }
  return done();
}

/** Form fields d{weekday}_s{1|2} / d{weekday}_e{1|2}; empty pairs are ignored. */
export async function saveHoursAction(providerId: string, _p: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireClinicContext();
  const intervals: HoursInterval[] = [];
  for (let wd = 1; wd <= 7; wd++) {
    if (fd.get(`d${wd}_on`) !== "on") continue;
    for (const k of [1, 2]) {
      const start = String(fd.get(`d${wd}_s${k}`) ?? "");
      const end = String(fd.get(`d${wd}_e${k}`) ?? "");
      if (start || end) intervals.push({ weekday: wd, start, end });
    }
  }
  try {
    await setWorkingHours(ctx, providerId, intervals);
  } catch (e) {
    return fail(e, formValues(fd));
  }
  return done();
}

export async function addTimeOffAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireClinicContext();
  const v = formValues(fd);
  const startDate = parseDateOnly(v.startDate ?? "");
  const endDate = parseDateOnly(v.endDate ?? "") ?? startDate;
  if (!startDate || !endDate) return { fieldErrors: { startDate: "invalidDate" }, values: v };
  const kind = (["leave", "holiday", "blocked"] as const).find((k) => k === v.kind) ?? "leave";
  try {
    const r = await addTimeOff(ctx, {
      providerId: v.providerId || null,
      kind,
      startDate,
      startTime: v.startTime || "00:00",
      endDate,
      endTime: v.endTime || "23:59",
      reason: v.reason || null,
    });
    return done({ overlapping: r.overlappingAppointments });
  } catch (e) {
    return fail(e, v);
  }
}

export async function deleteTimeOffAction(id: string): Promise<ActionState> {
  const ctx = await requireClinicContext();
  try {
    await deleteTimeOff(ctx, id);
  } catch (e) {
    return fail(e);
  }
  return done();
}
