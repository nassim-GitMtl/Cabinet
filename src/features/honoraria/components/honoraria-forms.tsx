"use client";

import { useActionState, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { HandCoinsIcon, LockKeyholeIcon, PlusIcon, SlidersHorizontalIcon, Undo2Icon } from "lucide-react";
import { FormError, SelectField, SubmitButton, TextField } from "@/components/form";
import { DialogButton } from "@/features/billing/components/billing-dialogs";
import { moneyFormatter } from "@/features/billing/format";
import { INTL_LOCALE, isLocale } from "@/i18n/config";
import { initialActionState, type ActionState } from "@/lib/action-state";
import { parseMoneyInput } from "@/lib/money";
import {
  adjustEntryAction,
  assignLineAction,
  closeMonthAction,
  recordPaymentAction,
  reversePaymentAction,
  saveProviderProfileAction,
  saveTermAction,
} from "../actions";
import { calculateHonorarium, resolveRule, type FeeRule } from "../calculation";

type Option = { value: string; label: string };
const METHODS = ["cash", "bank_transfer", "cheque", "card", "other"] as const;

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

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export function ProviderProfileButton({ provider }: { provider: { id: string; name: string; specialty: string | null; defaultFeeRateBp: number } }) {
  const t = useTranslations("honoraria");
  return (
    <DialogButton label={t("config.editProfile")} title={provider.name} description={t("config.profileHint")} variant="ghost" icon={<SlidersHorizontalIcon aria-hidden />}>
      {(close) => <ProviderProfileForm provider={provider} close={close} />}
    </DialogButton>
  );
}

function ProviderProfileForm({ provider, close }: { provider: { id: string; specialty: string | null; defaultFeeRateBp: number }; close: () => void }) {
  const t = useTranslations("honoraria");
  const [state, action] = useForm(saveProviderProfileAction, close);
  return (
    <form action={action} className="space-y-4" noValidate>
      <FormError error={state.error} />
      <input type="hidden" name="providerId" value={provider.id} />
      <TextField label={t("config.specialty")} name="specialty" optionalLabel defaultValue={state.values?.specialty ?? provider.specialty ?? ""} />
      <TextField
        label={t("config.defaultRate")}
        name="defaultRate"
        inputMode="decimal"
        required
        className="tabular"
        hint={t("config.defaultRateHint")}
        defaultValue={state.values?.defaultRate ?? String(provider.defaultFeeRateBp / 100)}
        error={state.fieldErrors?.defaultRate}
      />
      <SubmitButton className="w-full">{t("config.save")}</SubmitButton>
    </form>
  );
}

export function TermButton({ providers, services, symbol }: { providers: Option[]; services: Option[]; symbol: string }) {
  const t = useTranslations("honoraria");
  return (
    <DialogButton label={t("config.addRule")} title={t("config.addRule")} description={t("config.ruleHint")} icon={<PlusIcon aria-hidden />}>
      {(close) => <TermForm providers={providers} services={services} symbol={symbol} close={close} />}
    </DialogButton>
  );
}

function TermForm({ providers, services, symbol, close }: { providers: Option[]; services: Option[]; symbol: string; close: () => void }) {
  const t = useTranslations("honoraria");
  const [state, action] = useForm(saveTermAction, close);
  const [ruleType, setRuleType] = useState<FeeRule["type"]>(state.values?.ruleType === "fixed" ? "fixed" : "percent");
  const fe = state.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-4" noValidate>
      <FormError error={state.error} />
      <SelectField label={t("doctor")} name="providerId" required defaultValue={state.values?.providerId} options={providers} />
      <SelectField label={t("service")} name="serviceId" required defaultValue={state.values?.serviceId} options={services} />
      <TextField label={t("config.specificPrice", { currency: symbol })} name="price" inputMode="decimal" optionalLabel hint={t("config.specificPriceHint")} className="tabular" defaultValue={state.values?.price} error={fe.price} />
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          label={t("config.ruleType")}
          name="ruleType"
          value={ruleType}
          onChange={(e) => setRuleType(e.target.value as FeeRule["type"])}
          options={[
            { value: "percent", label: t("config.percent") },
            { value: "fixed", label: t("config.fixed") },
          ]}
        />
        <TextField
          label={ruleType === "percent" ? t("config.valuePercent") : t("config.valueFixed", { currency: symbol })}
          name="ruleValue"
          inputMode="decimal"
          required
          className="tabular"
          defaultValue={state.values?.ruleValue}
          error={fe.ruleValue}
        />
      </div>
      <TextField label={t("config.reason")} name="reason" required defaultValue={state.values?.reason} error={fe.reason} />
      <SubmitButton className="w-full">{t("config.saveRule")}</SubmitButton>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Payments and closures
// ---------------------------------------------------------------------------

export function PaymentButton({ providers, today, symbol, suggested }: { providers: Option[]; today: string; symbol: string; suggested?: { providerId: string; amount: string } }) {
  const t = useTranslations("honoraria");
  return (
    <DialogButton label={t("payments.record")} title={t("payments.record")} description={t("payments.hint")} variant="default" icon={<HandCoinsIcon aria-hidden />}>
      {(close) => <PaymentForm providers={providers} today={today} symbol={symbol} suggested={suggested} close={close} />}
    </DialogButton>
  );
}

function PaymentForm({ providers, today, symbol, suggested, close }: { providers: Option[]; today: string; symbol: string; suggested?: { providerId: string; amount: string }; close: () => void }) {
  const t = useTranslations("honoraria");
  const tb = useTranslations("billing");
  const [state, action] = useForm(recordPaymentAction, close);
  const v = state.values;
  return (
    <form action={action} className="space-y-4" noValidate>
      <FormError error={state.error} />
      <SelectField label={t("doctor")} name="providerId" required defaultValue={v?.providerId ?? suggested?.providerId} options={providers} />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label={t("payments.date")} name="paidOn" type="date" max={today} required defaultValue={v?.paidOn ?? today} />
        <TextField label={t("payments.amount", { currency: symbol })} name="amount" inputMode="decimal" required className="tabular" defaultValue={v?.amount ?? suggested?.amount} error={state.fieldErrors?.amount} />
      </div>
      <SelectField label={tb("method")} name="method" defaultValue={v?.method ?? "cash"} options={METHODS.map((m) => ({ value: m, label: tb(`methods.${m}`) }))} hint={t("payments.cashHint")} />
      <TextField label={t("payments.reference")} name="reference" optionalLabel defaultValue={v?.reference} />
      <TextField label={t("payments.note")} name="note" optionalLabel defaultValue={v?.note} />
      <SubmitButton className="w-full">{t("payments.record")}</SubmitButton>
    </form>
  );
}

export function ReversePaymentButton({ paymentId }: { paymentId: string }) {
  const t = useTranslations("honoraria");
  return (
    <DialogButton label={t("payments.reverse")} title={t("payments.reverse")} description={t("payments.reverseHint")} variant="ghost" icon={<Undo2Icon aria-hidden />}>
      {(close) => <ReversePaymentForm paymentId={paymentId} close={close} />}
    </DialogButton>
  );
}

function ReversePaymentForm({ paymentId, close }: { paymentId: string; close: () => void }) {
  const t = useTranslations("honoraria");
  const [state, action] = useForm(reversePaymentAction.bind(null, paymentId), close);
  return (
    <form action={action} className="space-y-4" noValidate>
      <FormError error={state.error} />
      <TextField label={t("payments.reverseReason")} name="reason" required defaultValue={state.values?.reason} error={state.fieldErrors?.reason} />
      <SubmitButton variant="destructive" className="w-full">{t("payments.reverse")}</SubmitButton>
    </form>
  );
}

export function CloseMonthButton({ providers, lastMonth }: { providers: Option[]; lastMonth: string }) {
  const t = useTranslations("honoraria");
  return (
    <DialogButton label={t("closures.close")} title={t("closures.close")} description={t("closures.hint")} icon={<LockKeyholeIcon aria-hidden />}>
      {(close) => <CloseMonthForm providers={providers} lastMonth={lastMonth} close={close} />}
    </DialogButton>
  );
}

function CloseMonthForm({ providers, lastMonth, close }: { providers: Option[]; lastMonth: string; close: () => void }) {
  const t = useTranslations("honoraria");
  const [state, action] = useForm(closeMonthAction, close);
  return (
    <form action={action} className="space-y-4" noValidate>
      <FormError error={state.error} />
      <SelectField label={t("doctor")} name="providerId" required defaultValue={state.values?.providerId} options={providers} />
      <TextField label={t("month")} name="month" type="month" max={lastMonth} required defaultValue={state.values?.month ?? lastMonth} />
      <TextField label={t("payments.note")} name="note" optionalLabel defaultValue={state.values?.note} />
      <SubmitButton className="w-full">{t("closures.close")}</SubmitButton>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Corrections
// ---------------------------------------------------------------------------

export function AdjustEntryButton({ entryId, symbol }: { entryId: string; symbol: string }) {
  const t = useTranslations("honoraria");
  return (
    <DialogButton label={t("adjust.button")} title={t("adjust.title")} description={t("adjust.hint")} variant="ghost">
      {(close) => <AdjustEntryForm entryId={entryId} symbol={symbol} close={close} />}
    </DialogButton>
  );
}

function AdjustEntryForm({ entryId, symbol, close }: { entryId: string; symbol: string; close: () => void }) {
  const t = useTranslations("honoraria");
  const [state, action] = useForm(adjustEntryAction.bind(null, entryId), close);
  return (
    <form action={action} className="space-y-4" noValidate>
      <FormError error={state.error} />
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          label={t("adjust.direction")}
          name="direction"
          defaultValue={state.values?.direction ?? "plus"}
          options={[
            { value: "plus", label: t("adjust.plus") },
            { value: "minus", label: t("adjust.minus") },
          ]}
        />
        <TextField label={t("payments.amount", { currency: symbol })} name="amount" inputMode="decimal" required className="tabular" defaultValue={state.values?.amount} error={state.fieldErrors?.amount} />
      </div>
      <TextField label={t("adjust.reason")} name="reason" required defaultValue={state.values?.reason} error={state.fieldErrors?.reason} />
      <SubmitButton className="w-full">{t("adjust.save")}</SubmitButton>
    </form>
  );
}

/** One old invoice line: pick the practitioner and lab fee, see the split, then confirm. */
export function AssignLineForm({
  line,
  providers,
  terms,
  symbol,
}: {
  line: { id: string; serviceId: string; currency: string; unitPriceMinor: number; quantity: number; discountMinor: number; deductLabBeforeShare: boolean; providerId: string };
  providers: Array<{ id: string; name: string; defaultFeeRateBp: number }>;
  terms: Array<{ providerId: string; serviceId: string; ruleType: FeeRule["type"]; ruleValue: number }>;
  symbol: string;
}) {
  const t = useTranslations("honoraria");
  const locale = useLocale();
  const money = moneyFormatter(INTL_LOCALE[isLocale(locale) ? locale : "fr"], symbol);
  const [state, action] = useForm(assignLineAction.bind(null, line.id));
  const [providerId, setProviderId] = useState(state.values?.providerId ?? (providers.some((p) => p.id === line.providerId) ? line.providerId : ""));
  const [lab, setLab] = useState(state.values?.labFee ?? "");
  const preview = useMemo(() => {
    const provider = providers.find((p) => p.id === providerId);
    if (!provider) return null;
    const term = terms.find((x) => x.providerId === providerId && x.serviceId === line.serviceId);
    const labMinor = lab.trim() ? parseMoneyInput(lab, line.currency) : 0;
    if (labMinor === null || labMinor < 0) return null;
    const rule = resolveRule(null, term ? { type: term.ruleType, value: term.ruleValue } : null, provider.defaultFeeRateBp);
    return calculateHonorarium({ ...line, labFeeMinor: labMinor, rule });
  }, [lab, line, providerId, providers, terms]);
  const fmt = (minor: number) => money(minor, line.currency);
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-[minmax(0,14rem)_minmax(0,9rem)_1fr_auto] sm:items-end" noValidate>
      <SelectField
        label={t("doctor")}
        name="providerId"
        value={providerId}
        onChange={(e) => setProviderId(e.target.value)}
        placeholder={t("assign.choose")}
        options={providers.map((p) => ({ value: p.id, label: p.name }))}
      />
      <TextField label={line.deductLabBeforeShare ? t("assign.labFeeDeducted") : t("assign.labFee")} name="labFee" inputMode="decimal" placeholder="0" className="tabular" value={lab} onChange={(e) => setLab(e.target.value)} error={state.fieldErrors?.labFee} />
      <p className="text-sm text-muted-foreground" aria-live="polite">
        {preview ? t("assign.preview", { share: fmt(preview.physicianShareMinor), clinic: fmt(preview.clinicShareMinor) }) : t("assign.previewEmpty")}
      </p>
      <SubmitButton size="sm" disabled={!preview}>{t("assign.confirm")}</SubmitButton>
      {state.error ? <div className="sm:col-span-4"><FormError error={state.error} /></div> : null}
    </form>
  );
}
