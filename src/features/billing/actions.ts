"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { formValues, type ActionState } from "@/lib/action-state";
import { parseDateOnly, todayInZone } from "@/lib/dates";
import { parseMoneyInput } from "@/lib/money";
import { ForbiddenError, requireClinicContext } from "@/server/auth/context";
import { CashError } from "@/features/cash/server";
import { percentInputToBasisPoints, type FeeRule } from "@/features/honoraria/calculation";
import { HonorariumError } from "@/features/honoraria/server";
import {
  applyPaymentToInvoice,
  BillingError,
  type CheckoutLineOption,
  createInvoiceFromProcedures,
  deleteDraftInvoice,
  issueCreditNote,
  issueInvoice,
  recordPayment,
  refundPayment,
  reversePayment,
  voidInvoice,
} from "./server";

const METHODS = ["cash", "card", "bank_transfer", "cheque", "other"] as const;
const uuid = z.uuid();

function fail(err: unknown, values?: Record<string, string>): ActionState {
  if (err instanceof ForbiddenError) return { error: "forbidden", values };
  if (err instanceof BillingError) return { error: `billing.errors.${err.code}`, values };
  if (err instanceof CashError) return { error: `cash.errors.${err.code}`, values };
  if (err instanceof HonorariumError) return { error: `honoraria.errors.${err.code}`, values };
  throw err;
}

function revalidateBilling(patientId?: string, invoiceId?: string) {
  revalidatePath("/invoices");
  revalidatePath("/reports");
  revalidatePath("/dashboard");
  if (invoiceId) revalidatePath(`/invoices/${invoiceId}`);
  if (patientId) revalidatePath(`/patients/${patientId}`);
}

/** Practitioner-fee fields of one checkout line; absent when the clinic does not use practitioner fees. */
function lineOption(formData: FormData, procedureId: string, currency: string): CheckoutLineOption | "providerUnavailable" | "invalidLabFee" | "invalidFeeRule" {
  const field = (name: string) => String(formData.get(`${name}:${procedureId}`) ?? "").trim();
  const providerId = field("providerId");
  if (providerId && !uuid.safeParse(providerId).success) return "providerUnavailable";
  const labRaw = field("labFee");
  const labFeeMinor = labRaw ? parseMoneyInput(labRaw, currency) : 0;
  if (labFeeMinor === null || labFeeMinor < 0) return "invalidLabFee";
  const ruleType = field("ruleType");
  let rule: FeeRule | null = null;
  if (ruleType === "percent" || ruleType === "fixed") {
    const raw = field("ruleValue");
    const value = ruleType === "percent" ? percentInputToBasisPoints(raw) : parseMoneyInput(raw, currency);
    if (value === null || value < 0) return "invalidFeeRule";
    rule = { type: ruleType, value };
  }
  return { procedureId, providerId: providerId || null, labFeeMinor, rule, ruleReason: rule ? field("ruleReason") || null : null };
}

export async function createInvoiceAction(patientId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await requireClinicContext();
  const values = formValues(formData);
  const procedureIds = formData.getAll("procedureIds").map(String).filter((v) => uuid.safeParse(v).success);
  if (!procedureIds.length) return { error: "billing.errors.noLines", values };
  const lineOptions: CheckoutLineOption[] = [];
  for (const procedureId of procedureIds) {
    const option = lineOption(formData, procedureId, ctx.organization.defaultCurrency);
    if (typeof option === "string") return { error: `billing.errors.${option}`, values };
    lineOptions.push(option);
  }
  let id: string;
  try {
    id = await createInvoiceFromProcedures(ctx, patientId, {
      procedureIds,
      issueNow: values.mode !== "draft",
      notes: values.notes?.trim() || null,
      lineOptions,
    });
  } catch (err) {
    return fail(err, values);
  }
  revalidateBilling(patientId, id);
  redirect(`/invoices/${id}`);
}

export async function issueInvoiceAction(invoiceId: string): Promise<ActionState> {
  const ctx = await requireClinicContext();
  try {
    await issueInvoice(ctx, invoiceId);
  } catch (err) {
    return fail(err);
  }
  revalidateBilling(undefined, invoiceId);
  return { ok: true };
}

export async function deleteDraftAction(invoiceId: string) {
  const ctx = await requireClinicContext();
  const patientId = await deleteDraftInvoice(ctx, invoiceId);
  revalidateBilling(patientId);
  redirect(`/patients/${patientId}?tab=finance`);
}

export async function voidInvoiceAction(invoiceId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await requireClinicContext();
  try {
    await voidInvoice(ctx, invoiceId, String(formData.get("reason") ?? ""));
  } catch (err) {
    return fail(err, formValues(formData));
  }
  revalidateBilling(undefined, invoiceId);
  return { ok: true };
}

export async function recordPaymentAction(
  patientId: string,
  allocateTo: string | "auto" | null,
  installmentId: string | null,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await requireClinicContext();
  const values = formValues(formData);
  const currency = ctx.organization.defaultCurrency;
  const amountMinor = parseMoneyInput(values.amount ?? "", currency);
  const receivedOn = parseDateOnly(values.receivedOn ?? "") ?? null;
  const method = METHODS.find((m) => m === values.method);
  const fieldErrors: Record<string, string> = {};
  if (amountMinor === null || amountMinor <= 0) fieldErrors.amount = "invalidAmount";
  if (!receivedOn) fieldErrors.receivedOn = "invalidDate";
  else if (receivedOn > todayInZone(ctx.organization.timezone)) fieldErrors.receivedOn = "futureDate";
  if (!method) fieldErrors.method = "required";
  if (!uuid.safeParse(values.idempotencyKey).success) return { error: "generic", values };
  if (Object.keys(fieldErrors).length) return { fieldErrors, values };
  let paymentId: string;
  try {
    const r = await recordPayment(ctx, {
      patientId,
      amountMinor: amountMinor!,
      method: method!,
      reference: values.reference?.trim() || null,
      payerName: values.payerName?.trim() || null,
      receivedOn: receivedOn!,
      idempotencyKey: values.idempotencyKey!,
      allocateTo,
      installmentId,
    });
    paymentId = r.id;
  } catch (err) {
    return fail(err, values);
  }
  revalidateBilling(patientId, allocateTo && allocateTo !== "auto" ? allocateTo : undefined);
  return { ok: true, data: { paymentId } };
}

export async function applyCreditAction(paymentId: string, invoiceId: string): Promise<ActionState> {
  const ctx = await requireClinicContext();
  try {
    await applyPaymentToInvoice(ctx, paymentId, invoiceId);
  } catch (err) {
    return fail(err);
  }
  revalidateBilling(undefined, invoiceId);
  return { ok: true };
}

export async function creditNoteAction(invoiceId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await requireClinicContext();
  const values = formValues(formData);
  const amountMinor = parseMoneyInput(values.amount ?? "", ctx.organization.defaultCurrency);
  if (amountMinor === null || amountMinor <= 0) return { fieldErrors: { amount: "invalidAmount" }, values };
  if (!values.reason?.trim()) return { fieldErrors: { reason: "required" }, values };
  try {
    await issueCreditNote(ctx, invoiceId, amountMinor, values.reason);
  } catch (err) {
    return fail(err, values);
  }
  revalidateBilling(undefined, invoiceId);
  return { ok: true };
}

export async function refundAction(paymentId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await requireClinicContext();
  const values = formValues(formData);
  const amountMinor = parseMoneyInput(values.amount ?? "", ctx.organization.defaultCurrency);
  const method = METHODS.find((m) => m === values.method);
  const fieldErrors: Record<string, string> = {};
  if (amountMinor === null || amountMinor <= 0) fieldErrors.amount = "invalidAmount";
  if (!values.reason?.trim()) fieldErrors.reason = "required";
  if (!method) fieldErrors.method = "required";
  if (Object.keys(fieldErrors).length) return { fieldErrors, values };
  try {
    await refundPayment(ctx, paymentId, {
      amountMinor: amountMinor!,
      method: method!,
      reason: values.reason!,
      refundedOn: todayInZone(ctx.organization.timezone),
      reference: values.reference?.trim() || null,
    });
  } catch (err) {
    return fail(err, values);
  }
  revalidatePath(`/payments/${paymentId}`);
  revalidateBilling();
  return { ok: true };
}

export async function reversePaymentAction(paymentId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await requireClinicContext();
  const values = formValues(formData);
  if (!values.reason?.trim()) return { fieldErrors: { reason: "required" }, values };
  try {
    await reversePayment(ctx, paymentId, values.reason);
  } catch (err) {
    return fail(err, values);
  }
  revalidatePath(`/payments/${paymentId}`);
  revalidateBilling();
  return { ok: true };
}
