"use client";

import { useActionState, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { CheckIcon } from "lucide-react";
import { useErrorText } from "@/components/form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { moneyFormatter } from "@/features/billing/format";
import { INTL_LOCALE, isLocale } from "@/i18n/config";
import { initialActionState } from "@/lib/action-state";
import { minorToInput, parseMoneyInput } from "@/lib/money";
import { cn } from "@/lib/utils";
import { savePriceListRowAction } from "../actions";
import { calculateHonorarium, percentInputToBasisPoints, resolveRule, type FeeRule } from "../calculation";

export type PriceListService = {
  id: string;
  code: string;
  label: string;
  priceMinor: number;
  currency: string;
  isActive: boolean;
  deductLabBeforeShare: boolean;
  ownPriceMinor: number | null;
  rule: FeeRule | null;
};

/**
 * One service of a practitioner's price list: his own price (empty = catalog price) and his fee for it (empty = his
 * default percentage), with what he earns on one act. Read-only for the practitioner himself.
 */
export function PriceListRow({
  providerId,
  service,
  defaultRateBp,
  symbol,
  readOnly,
}: {
  providerId: string;
  service: PriceListService;
  defaultRateBp: number;
  symbol: string;
  readOnly: boolean;
}) {
  const t = useTranslations("honoraria.priceList");
  const errorText = useErrorText();
  const locale = useLocale();
  const money = moneyFormatter(INTL_LOCALE[isLocale(locale) ? locale : "fr"], symbol);
  const [state, action, pending] = useActionState(savePriceListRowAction.bind(null, providerId, service.id), initialActionState);
  const initial = {
    price: service.ownPriceMinor !== null ? minorToInput(service.ownPriceMinor, service.currency) : "",
    ruleType: service.rule?.type ?? "percent",
    ruleValue: service.rule ? (service.rule.type === "percent" ? String(service.rule.value / 100) : minorToInput(service.rule.value, service.currency)) : "",
  };
  const [price, setPrice] = useState(state.values?.price ?? initial.price);
  const [ruleType, setRuleType] = useState<FeeRule["type"]>((state.values?.ruleType as FeeRule["type"]) ?? initial.ruleType);
  const [ruleValue, setRuleValue] = useState(state.values?.ruleValue ?? initial.ruleValue);
  const [saved, setSaved] = useState({ price: initial.price, ruleType: initial.ruleType, ruleValue: initial.ruleValue });
  if (state.ok && state.values && (state.values.price !== saved.price || state.values.ruleValue !== saved.ruleValue || state.values.ruleType !== saved.ruleType)) {
    setSaved({ price: state.values.price ?? "", ruleType: (state.values.ruleType as FeeRule["type"]) ?? "percent", ruleValue: state.values.ruleValue ?? "" });
  }
  const dirty = price !== saved.price || ruleValue !== saved.ruleValue || (ruleValue.trim() !== "" && ruleType !== saved.ruleType);

  const effectivePrice = price.trim() ? parseMoneyInput(price, service.currency) : service.priceMinor;
  const ownRule = ruleValue.trim()
    ? (() => {
        const value = ruleType === "percent" ? percentInputToBasisPoints(ruleValue) : parseMoneyInput(ruleValue, service.currency);
        return value === null ? undefined : { type: ruleType, value };
      })()
    : null;
  const share =
    effectivePrice !== null && effectivePrice >= 0 && ownRule !== undefined
      ? calculateHonorarium({ unitPriceMinor: effectivePrice, quantity: 1, discountMinor: 0, labFeeMinor: 0, deductLabBeforeShare: false, rule: resolveRule(ownRule, null, defaultRateBp) }).physicianShareMinor
      : null;

  return (
    <form action={action} className={cn("grid items-center gap-2 px-4 py-2.5 text-sm sm:grid-cols-[minmax(0,1fr)_8rem_9rem_12rem_7rem]", !service.isActive && "opacity-60")} noValidate>
      <div className="min-w-0">
        <p className="font-medium"><bdi>{service.code} · {service.label}</bdi></p>
        <p className="text-xs text-muted-foreground">
          {t("catalogPrice", { amount: money(service.priceMinor, service.currency) })}
          {service.deductLabBeforeShare ? ` · ${t("labDeducted")}` : ""}
          {!service.isActive ? ` · ${t("inactive")}` : ""}
        </p>
      </div>
      <label className="grid gap-0.5 text-xs text-muted-foreground sm:block">
        <span className="sm:sr-only">{t("ownPrice")}</span>
        <Input
          name="price"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          placeholder={minorToInput(service.priceMinor, service.currency)}
          inputMode="decimal"
          readOnly={readOnly}
          aria-invalid={Boolean(state.fieldErrors?.price) || undefined}
          className="tabular"
        />
      </label>
      <label className="grid gap-0.5 text-xs text-muted-foreground sm:block">
        <span className="sm:sr-only">{t("feeType")}</span>
        <NativeSelect name="ruleType" value={ruleType} onChange={(e) => setRuleType(e.target.value as FeeRule["type"])} disabled={readOnly}>
          <NativeSelectOption value="percent">{t("percent")}</NativeSelectOption>
          <NativeSelectOption value="fixed">{t("fixed", { currency: symbol })}</NativeSelectOption>
        </NativeSelect>
      </label>
      <label className="grid gap-0.5 text-xs text-muted-foreground sm:block">
        <span className="sm:sr-only">{t("feeValue")}</span>
        <Input
          name="ruleValue"
          value={ruleValue}
          onChange={(e) => setRuleValue(e.target.value)}
          placeholder={t("defaultPlaceholder", { rate: defaultRateBp / 100 })}
          inputMode="decimal"
          readOnly={readOnly}
          aria-invalid={Boolean(state.fieldErrors?.ruleValue) || undefined}
          className="tabular"
        />
      </label>
      <div className="flex items-center justify-between gap-2 sm:justify-end">
        <span className="text-xs tabular text-muted-foreground" aria-live="polite">{share !== null ? t("earns", { amount: money(share, service.currency) }) : "—"}</span>
        {!readOnly ? (
          dirty ? (
            <Button type="submit" size="sm" disabled={pending}>{t("save")}</Button>
          ) : state.ok ? (
            <CheckIcon className="size-4 text-primary" aria-label={t("saved")} />
          ) : null
        ) : null}
      </div>
      {state.error || state.fieldErrors ? (
        <p role="alert" className="text-xs text-destructive sm:col-span-5">
          {errorText(state.error ?? state.fieldErrors?.price ?? state.fieldErrors?.ruleValue)}
        </p>
      ) : null}
    </form>
  );
}
