"use server";

import { revalidatePath } from "next/cache";
import { fieldErrorsOf, formValues, type ActionState } from "@/lib/action-state";
import { todayInZone, zonedToUtc } from "@/lib/dates";
import { ForbiddenError, requireClinicContext } from "@/server/auth/context";
import {
  biologicalResultSchema, createInstrumentSetSchema, createSterilizerSchema, cycleDecisionSchema,
  discardPackSchema, linkPackSchema, recordCycleSchema, requiredCycleDecisionSchema, voidPackUseSchema,
} from "./schemas";
import {
  createInstrumentSet, createSterilizer, deactivateSterilizationSetup, discardSterilizationPack,
  failSterilizationCycle, linkSterilizationPack, recallSterilizationCycle, recordBiologicalResult,
  recordSterilizationCycle, releaseSterilizationCycle, SterilizationError, voidSterilizationPackUse,
} from "./server";

function fail(error: unknown, values: Record<string, string>): ActionState {
  if (error instanceof ForbiddenError) return { error: "forbidden", values };
  if (error instanceof SterilizationError) return { error: `sterilization.errors.${error.code}`, values };
  throw error;
}

function done(paths: string[] = ["/sterilization"]): ActionState {
  for (const path of paths) revalidatePath(path);
  return { ok: true };
}

export async function createSterilizerAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await requireClinicContext(); const values = formValues(formData);
  const parsed = createSterilizerSchema.safeParse(values);
  if (!parsed.success) return { fieldErrors: fieldErrorsOf(parsed.error), values };
  try { await createSterilizer(ctx, parsed.data); } catch (error) { return fail(error, values); }
  return done();
}

export async function createInstrumentSetAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await requireClinicContext(); const values = formValues(formData);
  const parsed = createInstrumentSetSchema.safeParse(values);
  if (!parsed.success) return { fieldErrors: fieldErrorsOf(parsed.error), values };
  try { await createInstrumentSet(ctx, parsed.data); } catch (error) { return fail(error, values); }
  return done();
}

export async function deactivateSterilizationSetupAction(formData: FormData) {
  const ctx = await requireClinicContext();
  const id = String(formData.get("id") ?? ""); const kind = String(formData.get("kind") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id) || (kind !== "sterilizer" && kind !== "instrument_set")) return;
  await deactivateSterilizationSetup(ctx, kind, id); revalidatePath("/sterilization");
}

export async function recordSterilizationCycleAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await requireClinicContext(); const values = formValues(formData);
  let packs: unknown;
  try { packs = JSON.parse(values.packs ?? "[]"); } catch { return { fieldErrors: { packs: "sterilization.errors.packsRequired" }, values }; }
  const parsed = recordCycleSchema.safeParse({ ...values, packs });
  if (!parsed.success) return { fieldErrors: fieldErrorsOf(parsed.error), values };
  const startedAt = zonedToUtc(parsed.data.startedDate, parsed.data.startedTime, ctx.organization.timezone);
  if (startedAt.getTime() > Date.now() + 5 * 60_000) return { fieldErrors: { startedDate: "futureDate" }, values };
  try { await recordSterilizationCycle(ctx, { ...parsed.data, startedAt }); } catch (error) { return fail(error, values); }
  return done();
}

export async function releaseSterilizationCycleAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await requireClinicContext(); const values = formValues(formData); const parsed = cycleDecisionSchema.safeParse(values);
  if (!parsed.success) return { fieldErrors: fieldErrorsOf(parsed.error), values };
  try { await releaseSterilizationCycle(ctx, parsed.data.cycleId, parsed.data.reason); } catch (error) { return fail(error, values); }
  return done(["/sterilization", `/sterilization/cycles/${parsed.data.cycleId}`]);
}

export async function failSterilizationCycleAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await requireClinicContext(); const values = formValues(formData); const parsed = requiredCycleDecisionSchema.safeParse(values);
  if (!parsed.success) return { fieldErrors: fieldErrorsOf(parsed.error), values };
  try { await failSterilizationCycle(ctx, parsed.data.cycleId, parsed.data.reason); } catch (error) { return fail(error, values); }
  return done(["/sterilization", `/sterilization/cycles/${parsed.data.cycleId}`]);
}

export async function recallSterilizationCycleAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await requireClinicContext(); const values = formValues(formData); const parsed = requiredCycleDecisionSchema.safeParse(values);
  if (!parsed.success) return { fieldErrors: fieldErrorsOf(parsed.error), values };
  try { await recallSterilizationCycle(ctx, parsed.data.cycleId, parsed.data.reason); } catch (error) { return fail(error, values); }
  return done(["/sterilization", `/sterilization/cycles/${parsed.data.cycleId}`]);
}

export async function recordBiologicalResultAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await requireClinicContext(); const values = formValues(formData); const parsed = biologicalResultSchema.safeParse(values);
  if (!parsed.success) return { fieldErrors: fieldErrorsOf(parsed.error), values };
  try { await recordBiologicalResult(ctx, parsed.data.cycleId, parsed.data.result, parsed.data.reason); } catch (error) { return fail(error, values); }
  return done(["/sterilization", `/sterilization/cycles/${parsed.data.cycleId}`]);
}

export async function discardSterilizationPackAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await requireClinicContext(); const values = formValues(formData); const parsed = discardPackSchema.safeParse(values);
  if (!parsed.success) return { fieldErrors: fieldErrorsOf(parsed.error), values };
  try { await discardSterilizationPack(ctx, parsed.data.packId, parsed.data.reason); } catch (error) { return fail(error, values); }
  return done(["/sterilization", `/sterilization/cycles/${parsed.data.cycleId}`]);
}

export async function linkSterilizationPackAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await requireClinicContext(); const values = formValues(formData); const parsed = linkPackSchema.safeParse(values);
  if (!parsed.success) return { fieldErrors: fieldErrorsOf(parsed.error), values };
  if (parsed.data.usedOn > todayInZone(ctx.organization.timezone)) return { fieldErrors: { usedOn: "futureDate" }, values };
  try { await linkSterilizationPack(ctx, parsed.data); } catch (error) { return fail(error, values); }
  return done(["/sterilization", `/patients/${parsed.data.patientId}/sterilization`]);
}

export async function voidSterilizationPackUseAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await requireClinicContext(); const values = formValues(formData); const parsed = voidPackUseSchema.safeParse(values);
  if (!parsed.success) return { fieldErrors: fieldErrorsOf(parsed.error), values };
  try { await voidSterilizationPackUse(ctx, parsed.data.useId, parsed.data.reason); } catch (error) { return fail(error, values); }
  revalidatePath("/sterilization"); return { ok: true };
}
