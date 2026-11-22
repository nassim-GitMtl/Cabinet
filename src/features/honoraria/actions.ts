"use server";

import { revalidatePath } from "next/cache";
import { formValues, type ActionState } from "@/lib/action-state";
import { parseMoneyInput } from "@/lib/money";
import { ForbiddenError, requireClinicContext } from "@/server/auth/context";
import { CashError } from "@/features/cash/server";
import { percentInputToBasisPoints, type FeeRule } from "./calculation";
import {
  adjustHonorarium,
  assignLineHonorarium,
  closeHonorariumMonth,
  HonorariumError,
  PAYOUT_METHODS,
  recordHonorariumPayment,
  reverseHonorariumPayment,
  saveProviderFeeProfile,
  saveProviderServiceTerm,
  type PayoutMethod,
} from "./server";

function fail(error: unknown, values: Record<string, string>): ActionState {
  if (error instanceof ForbiddenError) return { error: "forbidden", values };
  if (error instanceof HonorariumError) return { error: `honoraria.errors.${error.code}`, values };
  if (error instanceof CashError) return { error: `cash.errors.${error.code}`, values };
  throw error;
}

function done(): ActionState {
  revalidatePath("/honoraires");
  revalidatePath("/cash");
  return { ok: true };
}

/** Rule typed in a form: "percent" + "30" / "12,5", or "fixed" + an amount. */
function ruleFrom(type: string | undefined, raw: string | undefined, currency: string): FeeRule | null {
  if (type !== "percent" && type !== "fixed") return null;
  const value = type === "percent" ? percentInputToBasisPoints(raw ?? "") : parseMoneyInput(raw ?? "", currency);
  return value === null || value < 0 ? null : { type, value };
}

export async function saveProviderProfileAction(_prev: ActionState, data: FormData): Promise<ActionState> {
  const ctx = await requireClinicContext();
  const v = formValues(data);
  const rate = percentInputToBasisPoints(v.defaultRate ?? "");
  if (rate === null) return { fieldErrors: { defaultRate: "honoraria.errors.invalidPercent" }, values: v };
  try {
    await saveProviderFeeProfile(ctx, { providerId: v.providerId ?? "", specialty: v.specialty || null, defaultFeeRateBp: rate });
  } catch (e) {
    return fail(e, v);
  }
  return done();
}

/** One row of a practitioner's price list: own price and fee for one service (both optional). */
export async function savePriceListRowAction(providerId: string, serviceId: string, _prev: ActionState, data: FormData): Promise<ActionState> {
  const ctx = await requireClinicContext();
  const v = formValues(data);
  const currency = ctx.organization.defaultCurrency;
  const fieldErrors: Record<string, string> = {};
  const price = v.price?.trim() ? parseMoneyInput(v.price, currency) : null;
  if (v.price?.trim() && (price === null || price < 0)) fieldErrors.price = "invalidAmount";
  const rule = v.ruleValue?.trim() ? ruleFrom(v.ruleType, v.ruleValue, currency) : null;
  if (v.ruleValue?.trim() && !rule) fieldErrors.ruleValue = v.ruleType === "fixed" ? "invalidAmount" : "honoraria.errors.invalidPercent";
  if (Object.keys(fieldErrors).length) return { fieldErrors, values: v };
  try {
    await saveProviderServiceTerm(ctx, { providerId, serviceId, priceMinor: price, rule });
  } catch (e) {
    return fail(e, v);
  }
  revalidatePath("/honoraires/tarifs");
  revalidatePath("/patients", "layout");
  return { ok: true, values: v };
}

export async function recordPaymentAction(_prev: ActionState, data: FormData): Promise<ActionState> {
  const ctx = await requireClinicContext();
  const v = formValues(data);
  const amount = parseMoneyInput(v.amount ?? "", ctx.organization.defaultCurrency);
  const method = PAYOUT_METHODS.find((m) => m === v.method) as PayoutMethod | undefined;
  if (!amount || amount <= 0) return { fieldErrors: { amount: "invalidAmount" }, values: v };
  if (!method) return { error: "fixErrors", values: v };
  try {
    await recordHonorariumPayment(ctx, { providerId: v.providerId ?? "", paidOn: v.paidOn ?? "", amountMinor: amount, method, reference: v.reference, note: v.note });
  } catch (e) {
    return fail(e, v);
  }
  return done();
}

export async function reversePaymentAction(paymentId: string, _prev: ActionState, data: FormData): Promise<ActionState> {
  const ctx = await requireClinicContext();
  const v = formValues(data);
  if (!v.reason?.trim()) return { fieldErrors: { reason: "required" }, values: v };
  try {
    await reverseHonorariumPayment(ctx, paymentId, v.reason);
  } catch (e) {
    return fail(e, v);
  }
  return done();
}

export async function closeMonthAction(_prev: ActionState, data: FormData): Promise<ActionState> {
  const ctx = await requireClinicContext();
  const v = formValues(data);
  try {
    await closeHonorariumMonth(ctx, { providerId: v.providerId ?? "", month: v.month ?? "", note: v.note });
  } catch (e) {
    return fail(e, v);
  }
  return done();
}

export async function adjustEntryAction(entryId: string, _prev: ActionState, data: FormData): Promise<ActionState> {
  const ctx = await requireClinicContext();
  const v = formValues(data);
  const amount = parseMoneyInput(v.amount ?? "", ctx.organization.defaultCurrency);
  if (!amount) return { fieldErrors: { amount: "invalidAmount" }, values: v };
  if (!v.reason?.trim()) return { fieldErrors: { reason: "required" }, values: v };
  try {
    await adjustHonorarium(ctx, { entryId, deltaMinor: v.direction === "minus" ? -Math.abs(amount) : Math.abs(amount), reason: v.reason });
  } catch (e) {
    return fail(e, v);
  }
  return done();
}

export async function assignLineAction(invoiceLineId: string, _prev: ActionState, data: FormData): Promise<ActionState> {
  const ctx = await requireClinicContext();
  const v = formValues(data);
  const lab = v.labFee?.trim() ? parseMoneyInput(v.labFee, ctx.organization.defaultCurrency) : 0;
  if (lab === null || lab < 0) return { fieldErrors: { labFee: "invalidAmount" }, values: v };
  try {
    await assignLineHonorarium(ctx, { invoiceLineId, providerId: v.providerId ?? "", labFeeMinor: lab });
  } catch (e) {
    return fail(e, v);
  }
  revalidatePath("/honoraires/reprise");
  return done();
}
