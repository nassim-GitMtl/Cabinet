"use client";

import { useActionState, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { FormError, SelectField, SubmitButton, TextField } from "@/components/form";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { initialActionState, type ActionState } from "@/lib/action-state";
import { useErrorText } from "@/components/form";
import {
  applyCreditAction,
  creditNoteAction,
  deleteDraftAction,
  issueInvoiceAction,
  refundAction,
  reversePaymentAction,
  voidInvoiceAction,
} from "../actions";
import { PaymentForm } from "./payment-form";

type Variant = "default" | "outline" | "ghost" | "destructive" | "secondary";

/** Button + dialog wrapper; content receives a close callback. */
export function DialogButton({
  label,
  title,
  description,
  variant = "outline",
  icon,
  children,
}: {
  label: string;
  title: string;
  description?: string;
  variant?: Variant;
  icon?: ReactNode;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant={variant} onClick={() => setOpen(true)}>
        {icon}
        {label}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description ? <DialogDescription>{description}</DialogDescription> : <DialogDescription className="sr-only">{title}</DialogDescription>}
          </DialogHeader>
          {open ? children(() => setOpen(false)) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

export function ReceivePaymentButton(props: {
  patientId: string;
  allocateTo: string | "auto" | null;
  installmentId?: string | null;
  defaultAmountMinor?: number;
  currency: string;
  symbol: string;
  today: string;
  label: string;
  description?: string;
  variant?: Variant;
  icon?: ReactNode;
}) {
  const { label, description, variant = "default", icon, ...rest } = props;
  return (
    <DialogButton label={label} title={label} description={description} variant={variant} icon={icon}>
      {(close) => <PaymentForm {...rest} submitLabel={label} onDone={close} />}
    </DialogButton>
  );
}

/** Small reason form used by void / reverse / credit / refund dialogs. */
function useServerForm(fn: (prev: ActionState, fd: FormData) => Promise<ActionState>, onOk: () => void) {
  const router = useRouter();
  return useActionState(async (prev: ActionState, fd: FormData) => {
    const r = await fn(prev, fd);
    if (r.ok) {
      onOk();
      router.refresh();
    }
    return r;
  }, initialActionState);
}

export function VoidInvoiceForm({ invoiceId, close }: { invoiceId: string; close: () => void }) {
  const t = useTranslations("billing");
  const [state, action] = useServerForm(voidInvoiceAction.bind(null, invoiceId), close);
  return (
    <form action={action} className="space-y-4" noValidate>
      <FormError error={state.error} />
      <TextField label={t("voidReason")} name="reason" required autoComplete="off" defaultValue={state.values?.reason} error={state.fieldErrors?.reason} />
      <SubmitButton variant="destructive" className="w-full">{t("void")}</SubmitButton>
    </form>
  );
}

export function CreditNoteForm({ invoiceId, symbol, close }: { invoiceId: string; symbol: string; close: () => void }) {
  const t = useTranslations("billing");
  const [state, action] = useServerForm(creditNoteAction.bind(null, invoiceId), close);
  return (
    <form action={action} className="space-y-4" noValidate>
      <FormError error={state.error} />
      <TextField label={`${t("amount")} (${symbol})`} name="amount" inputMode="decimal" required autoComplete="off" className="tabular" defaultValue={state.values?.amount} error={state.fieldErrors?.amount} />
      <TextField label={t("creditReason")} name="reason" required autoComplete="off" defaultValue={state.values?.reason} error={state.fieldErrors?.reason} />
      <SubmitButton className="w-full">{t("issueCredit")}</SubmitButton>
    </form>
  );
}

export function RefundForm({ paymentId, symbol, close }: { paymentId: string; symbol: string; close: () => void }) {
  const t = useTranslations("billing");
  const [state, action] = useServerForm(refundAction.bind(null, paymentId), close);
  return (
    <form action={action} className="space-y-4" noValidate>
      <FormError error={state.error} />
      <TextField label={`${t("amount")} (${symbol})`} name="amount" inputMode="decimal" required autoComplete="off" className="tabular" defaultValue={state.values?.amount} error={state.fieldErrors?.amount} />
      <SelectField
        label={t("method")}
        name="method"
        defaultValue={state.values?.method ?? "cash"}
        options={(["cash", "card", "bank_transfer", "cheque", "other"] as const).map((m) => ({ value: m, label: t(`methods.${m}`) }))}
      />
      <TextField label={t("creditReason")} name="reason" required autoComplete="off" defaultValue={state.values?.reason} error={state.fieldErrors?.reason} />
      <TextField label={t("reference")} name="reference" optionalLabel autoComplete="off" defaultValue={state.values?.reference} />
      <SubmitButton className="w-full">{t("refund")}</SubmitButton>
    </form>
  );
}

export function ReversePaymentForm({ paymentId, close }: { paymentId: string; close: () => void }) {
  const t = useTranslations("billing");
  const [state, action] = useServerForm(reversePaymentAction.bind(null, paymentId), close);
  return (
    <form action={action} className="space-y-4" noValidate>
      <FormError error={state.error} />
      <TextField label={t("creditReason")} name="reason" required autoComplete="off" defaultValue={state.values?.reason} error={state.fieldErrors?.reason} />
      <SubmitButton variant="destructive" className="w-full">{t("reverse")}</SubmitButton>
    </form>
  );
}

/** One-click actions that return ActionState (issue draft, apply credit). */
export function ActionButton({
  run,
  label,
  variant = "default",
  icon,
}: {
  run: () => Promise<ActionState>;
  label: string;
  variant?: Variant;
  icon?: ReactNode;
}) {
  const router = useRouter();
  const errorText = useErrorText();
  const [pending, start] = useTransition();
  return (
    <Button
      variant={variant}
      disabled={pending}
      aria-busy={pending}
      onClick={() =>
        start(async () => {
          const r = await run();
          if (r.error) toast.error(errorText(r.error));
          else router.refresh();
        })
      }
    >
      {icon}
      {label}
    </Button>
  );
}

export function IssueDraftButton({ invoiceId }: { invoiceId: string }) {
  const t = useTranslations("billing");
  return <ActionButton run={() => issueInvoiceAction(invoiceId)} label={t("issue")} />;
}

export function ApplyCreditButton({ paymentId, invoiceId }: { paymentId: string; invoiceId: string }) {
  const t = useTranslations("billing");
  return <ActionButton run={() => applyCreditAction(paymentId, invoiceId)} label={t("applyCredit")} variant="outline" />;
}

export function VoidInvoiceButton({ invoiceId }: { invoiceId: string }) {
  const t = useTranslations("billing");
  return (
    <DialogButton label={t("void")} title={t("void")} description={t("voidHint")} variant="ghost">
      {(close) => <VoidInvoiceForm invoiceId={invoiceId} close={close} />}
    </DialogButton>
  );
}

export function CreditNoteButton({ invoiceId, symbol }: { invoiceId: string; symbol: string }) {
  const t = useTranslations("billing");
  return (
    <DialogButton label={t("issueCredit")} title={t("issueCredit")} description={t("creditHint")}>
      {(close) => <CreditNoteForm invoiceId={invoiceId} symbol={symbol} close={close} />}
    </DialogButton>
  );
}

export function RefundButton({ paymentId, symbol }: { paymentId: string; symbol: string }) {
  const t = useTranslations("billing");
  return (
    <DialogButton label={t("refund")} title={t("refund")} description={t("refundHint")}>
      {(close) => <RefundForm paymentId={paymentId} symbol={symbol} close={close} />}
    </DialogButton>
  );
}

export function ReversePaymentButton({ paymentId }: { paymentId: string }) {
  const t = useTranslations("billing");
  return (
    <DialogButton label={t("reverse")} title={t("reverse")} description={t("reverseHint")} variant="ghost">
      {(close) => <ReversePaymentForm paymentId={paymentId} close={close} />}
    </DialogButton>
  );
}

export function DeleteDraftButton({ invoiceId }: { invoiceId: string }) {
  const t = useTranslations("billing");
  const [pending, start] = useTransition();
  return (
    <Button variant="ghost" disabled={pending} onClick={() => start(() => deleteDraftAction(invoiceId))}>
      {t("deleteDraft")}
    </Button>
  );
}
