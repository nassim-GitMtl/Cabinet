"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { FormError, SelectField, SubmitButton, TextField } from "@/components/form";
import { initialActionState, type ActionState } from "@/lib/action-state";
import { minorToInput } from "@/lib/money";
import { recordPaymentAction } from "../actions";

const METHODS = ["cash", "card", "bank_transfer", "cheque", "other"] as const;

/**
 * Receives a payment. A fresh idempotency key per form instance makes a
 * double-tap or network retry return the original payment instead of a second receipt.
 */
export function PaymentForm({
  patientId,
  allocateTo,
  defaultAmountMinor,
  currency,
  symbol,
  today,
  submitLabel,
  onDone,
}: {
  patientId: string;
  allocateTo: string | "auto" | null;
  defaultAmountMinor?: number;
  currency: string;
  symbol: string;
  today: string;
  submitLabel: string;
  onDone?: () => void;
}) {
  const t = useTranslations("billing");
  const router = useRouter();
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [state, action] = useActionState(async (prev: ActionState, fd: FormData) => {
    const result = await recordPaymentAction(patientId, allocateTo, prev, fd);
    if (result.ok) {
      const paymentId = (result.data as { paymentId: string }).paymentId;
      toast.success(t("paymentRecorded"), {
        action: { label: t("printReceipt"), onClick: () => window.open(`/print/receipts/${paymentId}`, "_blank", "noopener") },
      });
      setKey(crypto.randomUUID());
      onDone?.();
      router.refresh();
    }
    return result;
  }, initialActionState);
  const v = state.values ?? {};
  const fe = state.fieldErrors ?? {};

  return (
    <form action={action} className="space-y-4" noValidate>
      <input type="hidden" name="idempotencyKey" value={key} />
      <FormError error={state.error} />
      <TextField
        label={`${t("amount")} (${symbol})`}
        name="amount"
        inputMode="decimal"
        autoComplete="off"
        required
        className="text-lg tabular"
        defaultValue={v.amount ?? (defaultAmountMinor ? minorToInput(defaultAmountMinor, currency) : "")}
        error={fe.amount}
      />
      <SelectField
        label={t("method")}
        name="method"
        required
        defaultValue={v.method ?? "cash"}
        options={METHODS.map((m) => ({ value: m, label: t(`methods.${m}`) }))}
        error={fe.method}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label={t("receivedOn")} name="receivedOn" type="date" max={today} defaultValue={v.receivedOn ?? today} error={fe.receivedOn} />
        <TextField label={t("reference")} name="reference" optionalLabel autoComplete="off" defaultValue={v.reference} />
      </div>
      <TextField label={t("payerName")} name="payerName" optionalLabel autoComplete="off" defaultValue={v.payerName} />
      <SubmitButton size="lg" className="w-full">
        {submitLabel}
      </SubmitButton>
    </form>
  );
}
