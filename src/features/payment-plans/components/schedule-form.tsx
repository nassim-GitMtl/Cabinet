"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { FormError, SubmitButton, TextField } from "@/components/form";
import { Button } from "@/components/ui/button";
import { initialActionState, type ActionState } from "@/lib/action-state";
import { minorToInput } from "@/lib/money";
import { DialogButton } from "@/features/billing/components/billing-dialogs";
import { createPaymentScheduleAction } from "../actions";

type Row = { key: string; date: string; amount: string };
const addMonths = (date: string, months: number) => {
  const [y, m, d] = date.split("-").map(Number);
  const target = new Date(Date.UTC(y!, m! - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  return `${target.getUTCFullYear()}-${String(target.getUTCMonth() + 1).padStart(2, "0")}-${String(Math.min(d!, last)).padStart(2, "0")}`;
};

type ScheduleProps = { planId: string; patientId: string; totalMinor: number; currency: string; symbol: string; today: string; replacing: boolean };

/** Client-side dialog wrapper: a Server Component cannot pass the render function DialogButton expects. */
export function ScheduleDialog({ label, title, description, ...props }: ScheduleProps & { label: string; title: string; description: string }) {
  return (
    <DialogButton label={label} title={title} description={description} variant="outline">
      {(close) => <ScheduleForm {...props} onDone={close} />}
    </DialogButton>
  );
}

export function ScheduleForm({ planId, patientId, totalMinor, currency, symbol, today, replacing, onDone }: ScheduleProps & { onDone?: () => void }) {
  const t = useTranslations("paymentPlans");
  const router = useRouter();
  const initial = Array.from({ length: 3 }, (_, index) => {
    const amount = Math.floor(totalMinor / 3) + (index < totalMinor % 3 ? 1 : 0);
    return { key: crypto.randomUUID(), date: addMonths(today, index), amount: minorToInput(amount, currency) };
  });
  const [rows, setRows] = useState<Row[]>(initial);
  const [state, action] = useActionState(async (prev: ActionState, data: FormData) => {
    const result = await createPaymentScheduleAction(planId, patientId, prev, data);
    if (result.ok) { router.refresh(); onDone?.(); }
    return result;
  }, initialActionState);
  return <form action={action} className="space-y-3" noValidate>
    <FormError error={state.error} />
    <div className="space-y-2">
      {rows.map((row, index) => <div key={row.key} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2 rounded-lg border p-3">
        <TextField label={t("dueDate", { number: index + 1 })} name="dueDate" type="date" min={today} required value={row.date}
          onChange={(e) => setRows((current) => current.map((x) => x.key === row.key ? { ...x, date: e.target.value } : x))} />
        <TextField label={`${t("amount")} (${symbol})`} name="amount" inputMode="decimal" required value={row.amount}
          onChange={(e) => setRows((current) => current.map((x) => x.key === row.key ? { ...x, amount: e.target.value } : x))} />
        <Button type="button" variant="ghost" size="icon" disabled={rows.length === 1} aria-label={t("remove")}
          onClick={() => setRows((current) => current.filter((x) => x.key !== row.key))}><Trash2Icon aria-hidden /></Button>
      </div>)}
    </div>
    <Button type="button" variant="outline" size="sm" onClick={() => setRows((current) => [...current, { key: crypto.randomUUID(), date: addMonths(current.at(-1)?.date || today, 1), amount: "" }])}>
      <PlusIcon aria-hidden />{t("addInstallment")}
    </Button>
    <p className="text-xs text-muted-foreground">{t("sumHint", { total: minorToInput(totalMinor, currency), symbol })}</p>
    <SubmitButton className="w-full">{t(replacing ? "replace" : "create")}</SubmitButton>
  </form>;
}
