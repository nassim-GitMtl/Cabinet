"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "@/lib/action-state";
import { requireClinicContext } from "@/server/auth/context";
import { db } from "@/server/db/client";
import { SyncHttpError } from "@/server/sync/client";
import { nodeRole } from "@/server/sync/node";
import { kickSyncWorker, pairWithCloud } from "@/server/sync/worker";
import { createPairingCode, revokeClinicNode, SyncSetupError } from "./server";

/** Cloud: owner creates the single-use code typed on the clinic computer (shown once). */
export async function createPairingCodeAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await requireClinicContext();
  try {
    const { code, expiresAt } = await createPairingCode(ctx, String(formData.get("label") ?? ""));
    revalidatePath("/settings/clinic-computer");
    return { ok: true, data: { code, expiresAt: expiresAt.toISOString() } };
  } catch (error) {
    if (error instanceof SyncSetupError) return { error: "conflict" };
    throw error;
  }
}

/** Cloud: owner unpairs the clinic computer; the online copy is in charge again. */
export async function revokeClinicNodeAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await requireClinicContext();
  if (formData.get("confirm") !== "on") return { fieldErrors: { confirm: "required" } };
  await revokeClinicNode(ctx);
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Fresh clinic computer (no sign-in yet): pair with the online copy, then the worker copies the data. */
export async function pairClinicComputerAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const cloudUrl = String(formData.get("cloudUrl") ?? "").trim();
  const code = String(formData.get("code") ?? "").trim();
  const values = { cloudUrl, code: "" };
  if (!cloudUrl || !code) return { fieldErrors: { ...(cloudUrl ? {} : { cloudUrl: "required" }), ...(code ? {} : { code: "required" }) }, values };
  if ((await nodeRole()) !== "clinic") return { error: "sync.reasons.notPairable", values };
  try {
    await pairWithCloud(db.$client, cloudUrl, code);
  } catch (error) {
    const reason = error instanceof SyncHttpError ? error.code : "offline";
    const known = ["pairingUnavailable", "invalidUrl", "notPairable", "schemaMismatch", "syncDisabled", "notCloud"];
    return { error: `sync.reasons.${known.includes(reason) ? reason : error instanceof SyncHttpError && error.status >= 500 ? "cloudUnavailable" : "offline"}`, values };
  }
  kickSyncWorker();
  redirect("/sync-setup");
}
