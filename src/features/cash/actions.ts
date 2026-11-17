"use server";

import { revalidatePath } from "next/cache";
import { formValues, type ActionState } from "@/lib/action-state";
import { parseDateOnly, todayInZone } from "@/lib/dates";
import { parseMoneyInput } from "@/lib/money";
import { ForbiddenError, requireClinicContext } from "@/server/auth/context";
import {
  addCashMovement,
  approveCashSession,
  CashError,
  closeCashSession,
  createExpense,
  EXPENSE_CATEGORIES,
  markExpensePaid,
  openCashSession,
  voidExpense,
  type PayMethod,
} from "./server";

const METHODS: PayMethod[] = ["cash", "card", "bank_transfer", "cheque", "other"];

function fail(err: unknown, values?: Record<string, string>): ActionState {
  if (err instanceof ForbiddenError) return { error: "forbidden", values };
  if (err instanceof CashError) return { error: `cash.errors.${err.code}`, values };
  throw err;
}

const done = (): ActionState => {
  revalidatePath("/cash");
  revalidatePath("/expenses");
  revalidatePath("/reports");
  return { ok: true };
};

export async function openCashAction(date: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireClinicContext();
  const values = formValues(fd);
  const amount = parseMoneyInput(values.float || "0", ctx.organization.defaultCurrency);
  if (amount === null || amount < 0) return { fieldErrors: { float: "invalidAmount" }, values };
  try {
    await openCashSession(ctx, date, amount);
  } catch (e) {
    return fail(e, values);
  }
  return done();
}

export async function cashMovementAction(sessionId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireClinicContext();
  const values = formValues(fd);
  const amount = parseMoneyInput(values.amount ?? "", ctx.organization.defaultCurrency);
  const fieldErrors: Record<string, string> = {};
  if (amount === null || amount <= 0) fieldErrors.amount = "invalidAmount";
  if (!values.reason?.trim()) fieldErrors.reason = "required";
  if (Object.keys(fieldErrors).length) return { fieldErrors, values };
  try {
    await addCashMovement(ctx, sessionId, values.direction === "in" ? "in" : "out", amount!, values.reason!);
  } catch (e) {
    return fail(e, values);
  }
  return done();
}

export async function closeCashAction(sessionId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireClinicContext();
  const values = formValues(fd);
  const counted = parseMoneyInput(values.counted ?? "", ctx.organization.defaultCurrency);
  if (counted === null || counted < 0) return { fieldErrors: { counted: "invalidAmount" }, values };
  try {
    await closeCashSession(ctx, sessionId, counted, values.reason || null, values.notes || null);
  } catch (e) {
    if (e instanceof CashError && e.code === "discrepancyReasonRequired") return { fieldErrors: { reason: "cash.errors.discrepancyReasonRequired" }, values };
    return fail(e, values);
  }
  return done();
}

export async function approveCashAction(sessionId: string): Promise<ActionState> {
  const ctx = await requireClinicContext();
  try {
    await approveCashSession(ctx, sessionId);
  } catch (e) {
    return fail(e);
  }
  return done();
}

export async function createExpenseAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireClinicContext();
  const values = formValues(fd);
  const today = todayInZone(ctx.organization.timezone);
  const amount = parseMoneyInput(values.amount ?? "", ctx.organization.defaultCurrency);
  const expenseDate = parseDateOnly(values.expenseDate ?? "");
  const category = EXPENSE_CATEGORIES.find((c) => c === values.category);
  const paid = values.paid === "on";
  const method = METHODS.find((m) => m === values.paymentMethod) ?? null;
  const fieldErrors: Record<string, string> = {};
  if (amount === null || amount <= 0) fieldErrors.amount = "invalidAmount";
  if (!expenseDate) fieldErrors.expenseDate = "invalidDate";
  else if (expenseDate > today) fieldErrors.expenseDate = "futureDate";
  if (!category) fieldErrors.category = "required";
  if (!values.description?.trim()) fieldErrors.description = "required";
  if (paid && !method) fieldErrors.paymentMethod = "required";
  if (Object.keys(fieldErrors).length) return { fieldErrors, values };
  try {
    await createExpense(ctx, {
      category: category!,
      supplierName: values.supplierName?.trim() || null,
      reference: values.reference?.trim() || null,
      description: values.description!.trim(),
      expenseDate: expenseDate!,
      amountMinor: amount!,
      paid,
      paidOn: paid ? expenseDate : null,
      paymentMethod: paid ? method : null,
    });
  } catch (e) {
    return fail(e, values);
  }
  return done();
}

export async function payExpenseAction(id: string, method: string): Promise<ActionState> {
  const ctx = await requireClinicContext();
  const m = METHODS.find((x) => x === method);
  if (!m) return { error: "generic" };
  try {
    await markExpensePaid(ctx, id, todayInZone(ctx.organization.timezone), m);
  } catch (e) {
    return fail(e);
  }
  return done();
}

export async function voidExpenseAction(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireClinicContext();
  const values = formValues(fd);
  if (!values.reason?.trim()) return { fieldErrors: { reason: "required" }, values };
  try {
    await voidExpense(ctx, id, values.reason);
  } catch (e) {
    return fail(e, values);
  }
  return done();
}
