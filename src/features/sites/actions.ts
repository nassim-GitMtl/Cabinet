"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { formValues, type ActionState } from "@/lib/action-state";
import { ForbiddenError, requireClinicContext } from "@/server/auth/context";
import { SITE_COOKIE } from "@/server/sites";
import { createSite, setSiteActive, SiteError, updateSite } from "./server";

function fail(error: unknown, values?: Record<string, string>): ActionState {
  if (error instanceof ForbiddenError) return { error: "forbidden", values };
  if (error instanceof SiteError) return { error: `sites.errors.${error.code}`, values };
  throw error;
}

const input = (v: Record<string, string>) => ({ name: v.name ?? "", address: v.address || null, phone: v.phone || null, email: v.email || null });

export async function saveSiteAction(siteId: string | null, _prev: ActionState, data: FormData): Promise<ActionState> {
  const ctx = await requireClinicContext();
  const v = formValues(data);
  if (!v.name?.trim()) return { fieldErrors: { name: "required" }, values: v };
  try {
    if (siteId) await updateSite(ctx, siteId, input(v));
    else await createSite(ctx, input(v));
  } catch (e) {
    return fail(e, v);
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function setSiteActiveAction(siteId: string, active: boolean): Promise<ActionState> {
  const ctx = await requireClinicContext();
  try {
    await setSiteActive(ctx, siteId, active);
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

/** The site this person works at now (agenda, reception, cash drawer). Remembered on this device. */
export async function chooseSiteAction(siteId: string): Promise<ActionState> {
  const ctx = await requireClinicContext();
  if (!ctx.sites.some((s) => s.id === siteId)) return { error: "forbidden" };
  (await cookies()).set(SITE_COOKIE, siteId, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 365 });
  revalidatePath("/", "layout");
  return { ok: true };
}
