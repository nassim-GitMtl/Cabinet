"use client";

import { useActionState, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { CheckCheckIcon, PlusIcon } from "lucide-react";
import { FormError, SelectField, SubmitButton, TextAreaField, TextField } from "@/components/form";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { DialogButton, ActionButton } from "@/features/billing/components/billing-dialogs";
import { initialActionState, type ActionState } from "@/lib/action-state";
import { approveCashAction, cashMovementAction, closeCashAction, createExpenseAction, openCashAction, payExpenseAction, voidExpenseAction } from "../actions";

const CATEGORIES = ["rent", "salaries", "lab", "supplies", "equipment", "maintenance", "utilities", "taxes", "bank_fees", "other"] as const;
const METHODS = ["cash", "card", "bank_transfer", "cheque", "other"] as const;

function useForm(fn: (p: ActionState, fd: FormData) => Promise<ActionState>, onOk?: () => void) {
  const router = useRouter();
  return useActionState(async (p: ActionState, fd: FormData) => {
    const r = await fn(p, fd);
    if (r.ok) {
      onOk?.();
      router.refresh();
    }
    return r;
  }, initialActionState);
}

export function OpenCashForm({ date, symbol }: { date: string; symbol: string }) {
  const t = useTranslations("cash");
  const [state, action] = useForm(openCashAction.bind(null, date));
  return (
    <form action={action} className="flex flex-wrap items-end gap-3" noValidate>
      <FormError error={state.error} />
      <TextField label={`${t("openingFloat")} (${symbol})`} name="float" inputMode="decimal" defaultValue={state.values?.float ?? "0"} error={state.fieldErrors?.float} fieldClassName="w-48" className="tabular" />
      <SubmitButton>{t("open")}</SubmitButton>
    </form>
  );
}

export function MovementButton({ sessionId, symbol }: { sessionId: string; symbol: string }) {
  const t = useTranslations("cash");
  return (
    <DialogButton label={t("addMovement")} title={t("addMovement")} description={t("movementHint")} icon={<PlusIcon aria-hidden />}>
      {(close) => <MovementForm sessionId={sessionId} symbol={symbol} close={close} />}
    </DialogButton>
  );
}

function MovementForm({ sessionId, symbol, close }: { sessionId: string; symbol: string; close: () => void }) {
  const t = useTranslations("cash");
  const [state, action] = useForm(cashMovementAction.bind(null, sessionId), close);
  return (
    <form action={action} className="space-y-4" noValidate>
      <FormError error={state.error} />
      <SelectField label={t("direction")} name="direction" defaultValue={state.values?.direction ?? "out"} options={[{ value: "out", label: t("out") }, { value: "in", label: t("in") }]} />
      <TextField label={`${t("amount")} (${symbol})`} name="amount" inputMode="decimal" required className="tabular" defaultValue={state.values?.amount} error={state.fieldErrors?.amount} />
      <TextField label={t("reason")} name="reason" required defaultValue={state.values?.reason} error={state.fieldErrors?.reason} />
      <SubmitButton className="w-full">{t("addMovement")}</SubmitButton>
    </form>
  );
}

export function CloseCashForm({ sessionId, symbol }: { sessionId: string; symbol: string }) {
  const t = useTranslations("cash");
  const [state, action] = useForm(closeCashAction.bind(null, sessionId));
  return (
    <form action={action} className="space-y-4" noValidate>
      <FormError error={state.error} />
      <TextField label={`${t("counted")} (${symbol})`} name="counted" inputMode="decimal" required className="text-lg tabular" defaultValue={state.values?.counted} error={state.fieldErrors?.counted} hint={t("countedHint")} />
      <TextField label={t("discrepancyReason")} name="reason" optionalLabel defaultValue={state.values?.reason} error={state.fieldErrors?.reason} />
      <TextAreaField label={t("notes")} name="notes" optionalLabel rows={2} defaultValue={state.values?.notes} />
      <SubmitButton size="lg" className="w-full">{t("close")}</SubmitButton>
    </form>
  );
}

export function ApproveCashButton({ sessionId }: { sessionId: string }) {
  const t = useTranslations("cash");
  return <ActionButton run={() => approveCashAction(sessionId)} label={t("approve")} icon={<CheckCheckIcon aria-hidden />} />;
}

export function NewExpenseButton({ symbol, today }: { symbol: string; today: string }) {
  const t = useTranslations("expenses");
  return (
    <DialogButton label={t("new")} title={t("new")} variant="default" icon={<PlusIcon aria-hidden />}>
      {(close) => <ExpenseForm symbol={symbol} today={today} close={close} />}
    </DialogButton>
  );
}

function ExpenseForm({ symbol, today, close }: { symbol: string; today: string; close: () => void }) {
  const t = useTranslations("expenses");
  const tb = useTranslations("billing");
  const [state, action] = useForm(createExpenseAction, close);
  const v = state.values ?? {};
  const fe = state.fieldErrors ?? {};
  const [paid, setPaid] = useState(v.paid !== undefined ? v.paid === "on" : true);
  return (
    <form action={action} className="space-y-4" noValidate>
      <FormError error={state.error} />
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField label={t("category")} name="category" required defaultValue={v.category ?? "supplies"} options={CATEGORIES.map((c) => ({ value: c, label: t(`categories.${c}`) }))} error={fe.category} />
        <TextField label={`${tb("amount")} (${symbol})`} name="amount" inputMode="decimal" required className="tabular" defaultValue={v.amount} error={fe.amount} />
        <TextField label={t("description")} name="description" required defaultValue={v.description} error={fe.description} fieldClassName="sm:col-span-2" />
        <TextField label={t("supplier")} name="supplierName" optionalLabel defaultValue={v.supplierName} />
        <TextField label={t("reference")} name="reference" optionalLabel defaultValue={v.reference} />
        <TextField label={t("date")} name="expenseDate" type="date" max={today} defaultValue={v.expenseDate ?? today} error={fe.expenseDate} />
      </div>
      <div className="flex items-center gap-3 rounded-lg border p-3">
        <Checkbox id="expense-paid" name="paid" checked={paid} onCheckedChange={(c) => setPaid(Boolean(c))} />
        <Label htmlFor="expense-paid" className="font-normal">{t("paidNow")}</Label>
      </div>
      {paid ? <SelectField label={tb("method")} name="paymentMethod" defaultValue={v.paymentMethod ?? "cash"} options={METHODS.map((m) => ({ value: m, label: tb(`methods.${m}`) }))} error={fe.paymentMethod} /> : null}
      <SubmitButton className="w-full">{t("new")}</SubmitButton>
    </form>
  );
}

export function PayExpenseButton({ id }: { id: string }) {
  const t = useTranslations("expenses");
  const tb = useTranslations("billing");
  const [method, setMethod] = useState<string>("cash");
  return (
    <span className="inline-flex items-center gap-1">
      <select aria-label={tb("method")} value={method} onChange={(e) => setMethod(e.target.value)} className="h-9 rounded-md border bg-background px-2 text-sm md:h-7">
        {METHODS.map((m) => (
          <option key={m} value={m}>{tb(`methods.${m}`)}</option>
        ))}
      </select>
      <ActionButton run={() => payExpenseAction(id, method)} label={t("markPaid")} variant="outline" />
    </span>
  );
}

export function VoidExpenseButton({ id }: { id: string }): ReactNode {
  const t = useTranslations("expenses");
  return (
    <DialogButton label={t("void")} title={t("void")} variant="ghost">
      {(close) => <VoidExpenseForm id={id} close={close} />}
    </DialogButton>
  );
}

function VoidExpenseForm({ id, close }: { id: string; close: () => void }) {
  const t = useTranslations("expenses");
  const [state, action] = useForm(voidExpenseAction.bind(null, id), close);
  return (
    <form action={action} className="space-y-4" noValidate>
      <FormError error={state.error} />
      <TextField label={t("voidReason")} name="reason" required defaultValue={state.values?.reason} error={state.fieldErrors?.reason} />
      <SubmitButton variant="destructive" className="w-full">{t("void")}</SubmitButton>
    </form>
  );
}
